package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Alert-rule snapshot: a server-side prefetch of the alert rule behind an
// investigation, injected into the system prompt so the agent starts at
// "query the affected metrics" instead of burning 3-6 discovery turns
// finding the rule and guessing metric names.
//
// Design constraints, all learned from production censuses (Sep 2026):
//   - Textual hints (the metric-namespace snapshot) measurably do NOT change
//     agent behavior — only exact values do. So this block carries the rule's
//     real expressions, exact metric names, and label matchers.
//   - label_selectors on alerting_manage_rules matches rule LABELS only, and
//     ruler rules do not carry an alertname label (the rule name IS the
//     alertname) — so rule lookup must match by title client-side, here.
//   - search_rule_name is dropped by mcp-grafana 1.3.0 on the datasource path
//     (fixed client-side in 1.4.0 / PR #1161). Passing it is harmless on both
//     and shrinks internal payloads on 1.4.0; on 1.3.0 this code filters by
//     title itself, so correctness never depends on the server version.
//   - Fail open, always: any error, timeout, or oversized match set renders no
//     block and the agent falls back to its documented discovery workflow.

const (
	// arBudget bounds the whole synchronous prefetch. Individual list calls
	// measured 0.2-0.4s in production traces (Sep 2026); a handful of them
	// plus one detail call fits comfortably. Past the budget we ship whatever
	// matched so far, or nothing.
	arBudget = 5 * time.Second

	// arCacheTTL memoises a successful snapshot across rapid re-runs of the
	// same alert (NOC re-investigates the same alert within minutes).
	arCacheTTL = 90 * time.Second

	// arMissTTL negatively caches "no rule found" so a burst of re-runs for a
	// rule that lives somewhere we did not look does not re-fetch each time.
	arMissTTL = 30 * time.Second

	// arMaxRules caps how many matched rules are rendered. More than a couple
	// usually means a title match too loose to be authoritative.
	arMaxRules = 3

	// arMaxDatasources caps how many datasource-managed rule lists are fetched.
	arMaxDatasources = 8

	// arMaxMetrics / arMaxMatchers cap extraction per rule; arMaxExprChars
	// truncates each rendered expression line.
	arMaxMetrics   = 20
	arMaxMatchers  = 12
	arMaxExprChars = 300

	// arMaxLabels / arMaxAnnotations cap the rendered identity metadata.
	arMaxLabels      = 8
	arMaxAnnotations = 6
	arMaxAnnotChars  = 200
)

// alertRuleSummaryJSON mirrors the JSON shape mcp-grafana's
// alerting_manage_rules 'list' operation returns per rule (tools/
// alerting_manage_rules_types.go alertRuleSummary). Kept local so the plugin
// does not depend on the mcp-grafana module.
type alertRuleSummaryJSON struct {
	UID            string            `json:"uid"`
	Title          string            `json:"title"`
	Type           string            `json:"type,omitempty"`
	State          string            `json:"state,omitempty"`
	Health         string            `json:"health,omitempty"`
	FolderUID      string            `json:"folder_uid,omitempty"`
	RuleGroup      string            `json:"rule_group,omitempty"`
	For            string            `json:"for,omitempty"`
	LastEvaluation string            `json:"last_evaluation,omitempty"`
	Labels         map[string]string `json:"labels,omitempty"`
	Annotations    map[string]string `json:"annotations,omitempty"`
	// Query is the rule expression. Populated for datasource-managed rules
	// (Prometheus / Mimir / Loki ruler responses); empty for Grafana-managed
	// rules, whose expressions are fetched via a follow-up 'get'.
	Query string `json:"query,omitempty"`
}

// alertRuleQuery is one executable expression from a rule, with the
// datasource it runs against and the metrics/matchers extracted from it.
type alertRuleQuery struct {
	datasourceUID string
	expr          string
	metrics       []string
	matchers      []string
}

// alertRuleData is the normalized snapshot of one matched alert rule.
type alertRuleData struct {
	title, uid, ruleType, group, folder, state, health, forDur, lastEval, dsUID string
	labels, annotations                                                         map[string]string
	queries                                                                     []alertRuleQuery
}

// mcpMatcherRe extracts label matcher assignments from a selector block.
var mcpMatcherRe = regexp.MustCompile(`([a-zA-Z_][a-zA-Z0-9_]*)\s*(=~|!~|!=|=)\s*"([^"]*)"`)

// mcpQuotedStr strips double-quoted strings so identifiers inside label
// values (e.g. foo{bar="baz_x"}) are not mistaken for metric names.
var mcpQuotedStr = regexp.MustCompile(`"(\\.|[^"\\])*"`)

// mcpKeywords are PromQL/LogQL words that must never be reported as metrics.
// Aggregation operators (sum/avg/...) are included even though they are
// usually followed by "(" (the function check), because they also appear
// pre-grouping: "sum by (x) (...)".
var mcpKeywords = map[string]bool{
	"by": true, "without": true, "on": true, "ignoring": true,
	"group_left": true, "group_right": true, "offset": true, "bool": true,
	"and": true, "or": true, "unless": true, "if": true,
	"start": true, "end": true,
	"sum": true, "avg": true, "min": true, "max": true, "count": true,
	"group": true, "stddev": true, "stdvar": true, "count_values": true,
	"bottomk": true, "topk": true, "quantile": true,
}

// mcpGroupingKeywords are the keywords whose parenthesized argument lists
// contain label names, not metrics: "by (...)", "without (...)",
// "on (...)", "ignoring (...)".
var mcpGroupingKeywords = map[string]bool{
	"by": true, "without": true, "on": true, "ignoring": true,
	"group_left": true, "group_right": true,
}

// extractAlertNameForSnapshot pulls the alert rule name out of an
// investigation request message. Handles the deep-link contract
// ("alertName:X"), explicit alertname= occurrences in pasted notifications,
// and identifier-like [FIRING:n] titles. Returns "" when nothing reliable
// is found — the caller then skips the prefetch.
func extractAlertNameForSnapshot(message string) string {
	msg := strings.TrimSpace(message)
	if msg == "" {
		return ""
	}

	// 1. Deep-link prefix form: "alertName:Foo Bar" (case-insensitive trim).
	//    Skipped when what follows looks like a notification header, not a name.
	if trimmed := trimCaseInsensitivePrefix(msg, "alertname:", "alert:"); trimmed != msg {
		trimmed = strings.TrimSpace(trimmed)
		if trimmed != "" && !strings.HasPrefix(trimmed, "[FIRING") {
			return trimmed
		}
	}

	// 2. Explicit alertname= / alertname: occurrences anywhere in the message
	//    (alertmanager/Opsgenie notification bodies). Quoted values may
	//    contain spaces; unquoted ones may not.
	for _, m := range alertnameRe.FindAllStringSubmatch(msg, -1) {
		if name := strings.TrimSpace(m[1] + m[2]); name != "" {
			return name
		}
	}

	// 3. [FIRING:n] header — only usable when the title is a bare identifier
	//    ending the line (rule names rarely contain spaces; Opsgenie display
	//    names often do, and those would never match a rule title exactly
	//    anyway).
	if idx := strings.IndexByte(msg, '\n'); idx >= 0 {
		msg = msg[:idx]
	}
	if m := firingTitleRe.FindStringSubmatch(msg); m != nil {
		return m[1]
	}

	return ""
}

var (
	// alertnameRe matches alertname="some value" / alertname=value /
	// alertname: value, capturing the quoted form in group 1 and the bare
	// identifier form in group 2.
	alertnameRe = regexp.MustCompile(`(?i)\balertname\s*[=:]\s*(?:"([^"]+)"|([A-Za-z0-9_.\-/]+))`)
	// firingTitleRe captures an identifier-like title right after [FIRING:n],
	// anchored to the line end so multi-word display names don't partially match.
	firingTitleRe = regexp.MustCompile(`(?i)\[FIRING:\d+\]\s*([A-Za-z0-9_.\-/]+)$`)
)

// alertRuleSnapshot renders the prefetched alert-rule context block, or ""
// when the prefetch found nothing usable (fail open).
func (p *Plugin) alertRuleSnapshot(alertName, orgID, orgName, scopeOrgID string) string {
	cacheKey := orgID + "\x00" + alertName
	if snap, ok := p.lookupAlertRuleCache(cacheKey); ok {
		return snap
	}

	snapshot := p.fetchAlertRuleSnapshot(alertName, orgID, orgName, scopeOrgID)

	ttl := arCacheTTL
	if snapshot == "" {
		ttl = arMissTTL
	}
	p.storeAlertRuleCache(cacheKey, snapshot, ttl)
	return snapshot
}

func (p *Plugin) fetchAlertRuleSnapshot(alertName, orgID, orgName, scopeOrgID string) string {
	if p.mcpProxy == nil {
		return ""
	}
	rulesTool, ok := p.findAlertingRulesTool()
	if !ok {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), arBudget)
	defer cancel()

	var matched []alertRuleData

	// Grafana-managed rules: one list over all folders, filtered by title here.
	managed, ok := p.listManagedAlertRules(ctx, rulesTool, alertName, orgID, orgName, scopeOrgID)
	if !ok {
		managed = nil // tool failed or budget blown — fall through to datasource path
	}
	matched = append(matched, managed...)

	// Datasource-managed (ruler) rules: one list per Prometheus/Loki datasource.
	if ctx.Err() == nil {
		matched = append(matched, p.listDatasourceAlertRules(ctx, rulesTool, alertName, orgID, orgName, scopeOrgID)...)
	}

	if len(matched) == 0 {
		return ""
	}
	if len(matched) > arMaxRules {
		matched = matched[:arMaxRules]
	}

	// Grafana-managed rule summaries carry no expressions — fetch full detail
	// while budget remains.
	p.hydrateManagedQueries(ctx, rulesTool, matched, orgID, orgName, scopeOrgID)

	return renderAlertRuleSnapshot(alertName, matched)
}

// alertRuleTitleMatches reports whether a rule title corresponds to an
// alertname: exact case-insensitive match, or containment when unambiguous.
func alertRuleTitleMatches(title, alertName string) bool {
	t, a := strings.ToLower(strings.TrimSpace(title)), strings.ToLower(strings.TrimSpace(alertName))
	if t == "" || a == "" {
		return false
	}
	if t == a {
		return true
	}
	// Containment only when the alert name is long enough to be specific.
	if len(a) >= 8 && strings.Contains(t, a) {
		return true
	}
	return false
}

func (p *Plugin) listManagedAlertRules(ctx context.Context, toolName, alertName, orgID, orgName, scopeOrgID string) ([]alertRuleData, bool) {
	result, err := p.callToolStandalone(ctx, toolName, map[string]interface{}{
		"operation": "list",
	}, orgID, orgName, scopeOrgID)
	if err != nil || result == nil || result.IsError || len(result.Content) == 0 {
		p.logger.Warn("alertRuleSnapshot: managed rules list failed", "error", err)
		return nil, false
	}
	var summaries []alertRuleSummaryJSON
	if err := json.Unmarshal([]byte(result.Content[0].Text), &summaries); err != nil {
		p.logger.Warn("alertRuleSnapshot: cannot parse managed rules list", "error", err)
		return nil, false
	}
	var out []alertRuleData
	for _, s := range summaries {
		if alertRuleTitleMatches(s.Title, alertName) {
			out = append(out, alertRuleDataFromSummary(s, ""))
			if len(out) >= arMaxRules {
				break
			}
		}
	}
	return out, true
}

func (p *Plugin) listDatasourceAlertRules(ctx context.Context, rulesTool, alertName, orgID, orgName, scopeOrgID string) []alertRuleData {
	dsTool, ok := p.findDatasourceListTool()
	if !ok {
		return nil
	}
	dsResult, err := p.callToolStandalone(ctx, dsTool, map[string]interface{}{}, orgID, orgName, scopeOrgID)
	if err != nil || dsResult == nil || dsResult.IsError || len(dsResult.Content) == 0 {
		p.logger.Warn("alertRuleSnapshot: list_datasources failed", "error", err)
		return nil
	}

	var out []alertRuleData
	fetched := 0
	for _, r := range parseDatasourceRows(dsResult.Content[0].Text) {
		if !isRulerDatasourceType(r.dsType) {
			continue
		}
		if fetched >= arMaxDatasources || ctx.Err() != nil {
			break
		}
		fetched++
		result, err := p.callToolStandalone(ctx, rulesTool, map[string]interface{}{
			"operation":        "list",
			"datasource_uid":   r.uid,
			"search_rule_name": alertName, // honored client-side on 1.4.0, ignored on 1.3.0
		}, orgID, orgName, scopeOrgID)
		if err != nil || result == nil || result.IsError || len(result.Content) == 0 {
			continue
		}
		var summaries []alertRuleSummaryJSON
		if err := json.Unmarshal([]byte(result.Content[0].Text), &summaries); err != nil {
			continue
		}
		for _, s := range summaries {
			if alertRuleTitleMatches(s.Title, alertName) {
				out = append(out, alertRuleDataFromSummary(s, r.uid))
				if len(out) >= arMaxRules {
					return out
				}
			}
		}
	}
	return out
}

// hydrateManagedQueries fills in expressions for Grafana-managed rules, whose
// list summaries carry no query — a 'get' per rule returns the full query
// nodes. Best effort: rules left without expressions render identity-only.
func (p *Plugin) hydrateManagedQueries(ctx context.Context, toolName string, rules []alertRuleData, orgID, orgName, scopeOrgID string) {
	for i := range rules {
		if ctx.Err() != nil {
			return
		}
		r := &rules[i]
		if len(r.queries) > 0 || r.uid == "" {
			continue
		}
		result, err := p.callToolStandalone(ctx, toolName, map[string]interface{}{
			"operation": "get",
			"rule_uid":  r.uid,
		}, orgID, orgName, scopeOrgID)
		if err != nil || result == nil || result.IsError || len(result.Content) == 0 {
			continue
		}
		var detail struct {
			Data []struct {
				// DatasourceUID stays raw: recent Grafana versions send either
				// "uid" or {"type":"prometheus","uid":"..."} here.
				DatasourceUID json.RawMessage        `json:"datasourceUid"`
				Model         map[string]interface{} `json:"model"`
			} `json:"data"`
		}
		if err := json.Unmarshal([]byte(result.Content[0].Text), &detail); err != nil {
			continue
		}
		for _, node := range detail.Data {
			expr, _ := node.Model["expr"].(string)
			dsUID := parseDatasourceRef(node.DatasourceUID)
			if expr == "" || dsUID == "" || dsUID == "__expr__" {
				continue
			}
			r.queries = append(r.queries, newAlertRuleQuery(dsUID, expr))
		}
	}
}

// parseDatasourceRef decodes a Grafana datasource reference that may be a
// bare UID string or a {type, uid} object (Grafana 11+ shape).
func parseDatasourceRef(raw json.RawMessage) string {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return ""
	}
	if strings.HasPrefix(trimmed, "\"") {
		var s string
		if err := json.Unmarshal(raw, &s); err == nil {
			return s
		}
		return ""
	}
	var obj struct {
		UID string `json:"uid"`
	}
	if err := json.Unmarshal(raw, &obj); err == nil {
		return obj.UID
	}
	return ""
}

func alertRuleDataFromSummary(s alertRuleSummaryJSON, dsUID string) alertRuleData {
	d := alertRuleData{
		title: s.Title, uid: s.UID, group: s.RuleGroup, folder: s.FolderUID,
		state: s.State, health: s.Health, forDur: s.For, lastEval: s.LastEvaluation,
		labels: s.Labels, annotations: s.Annotations, dsUID: dsUID,
	}
	if s.Type != "" {
		d.ruleType = s.Type
	} else {
		d.ruleType = "grafana-managed"
	}
	if s.Query != "" {
		d.queries = append(d.queries, newAlertRuleQuery(dsUID, s.Query))
	}
	return d
}

func newAlertRuleQuery(datasourceUID, expr string) alertRuleQuery {
	return alertRuleQuery{
		datasourceUID: datasourceUID,
		expr:          expr,
		metrics:       extractMetricNames(expr),
		matchers:      extractLabelMatchers(expr),
	}
}

// isRulerDatasourceType reports whether a datasource type exposes the ruler
// API (mirrors mcp-grafana's own check).
func isRulerDatasourceType(dsType string) bool {
	t := strings.ToLower(dsType)
	return strings.Contains(t, "prometheus") || strings.Contains(t, "loki")
}

// extractMetricNames pulls metric-name candidates from a PromQL/LogQL
// expression with a small scanner: identifiers are skipped inside {...}
// selector blocks (those are label names — see extractLabelMatchers), inside
// grouping clauses like "by (...)"/"without (...)", and when used
// function-style ("rate(...)"). Numbers and duration suffixes ([5m], 1h) are
// not identifiers. Quoted label values are ignored. This is heuristic
// context for the LLM, not validation.
func extractMetricNames(expr string) []string {
	if expr == "" {
		return nil
	}
	clean := mcpQuotedStr.ReplaceAllString(expr, `""`)

	isIdentStart := func(c byte) bool {
		return c == '_' || c == ':' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
	}
	isIdentChar := func(c byte) bool {
		return isIdentStart(c) || (c >= '0' && c <= '9')
	}

	var out []string
	seen := map[string]bool{}
	var parenGrouping []bool // per open paren: is it a by/without/on/ignoring clause?
	braceDepth := 0
	lastIdent := ""

	i := 0
	for i < len(clean) {
		switch c := clean[i]; {
		case c == '{':
			braceDepth++
			i++
		case c == '}':
			if braceDepth > 0 {
				braceDepth--
			}
			i++
		case c == '(':
			parenGrouping = append(parenGrouping, mcpGroupingKeywords[strings.ToLower(lastIdent)])
			i++
		case c == ')':
			if len(parenGrouping) > 0 {
				parenGrouping = parenGrouping[:len(parenGrouping)-1]
			}
			i++
		case c >= '0' && c <= '9':
			// Number, possibly a duration: swallow digits plus a trailing
			// unit suffix ([5m], 1h, 30s) so "m"/"s" never read as metrics.
			for i < len(clean) && clean[i] >= '0' && clean[i] <= '9' {
				i++
			}
			for i < len(clean) && isIdentChar(clean[i]) {
				i++
			}
		case isIdentStart(c):
			j := i + 1
			for j < len(clean) && isIdentChar(clean[j]) {
				j++
			}
			name := clean[i:j]
			i = j
			inGrouping := len(parenGrouping) > 0 && parenGrouping[len(parenGrouping)-1]
			if braceDepth == 0 && !inGrouping && !mcpKeywords[strings.ToLower(name)] {
				// Function-style usage: identifier immediately followed by "(".
				rest := strings.TrimLeft(clean[i:], " \t\n")
				if !strings.HasPrefix(rest, "(") && !seen[name] {
					seen[name] = true
					out = append(out, name)
				}
			}
			lastIdent = name
		default:
			i++
		}
	}
	if len(out) > arMaxMetrics {
		out = out[:arMaxMetrics]
	}
	return out
}

// extractLabelMatchers pulls label matcher assignments out of {...} selector
// blocks in a PromQL/LogQL expression.
func extractLabelMatchers(expr string) []string {
	if expr == "" {
		return nil
	}
	brace := regexp.MustCompile(`\{([^{}]*)\}`)
	var out []string
	seen := map[string]bool{}
	for _, m := range brace.FindAllStringSubmatch(expr, -1) {
		for _, mm := range mcpMatcherRe.FindAllStringSubmatch(m[1], -1) {
			token := mm[1] + mm[2] + `"` + mm[3] + `"`
			if !seen[token] {
				seen[token] = true
				out = append(out, token)
				if len(out) >= arMaxMatchers {
					return out
				}
			}
		}
	}
	return out
}

// renderAlertRuleSnapshot renders the system-prompt block. Keep it compact:
// production budget for the whole block is ~1.5k tokens.
func renderAlertRuleSnapshot(alertName string, rules []alertRuleData) string {
	var b strings.Builder
	if len(rules) == 1 {
		fmt.Fprintf(&b, "Alert rule %q (1 exact match found server-side):\n\n", alertName)
	} else {
		fmt.Fprintf(&b, "Alert rule %q (%d matching rules found server-side):\n\n", alertName, len(rules))
	}

	for i, r := range rules {
		if i > 0 {
			b.WriteString("\n")
		}
		origin := r.ruleType
		if r.dsUID != "" {
			origin = fmt.Sprintf("%s, datasource uid=%s", r.ruleType, r.dsUID)
		}
		fmt.Fprintf(&b, "### Rule: %s\n", r.title)
		fmt.Fprintf(&b, "- Type/origin: %s | uid=%s | group=%s | folder=%s\n", origin, orDash(r.uid), orDash(r.group), orDash(r.folder))
		if r.state != "" || r.forDur != "" {
			fmt.Fprintf(&b, "- State: %s | For: %s | Health: %s\n", orDash(r.state), orDash(r.forDur), orDash(r.health))
		}
		writeStringMap(&b, "Labels", r.labels, arMaxLabels)
		writeStringMap(&b, "Annotations", r.annotations, arMaxAnnotations, "runbook_url", "dashboard_uid", "dashboardUid", "summary")
		for _, q := range r.queries {
			fmt.Fprintf(&b, "- Query (datasource uid=%s):\n", orDash(q.datasourceUID))
			fmt.Fprintf(&b, "    expr: %s\n", truncateChars(q.expr, arMaxExprChars))
			if len(q.metrics) > 0 {
				fmt.Fprintf(&b, "    metrics: %s\n", strings.Join(q.metrics, ", "))
			}
			if len(q.matchers) > 0 {
				fmt.Fprintf(&b, "    label matchers: %s\n", strings.Join(q.matchers, ", "))
			}
		}
	}

	b.WriteString(`
This context was prefetched from the actual alert rule definition. Treat the
metric names, label matchers, and datasource UIDs above as authoritative:
use them directly in your first queries instead of discovering them. Do NOT
call alerting_manage_rules to re-find this rule. Do NOT call
list_prometheus_metric_names unless you need a metric that is not shown
here. If a runbook_url annotation is present, fetch and follow it before
broader exploration.`)
	return b.String()
}

func writeStringMap(b *strings.Builder, title string, m map[string]string, max int, priority ...string) {
	if len(m) == 0 {
		return
	}
	keys := make([]string, 0, len(m))
	taken := map[string]bool{}
	for _, p := range priority {
		if _, ok := m[p]; ok {
			keys = append(keys, p)
			taken[p] = true
		}
	}
	for k := range m {
		if !taken[k] {
			keys = append(keys, k)
		}
	}
	sortStrings(keys)
	if len(keys) > max {
		keys = keys[:max]
	}
	pairs := make([]string, 0, len(keys))
	for _, k := range keys {
		pairs = append(pairs, fmt.Sprintf(`%s="%s"`, k, truncateChars(m[k], arMaxAnnotChars)))
	}
	fmt.Fprintf(b, "- %s: %s\n", title, strings.Join(pairs, ", "))
}

func truncateChars(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}

func orDash(s string) string {
	if strings.TrimSpace(s) == "" {
		return "-"
	}
	return s
}

func sortStrings(s []string) {
	sort.Strings(s)
}

func (p *Plugin) findAlertingRulesTool() (string, bool) {
	tools, err := p.mcpProxy.ListTools()
	if err != nil {
		return "", false
	}
	for _, t := range tools {
		parts := strings.SplitN(t.Name, "_", 2)
		if len(parts) == 2 && parts[1] == "alerting_manage_rules" {
			return t.Name, true
		}
	}
	return "", false
}

func (p *Plugin) lookupAlertRuleCache(key string) (string, bool) {
	p.arCacheMu.Lock()
	defer p.arCacheMu.Unlock()
	if p.arCache == nil {
		return "", false
	}
	entry, ok := p.arCache[key]
	if !ok {
		return "", false
	}
	ttl := entry.ttl
	if ttl <= 0 {
		ttl = arCacheTTL
	}
	if time.Since(entry.fetchedAt) > ttl {
		return "", false
	}
	return entry.snapshot, true
}

func (p *Plugin) storeAlertRuleCache(key, snapshot string, ttl time.Duration) {
	p.arCacheMu.Lock()
	defer p.arCacheMu.Unlock()
	if p.arCache == nil {
		p.arCache = make(map[string]dsCacheEntry)
	}
	p.arCache[key] = dsCacheEntry{snapshot: snapshot, fetchedAt: time.Now(), ttl: ttl}
}
