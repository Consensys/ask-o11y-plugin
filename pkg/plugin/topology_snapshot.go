package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// The topology snapshot gives RCA runs a compact, up-to-date service
// dependency list before the agent issues a single query. The RCA literature
// (arXiv 2601.22208) found that models derive propagation paths poorly when
// left to discover topology themselves, and that compact list-format context
// beats voluminous JSON. Primary source: the Tempo service graph metrics the
// metrics-generator emits into Prometheus (edges with real traffic rates);
// fallback: Graphiti relationship facts. Both paths fail open — an empty
// snapshot renders no prompt block and the agent investigates as before.

const (
	// topoBudget bounds the whole snapshot (datasource list + two instant
	// queries, or one Graphiti facts search). Fail-open, like the alert-rule
	// snapshot: a slow store costs the user latency for no benefit.
	topoBudget = 3 * time.Second

	// topoCacheTTL bounds staleness of a successful per-org snapshot. Service
	// graphs move slowly; NOC re-investigations of the same alert within
	// minutes (see alert_rule_snapshot.go) must not re-query at all.
	topoCacheTTL = 5 * time.Minute

	// topoMissTTL caches misses so an org without service-graph metrics does
	// not pay the fetch on every run, while still retrying soon after a new
	// deployment starts emitting them.
	topoMissTTL = 1 * time.Minute

	// topoMaxEdges caps the rendered edge list (~1.5k tokens).
	topoMaxEdges = 40

	// topoMinRPS drops near-zero-traffic edges — sampler noise, not real
	// dependencies.
	topoMinRPS = 0.01

	// graphitiFallbackMaxFacts bounds the Graphiti facts search when the
	// service-graph metrics are unavailable.
	graphitiFallbackMaxFacts = 60
)

// The Tempo metrics-generator emits service-graph edges as client/server
// counters; rate over 5m per pair is the dependency signal.
const (
	topoTotalQuery  = `sum by (client, server) (rate(traces_service_graph_request_total[5m]))`
	topoFailedQuery = `sum by (client, server) (rate(traces_service_graph_request_failed_total[5m]))`
)

// serviceGraphQueryArgs builds the query_prometheus arguments for one instant
// query. Both current and legacy field names are sent: mcp-grafana renamed
// query->expr and uid->datasourceUid across versions, and unknown JSON fields
// are ignored by either generation.
func serviceGraphQueryArgs(expr, promUID string) map[string]interface{} {
	return map[string]interface{}{
		"query":         expr,
		"expr":          expr,
		"uid":           promUID,
		"datasourceUid": promUID,
		"startTime":     "now-10m",
		"endTime":       "now",
		"queryType":     "instant",
	}
}

// serviceGraphEdge is one directed dependency with live traffic.
type serviceGraphEdge struct {
	client  string
	server  string
	rps     float64
	errRate float64 // 0..1, only meaningful when failedSeen
	failed  bool
}

type prometheusVector struct {
	Data []struct {
		Metric map[string]string `json:"metric"`
		Value  []any             `json:"value"`
	} `json:"data"`
}

// parseServiceGraphSamples decodes an mcp-grafana query_prometheus result
// (instant vector rendered as JSON: {"data":[{"metric":{...},"value":[ts,"v"]}]}).
// Anything unexpected — a scalar, a range response, non-JSON text from an
// older server — yields nil and the caller falls back.
func parseServiceGraphSamples(raw string) []serviceGraphEdge {
	var parsed prometheusVector
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return nil
	}
	edges := make([]serviceGraphEdge, 0, len(parsed.Data))
	for _, sample := range parsed.Data {
		client, server := servicePair(sample.Metric)
		if client == "" || server == "" || len(sample.Value) < 2 {
			continue
		}
		valStr, ok := sample.Value[1].(string)
		if !ok {
			continue
		}
		val, err := strconv.ParseFloat(valStr, 64)
		if err != nil {
			continue
		}
		edges = append(edges, serviceGraphEdge{client: client, server: server, rps: val})
	}
	return edges
}

// servicePair extracts the endpoint labels, accepting both the standard
// client/server names and the client_service/server_service variant.
func servicePair(metric map[string]string) (string, string) {
	client, ok := metric["client"]
	if !ok || client == "" {
		client = metric["client_service"]
	}
	server, ok := metric["server"]
	if !ok || server == "" {
		server = metric["server_service"]
	}
	return client, server
}

// mergeServiceGraphFailures folds failed-request rates into the total-rate
// edges by client/server pair.
func mergeServiceGraphFailures(edges []serviceGraphEdge, failures []serviceGraphEdge) {
	failedByPair := make(map[string]float64, len(failures))
	for _, f := range failures {
		failedByPair[f.client+"\x00"+f.server] = f.rps
	}
	for i := range edges {
		if failed, ok := failedByPair[edges[i].client+"\x00"+edges[i].server]; ok && edges[i].rps > 0 {
			edges[i].errRate = failed / edges[i].rps
			edges[i].failed = true
		}
	}
}

// scopeServiceGraph keeps only edges touching the alert's service (its 1-hop
// neighborhood). If the service name matches nothing — label conventions
// differ — the unfiltered list is more useful than an empty one.
func scopeServiceGraph(edges []serviceGraphEdge, service string) []serviceGraphEdge {
	if service == "" {
		return edges
	}
	var scoped []serviceGraphEdge
	for _, e := range edges {
		if e.client == service || e.server == service {
			scoped = append(scoped, e)
		}
	}
	if len(scoped) > 0 {
		return scoped
	}
	return edges
}

// renderServiceTopology renders the compact edge list injected into the
// prompt. Edges sort by traffic; only meaningful edges survive the floor
// and the cap.
func renderServiceTopology(edges []serviceGraphEdge) string {
	sort.SliceStable(edges, func(i, j int) bool { return edges[i].rps > edges[j].rps })
	var kept []serviceGraphEdge
	for _, e := range edges {
		if e.rps < topoMinRPS {
			break
		}
		kept = append(kept, e)
		if len(kept) >= topoMaxEdges {
			break
		}
	}
	if len(kept) == 0 {
		return ""
	}

	var b strings.Builder
	b.WriteString("Directed dependencies, most traffic first:\n")
	for _, e := range kept {
		if e.failed {
			fmt.Fprintf(&b, "%s -> %s (rps %.2f, err %.1f%%)\n", e.client, e.server, e.rps, e.errRate*100)
		} else {
			fmt.Fprintf(&b, "%s -> %s (rps %.2f)\n", e.client, e.server, e.rps)
		}
	}
	b.WriteString("\nTreat these edges as authoritative for propagation paths: a plausible path must follow them. Do not invent dependencies not listed here.")
	return b.String()
}

// renderGraphitiTopology renders the fallback edge list from Graphiti facts.
func renderGraphitiTopology(edges []TopologyEdge) string {
	if len(edges) == 0 {
		return ""
	}
	if len(edges) > topoMaxEdges {
		edges = edges[:topoMaxEdges]
	}
	var b strings.Builder
	b.WriteString("Known dependencies (from the organization knowledge graph; no live traffic rates):\n")
	for _, e := range edges {
		fmt.Fprintf(&b, "%s -> %s\n", e.Source, e.Target)
	}
	b.WriteString("\nTreat these edges as candidate dependencies to verify with live data. Do not invent dependencies not listed here.")
	return b.String()
}

// topoServiceLabelRe matches the service label in an alert-rule snapshot's
// rendered Labels section (`service="checkout"`) and in PromQL label
// matchers. It is a hint only: the snapshot falls back to the unfiltered
// graph when the name matches nothing.
var topoServiceLabelRe = regexp.MustCompile(`service(?:_name)?="([^"]+)"`)

func extractServiceLabelFromSnapshot(alertSnapshot string) string {
	if alertSnapshot == "" {
		return ""
	}
	m := topoServiceLabelRe.FindStringSubmatch(alertSnapshot)
	if m == nil {
		return ""
	}
	return strings.TrimSpace(m[1])
}

// topologySnapshot returns the prefetched topology block for an RCA run:
// the live Tempo service graph when queryable, Graphiti facts otherwise.
// Cached per org; empty string renders no prompt block.
func (p *Plugin) topologySnapshot(alertSnapshot, orgID, orgName, scopeOrgID string) string {
	cacheKey := orgID
	if snap, ok := p.lookupTopologyCache(cacheKey); ok {
		return snap
	}

	snapshot := p.fetchTopologySnapshot(alertSnapshot, orgID, orgName, scopeOrgID)

	ttl := topoCacheTTL
	if snapshot == "" {
		ttl = topoMissTTL
	}
	p.storeTopologyCache(cacheKey, snapshot, ttl)
	return snapshot
}

func (p *Plugin) fetchTopologySnapshot(alertSnapshot, orgID, orgName, scopeOrgID string) string {
	if p.mcpProxy == nil {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), topoBudget)
	defer cancel()

	if edges := p.fetchServiceGraphEdges(ctx, orgID, orgName, scopeOrgID); len(edges) > 0 {
		edges = scopeServiceGraph(edges, extractServiceLabelFromSnapshot(alertSnapshot))
		if rendered := renderServiceTopology(edges); rendered != "" {
			return rendered
		}
	}
	if ctx.Err() != nil {
		return ""
	}
	return p.fetchGraphitiTopology(ctx, orgID, orgName, scopeOrgID)
}

// fetchServiceGraphEdges resolves the Prometheus datasource and runs the two
// service-graph instant queries.
func (p *Plugin) fetchServiceGraphEdges(ctx context.Context, orgID, orgName, scopeOrgID string) []serviceGraphEdge {
	queryTool, ok := p.findQueryPrometheusTool()
	if !ok {
		return nil
	}
	uid := p.findPrometheusDatasourceUID(ctx, orgID, orgName, scopeOrgID)

	totalResult, err := p.callToolStandalone(ctx, queryTool, serviceGraphQueryArgs(topoTotalQuery, uid), orgID, orgName, scopeOrgID)
	if err != nil || totalResult == nil || totalResult.IsError || len(totalResult.Content) == 0 {
		p.logger.Warn("topologySnapshot: service graph query failed", "error", err)
		return nil
	}
	edges := parseServiceGraphSamples(totalResult.Content[0].Text)
	if len(edges) == 0 {
		return nil
	}

	failedResult, err := p.callToolStandalone(ctx, queryTool, serviceGraphQueryArgs(topoFailedQuery, uid), orgID, orgName, scopeOrgID)
	if err == nil && failedResult != nil && !failedResult.IsError && len(failedResult.Content) > 0 {
		mergeServiceGraphFailures(edges, parseServiceGraphSamples(failedResult.Content[0].Text))
	}
	return edges
}

// fetchGraphitiTopology renders the Graphiti fallback when the service graph
// metrics are absent (no metrics-generator, no Tempo integration yet).
func (p *Plugin) fetchGraphitiTopology(ctx context.Context, orgID, orgName, scopeOrgID string) string {
	tools, err := p.mcpProxy.ListTools()
	if err != nil {
		return ""
	}
	toolName := findGraphitiSearchFactsTool(tools)
	if toolName == "" {
		return ""
	}
	orgIDInt, err := strconv.ParseInt(orgID, 10, 64)
	if err != nil {
		return ""
	}
	result, err := p.mcpProxy.CallToolWithContext(
		ctx,
		toolName,
		graphitiSearchFactsArgs(tools, toolName, orgIDInt, graphitiTopologyFactQuery(), graphitiFallbackMaxFacts),
		orgID, orgName, scopeOrgID,
	)
	if err != nil || result == nil || len(result.Content) == 0 {
		p.logger.Warn("topologySnapshot: graphiti facts search failed", "error", err)
		return ""
	}
	body := graphitiToolBody(result)
	if body == "" {
		return ""
	}
	return renderGraphitiTopology(parseGraphitiTopology(body).Edges)
}

func (p *Plugin) findQueryPrometheusTool() (string, bool) {
	tools, err := p.mcpProxy.ListTools()
	if err != nil {
		return "", false
	}
	for _, t := range tools {
		parts := strings.SplitN(t.Name, "_", 2)
		if len(parts) == 2 && parts[1] == "query_prometheus" {
			return t.Name, true
		}
	}
	return "", false
}

// findPrometheusDatasourceUID picks the Prometheus datasource for the service
// graph queries via the standard list tool. Empty string lets the MCP server
// use its default datasource.
func (p *Plugin) findPrometheusDatasourceUID(ctx context.Context, orgID, orgName, scopeOrgID string) string {
	dsTool, ok := p.findDatasourceListTool()
	if !ok {
		return ""
	}
	result, err := p.callToolStandalone(ctx, dsTool, map[string]interface{}{}, orgID, orgName, scopeOrgID)
	if err != nil || result == nil || result.IsError || len(result.Content) == 0 {
		return ""
	}
	for _, row := range parseDatasourceRows(result.Content[0].Text) {
		if strings.Contains(strings.ToLower(row.dsType), "prometheus") {
			return row.uid
		}
	}
	return ""
}

func (p *Plugin) lookupTopologyCache(key string) (string, bool) {
	p.topoCacheMu.Lock()
	defer p.topoCacheMu.Unlock()
	entry, ok := p.topoCache[key]
	if !ok {
		return "", false
	}
	if time.Since(entry.fetchedAt) > entry.ttl {
		delete(p.topoCache, key)
		return "", false
	}
	return entry.snapshot, true
}

func (p *Plugin) storeTopologyCache(key, snapshot string, ttl time.Duration) {
	p.topoCacheMu.Lock()
	defer p.topoCacheMu.Unlock()
	if p.topoCache == nil {
		p.topoCache = make(map[string]dsCacheEntry)
	}
	p.topoCache[key] = dsCacheEntry{snapshot: snapshot, fetchedAt: time.Now(), ttl: ttl}
}
