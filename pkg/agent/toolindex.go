package agent

import (
	"math"
	"sort"
	"strings"
	"unicode"

	"consensys-asko11y-app/pkg/mcp"
)

// Tool definitions dominate the prompt when several MCP servers are
// connected: the grafana-llm-app built-in server alone declares 97 tools,
// about 25k tokens. The tool index backs search_tools, which lets the loop
// advertise one meta-tool instead of every definition (see search_tools.go).
//
// The index is a plain BM25 bag of weighted terms over the fields the model
// can reason about: the tool name, its description, and its parameter names.
// Ranking must stay deterministic so a repeated query returns the same tools
// in the same order.

const (
	// Weights per field. The name is the strongest signal ("silence" appears
	// in alerting_silences_read), descriptions carry the rest, and parameter
	// names help when a description is thin ("datasourceUid").
	toolIndexNameWeight    = 3.0
	toolIndexDescWeight    = 1.0
	toolIndexParamWeight   = 1.0
	toolIndexSynonymWeight = 0.6

	// BM25 parameters.
	toolIndexK1 = 1.2
	toolIndexB  = 0.75
)

// toolSearchSynonyms widens a query without needing the model to guess the
// exact vocabulary of each MCP server. Values are added at a lower weight, so
// a literal match still outranks a synonym match.
var toolSearchSynonyms = map[string][]string{
	"alert":         {"alerting", "alertmanager", "rules"},
	"alerting":      {"alert", "rules"},
	"silence":       {"silences", "mute", "alerting"},
	"create":        {"add", "write", "new", "post"},
	"update":        {"edit", "patch", "modify", "write"},
	"delete":        {"remove", "drop", "write"},
	"get":           {"read", "list", "fetch", "show"},
	"list":          {"read", "search", "get"},
	"dashboard":     {"dashboards", "panel", "panels", "visualization"},
	"panel":         {"panels", "dashboard", "visualization", "render"},
	"notebook":      {"notebooks", "runbook", "documents"},
	"metric":        {"metrics", "prometheus", "series", "samples"},
	"log":           {"logs", "loki", "logging"},
	"trace":         {"traces", "tempo", "spans"},
	"profile":       {"profiles", "pyroscope", "flamegraph"},
	"datasource":    {"datasources", "datasourceuid", "query"},
	"query":         {"queries", "querying", "promql", "logql", "traceql"},
	"annotate":      {"annotation", "annotations", "marker"},
	"folder":        {"folders", "directory"},
	"user":          {"users", "account", "teams"},
	"team":          {"teams", "group", "users"},
	"role":          {"roles", "permission", "rbac"},
	"permission":    {"permissions", "rbac", "access", "acl"},
	"snapshot":      {"snapshots", "share", "export"},
	"sql":           {"database", "table", "snowflake", "clickhouse", "bigquery"},
	"cloudwatch":    {"aws", "cloudwatch", "logs"},
	"elasticsearch": {"elastic", "elasticsearch", "lucene", "logs"},
	"provisioning":  {"provisioned", "repositories", "gitops"},
	"doc":           {"docs", "documentation", "help", "guide"},
	"render":        {"image", "png", "preview", "visual"},
}

// ToolMatch is one search_tools hit. The full definition is carried so the
// runtime can activate the tool without a second lookup.
type ToolMatch struct {
	Name        string
	Description string
	Score       float64
	Tool        mcp.Tool
}

type toolDoc struct {
	tool      mcp.Tool
	terms     map[string]float64
	nameTerms map[string]bool
	length    float64
}

// ToolIndex ranks the tools the loop is allowed to use. Build it from the
// already-filtered set: a tool the caller cannot call must never be
// searchable, or search_tools turns into a permission shortcut.
type ToolIndex struct {
	docs   []toolDoc
	idf    map[string]float64
	avgLen float64
}

// NewToolIndex builds the index. The input order is preserved for ties.
func NewToolIndex(tools []mcp.Tool) *ToolIndex {
	idx := &ToolIndex{
		docs: make([]toolDoc, 0, len(tools)),
		idf:  make(map[string]float64),
	}
	docFreq := make(map[string]int)
	totalLen := 0.0
	for _, tool := range tools {
		terms := make(map[string]float64)
		nameTerms := make(map[string]bool)
		for _, t := range tokenize(tool.Name) {
			nameTerms[t] = true
		}
		addTerms(terms, tokenize(tool.Name), toolIndexNameWeight)
		addTerms(terms, tokenize(tool.Description), toolIndexDescWeight)
		addTerms(terms, tokenize(strings.Join(toolParameterNames(tool), " ")), toolIndexParamWeight)
		for term := range terms {
			docFreq[term]++
		}
		length := 0.0
		for _, w := range terms {
			length += w
		}
		idx.docs = append(idx.docs, toolDoc{tool: tool, terms: terms, nameTerms: nameTerms, length: length})
		totalLen += length
	}
	if len(idx.docs) > 0 {
		idx.avgLen = totalLen / float64(len(idx.docs))
	}
	n := float64(len(idx.docs))
	for term, df := range docFreq {
		idx.idf[term] = math.Log(1 + (n-float64(df)+0.5)/(float64(df)+0.5))
	}
	return idx
}

// Len reports the number of indexed tools.
func (i *ToolIndex) Len() int {
	if i == nil {
		return 0
	}
	return len(i.docs)
}

// Search returns up to limit matches ordered by score, then by name.
// A query with no usable term returns nothing, so the caller can fall back
// to the catalog instead of guessing.
func (i *ToolIndex) Search(query string, limit int) []ToolMatch {
	if i == nil || len(i.docs) == 0 {
		return nil
	}
	if limit <= 0 || limit > maxSearchToolsResults {
		limit = defaultSearchToolsResults
	}
	queryTerms := tokenize(query)
	if len(queryTerms) == 0 {
		return nil
	}
	// Duplicates would double-count the same term; keep first occurrence.
	seen := make(map[string]bool, len(queryTerms))
	unique := queryTerms[:0]
	for _, t := range queryTerms {
		if seen[t] {
			continue
		}
		seen[t] = true
		unique = append(unique, t)
	}
	queryTerms = unique

	scored := make([]ToolMatch, 0, len(i.docs))
	for _, doc := range i.docs {
		score := 0.0
		nameHits := 0
		for _, term := range queryTerms {
			if tf, ok := doc.terms[term]; ok {
				score += i.idf[term] * (tf * (toolIndexK1 + 1)) /
					(tf + toolIndexK1*(1-toolIndexB+toolIndexB*doc.length/maxFloat(i.avgLen, 1e-9)))
				if doc.nameTerms[term] {
					nameHits++
				}
			}
			for _, syn := range toolSearchSynonyms[term] {
				if tf, ok := doc.terms[syn]; ok {
					score += toolIndexSynonymWeight * i.idf[syn] * (tf * (toolIndexK1 + 1)) /
						(tf + toolIndexK1*(1-toolIndexB+toolIndexB*doc.length/maxFloat(i.avgLen, 1e-9)))
				}
			}
		}
		if score <= 0 {
			continue
		}
		// Reward tools whose own name covers every query term: "silences"
		// should put alerting_silences_read above a tool that only mentions
		// silences in a long description.
		if nameHits == len(queryTerms) {
			score += float64(nameHits)
		}
		scored = append(scored, ToolMatch{
			Name:        doc.tool.Name,
			Description: doc.tool.Description,
			Score:       score,
			Tool:        doc.tool,
		})
	}
	sort.SliceStable(scored, func(a, b int) bool {
		if scored[a].Score != scored[b].Score {
			return scored[a].Score > scored[b].Score
		}
		return scored[a].Name < scored[b].Name
	})
	if len(scored) > limit {
		scored = scored[:limit]
	}
	return scored
}

func addTerms(terms map[string]float64, tokens []string, weight float64) {
	for _, t := range tokens {
		terms[t] += weight
		for _, syn := range toolSearchSynonyms[t] {
			terms[syn] += weight * toolIndexSynonymWeight
		}
	}
}

// toolParameterNames lists the property names of the tool's input schema, so
// "datasourceUid" or "folderUid" become searchable without relying on prose.
func toolParameterNames(tool mcp.Tool) []string {
	props, ok := tool.InputSchema["properties"].(map[string]interface{})
	if !ok {
		return nil
	}
	names := make([]string, 0, len(props))
	for name := range props {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// tokenize lowercases text and splits it on separators, camelCase boundaries,
// and digits boundaries. Single-letter fragments are dropped unless they are a
// number, which keeps "id" and "uid" but discards noise from file names.
func tokenize(text string) []string {
	if text == "" {
		return nil
	}
	var tokens []string
	var current []rune
	flush := func() {
		if len(current) == 0 {
			return
		}
		token := strings.ToLower(string(current))
		current = current[:0]
		if len(token) < 2 {
			if !strings.ContainsAny(token, "0123456789") {
				return
			}
		}
		tokens = append(tokens, token)
	}
	prevLower := false
	for _, r := range text {
		switch {
		case unicode.IsUpper(r):
			if prevLower {
				flush()
			}
			current = append(current, r)
			prevLower = false
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			current = append(current, r)
			prevLower = unicode.IsLower(r)
		default:
			flush()
			prevLower = false
		}
	}
	flush()
	return tokens
}

func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}
