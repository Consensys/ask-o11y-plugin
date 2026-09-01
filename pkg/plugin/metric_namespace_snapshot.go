package plugin

import (
	"consensys-asko11y-app/pkg/mcp"
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	// msCacheTTL bounds staleness of the per-org metric-namespace snapshot.
	// Metric catalogs change far less often than the fetch is expensive, so
	// this is much longer than dsCacheTTL.
	msCacheTTL = 15 * time.Minute

	// msFetchTimeout bounds a single list_prometheus_metric_names call in the
	// background refresh. Production traces (2026-09-01) showed this tool
	// taking 20-30s on a broad regex; give it real room since this runs off
	// the request path, not the 2s fail-open budget datasourceSnapshot uses.
	msFetchTimeout = 45 * time.Second

	// msFetchLimit is the page size requested per datasource. Large enough to
	// cover real-world catalogs in one page (a sampled production datasource
	// had 4,622 metric names) without needing pagination for a best-effort
	// namespace hint.
	msFetchLimit = 5000

	// msMaxNamespacesPerDatasource caps how many namespace bullets are
	// rendered per datasource, keeping the whole snapshot at a few KB instead
	// of the ~35-50K tokens a full per-metric listing would cost (measured
	// against a real datasource — see the PR this shipped in).
	msMaxNamespacesPerDatasource = 40
)

// metricNamespaceSnapshot returns a compact list of metric-name namespaces
// (prefixes, not full names) per Prometheus-type datasource, to inject into
// the system prompt for alert investigations so the agent can build a
// targeted regex on its first list_prometheus_metric_names call instead of
// guessing blind across several datasources and regex attempts — the pattern
// that dominated tool-call time in production traces.
//
// Unlike datasourceSnapshot, this never blocks the request: the underlying
// fetch (one list_prometheus_metric_names call per Prometheus datasource) can
// take 20-30s each, far past any budget worth making a user wait on. A cache
// hit returns immediately; a miss returns "" for this request and kicks off
// a background refresh (deduplicated via msInFlight) so the next request
// within msCacheTTL gets the real snapshot.
func (p *Plugin) metricNamespaceSnapshot(orgID, orgName, scopeOrgID string) string {
	cacheKey := orgID
	if cacheKey == "" {
		cacheKey = orgName
	}
	if cacheKey == "" {
		cacheKey = "__default__"
	}

	if snap, ok := p.lookupMetricNamespaceCache(cacheKey); ok {
		return snap
	}

	p.msCacheMu.Lock()
	if p.msInFlight == nil {
		p.msInFlight = make(map[string]bool)
	}
	alreadyRefreshing := p.msInFlight[cacheKey]
	if !alreadyRefreshing {
		p.msInFlight[cacheKey] = true
	}
	p.msCacheMu.Unlock()

	if !alreadyRefreshing {
		go p.refreshMetricNamespaceSnapshot(cacheKey, orgID, orgName, scopeOrgID)
	}
	return ""
}

func (p *Plugin) refreshMetricNamespaceSnapshot(cacheKey, orgID, orgName, scopeOrgID string) {
	defer func() {
		p.msCacheMu.Lock()
		delete(p.msInFlight, cacheKey)
		p.msCacheMu.Unlock()
	}()

	ctx := context.Background()

	toolName, ok := p.findMetricNamesListTool()
	if !ok {
		return
	}
	dsToolName, ok := p.findDatasourceListTool()
	if !ok {
		return
	}

	dsResult, err := p.callToolStandalone(ctx, dsToolName, map[string]interface{}{}, orgID, orgName, scopeOrgID)
	if err != nil || dsResult == nil || dsResult.IsError || len(dsResult.Content) == 0 {
		p.logger.Warn("metricNamespaceSnapshot: list_datasources failed", "orgID", orgID)
		return
	}

	rows := parseDatasourceRows(dsResult.Content[0].Text)
	var promRows []datasourceRow
	for _, r := range rows {
		if r.dsType == "prometheus" {
			promRows = append(promRows, r)
		}
	}
	if len(promRows) == 0 {
		return
	}

	sections := make(map[string][]string, len(promRows))
	for _, r := range promRows {
		names := p.fetchMetricNames(ctx, toolName, r.uid, orgID, orgName, scopeOrgID)
		if len(names) > 0 {
			sections[r.uid] = names
		}
	}
	if len(sections) == 0 {
		return
	}

	snapshot := renderMetricNamespaceSnapshot(promRows, sections)
	p.storeMetricNamespaceCache(cacheKey, snapshot)
}

func (p *Plugin) fetchMetricNames(ctx context.Context, toolName, datasourceUID, orgID, orgName, scopeOrgID string) []string {
	callCtx, cancel := context.WithTimeout(ctx, msFetchTimeout)
	defer cancel()

	result, err := p.callToolStandalone(callCtx, toolName, map[string]interface{}{
		"datasourceUid": datasourceUID,
		"regex":         ".*",
		"limit":         msFetchLimit,
	}, orgID, orgName, scopeOrgID)
	if err != nil || result == nil || result.IsError || len(result.Content) == 0 {
		p.logger.Warn("metricNamespaceSnapshot: list_prometheus_metric_names failed", "datasourceUid", datasourceUID, "error", err)
		return nil
	}

	var names []string
	if err := json.Unmarshal([]byte(result.Content[0].Text), &names); err != nil {
		return nil
	}
	return names
}

// callToolStandalone calls toolName via a fresh, standalone Client for its
// server (see mcp.Proxy.NewStandaloneClient) instead of the shared pool.
// The background metric-namespace refresh runs concurrently with whatever
// live agent-loop tool calls the request that triggered it is making on the
// same server; routing through the shared pool would let either side's
// connectMCPWithOrgContext (which tears down and replaces the session on
// every org-context call, by design) close the session out from under the
// other's in-flight call.
func (p *Plugin) callToolStandalone(ctx context.Context, toolName string, arguments map[string]interface{}, orgID, orgName, scopeOrgID string) (*mcp.CallToolResult, error) {
	serverID, _, ok := strings.Cut(toolName, "_")
	if !ok {
		return nil, fmt.Errorf("invalid tool name %q: expected serverid_toolname", toolName)
	}
	client, ok := p.mcpProxy.NewStandaloneClient(serverID)
	if !ok {
		return nil, fmt.Errorf("no MCP client registered for server %q", serverID)
	}
	defer client.Close()

	return client.CallToolWithContext(ctx, toolName, arguments, orgID, orgName, scopeOrgID)
}

// deriveNamespaces buckets metric names by their first one or two
// underscore-delimited segments (e.g. "aws_applicationelb_request_count_sum"
// -> "aws_applicationelb"), counting how many metrics share each bucket.
func deriveNamespaces(names []string) map[string]int {
	counts := make(map[string]int)
	for _, name := range names {
		segments := strings.Split(name, "_")
		n := 2
		if len(segments) < 2 {
			n = len(segments)
		}
		prefix := strings.Join(segments[:n], "_")
		if prefix == "" {
			continue
		}
		counts[prefix]++
	}
	return counts
}

// renderMetricNamespaceSnapshot renders one section per datasource: a header
// naming the datasource and its total metric count, then up to
// msMaxNamespacesPerDatasource namespace bullets sorted alphabetically.
func renderMetricNamespaceSnapshot(rows []datasourceRow, namesByUID map[string][]string) string {
	nameByUID := make(map[string]string, len(rows))
	for _, r := range rows {
		nameByUID[r.uid] = r.name
	}

	uids := make([]string, 0, len(namesByUID))
	for uid := range namesByUID {
		uids = append(uids, uid)
	}
	sort.Strings(uids)

	var b strings.Builder
	for _, uid := range uids {
		names := namesByUID[uid]
		counts := deriveNamespaces(names)

		prefixes := make([]string, 0, len(counts))
		for prefix := range counts {
			prefixes = append(prefixes, prefix)
		}
		sort.Strings(prefixes)
		if len(prefixes) > msMaxNamespacesPerDatasource {
			prefixes = prefixes[:msMaxNamespacesPerDatasource]
		}

		fmt.Fprintf(&b, "Datasource %s (uid=%s), %d total metrics:\n", nameByUID[uid], uid, len(names))
		for _, prefix := range prefixes {
			fmt.Fprintf(&b, "- %s_* (%d)\n", prefix, counts[prefix])
		}
	}
	return strings.TrimRight(b.String(), "\n")
}

// findMetricNamesListTool searches all registered MCP servers for a tool
// whose base name (the part after the server-id prefix) is
// "list_prometheus_metric_names" — mirrors findDatasourceListTool.
func (p *Plugin) findMetricNamesListTool() (string, bool) {
	tools, err := p.mcpProxy.ListTools()
	if err != nil {
		return "", false
	}
	for _, t := range tools {
		parts := strings.SplitN(t.Name, "_", 2)
		if len(parts) == 2 && parts[1] == "list_prometheus_metric_names" {
			return t.Name, true
		}
	}
	return "", false
}

func (p *Plugin) lookupMetricNamespaceCache(key string) (string, bool) {
	p.msCacheMu.Lock()
	defer p.msCacheMu.Unlock()
	if p.msCache == nil {
		return "", false
	}
	entry, ok := p.msCache[key]
	if !ok {
		return "", false
	}
	ttl := entry.ttl
	if ttl <= 0 {
		ttl = msCacheTTL
	}
	if time.Since(entry.fetchedAt) > ttl {
		return "", false
	}
	return entry.snapshot, true
}

func (p *Plugin) storeMetricNamespaceCache(key, snapshot string) {
	p.msCacheMu.Lock()
	defer p.msCacheMu.Unlock()
	if p.msCache == nil {
		p.msCache = make(map[string]dsCacheEntry)
	}
	p.msCache[key] = dsCacheEntry{snapshot: snapshot, fetchedAt: time.Now(), ttl: msCacheTTL}
}
