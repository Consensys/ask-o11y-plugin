package plugin

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	// dsCacheTTL bounds staleness of the per-org datasource snapshot. UIDs
	// change rarely, and stale UIDs are still better than a hallucinated one.
	dsCacheTTL = 5 * time.Minute

	// dsCacheMaxOrgs caps the cache so a pathological flood of orgs can't
	// grow the map unbounded. Eviction is by oldest fetchedAt.
	dsCacheMaxOrgs = 256

	// dsSnapshotMaxEntries caps how many datasources we render into the prompt.
	// Real tenants have <= 40; anything more is almost certainly noise that
	// would just inflate the prompt and evict useful context.
	dsSnapshotMaxEntries = 40

	// dsMCPCallTimeout is the budget for calling list_datasources at session
	// start. A user-visible stall of more than ~2 s is worse than a missing
	// snapshot, so we fail-open fast.
	dsMCPCallTimeout = 2 * time.Second

	// dsCacheFailOpenTTL keeps fallback snapshots short-lived so we quickly
	// recover to real datasource UIDs once MCP is healthy again.
	dsCacheFailOpenTTL = 30 * time.Second

	dsSnapshotFailOpen = "⚠ Datasource snapshot unavailable for this run. You MUST call `list_datasources` before any datasource-bound query — never guess a UID."
)

type dsCacheEntry struct {
	snapshot  string
	fetchedAt time.Time
	ttl       time.Duration
}

// datasourceSnapshot returns a bullet-list of real datasource UIDs to inject
// into the system prompt so the LLM cannot hallucinate one. Results are
// cached per-org for dsCacheTTL. Failures always return dsSnapshotFailOpen
// rather than an empty string — the fail-open text itself reinforces the
// "call list_datasources" rule in the prompt.
func (p *Plugin) datasourceSnapshot(orgID, orgName, scopeOrgID string) string {
	cacheKey := orgID
	if cacheKey == "" {
		cacheKey = orgName
	}
	if cacheKey == "" {
		cacheKey = "__default__"
	}

	if snap, ok := p.lookupDatasourceCache(cacheKey); ok {
		return snap
	}

	// MCP proxy call is synchronous; wrap it in a goroutine + timer to enforce
	// the 2 s budget without blocking the user. If it times out we still cache
	// the fail-open answer for a shorter window (30 s) so we don't re-hammer
	// a dead sidecar on every request.
	done := make(chan string, 1)
	go func() {
		toolName, ok := p.findDatasourceListTool()
		if !ok {
			done <- dsSnapshotFailOpen
			return
		}
		result, err := p.mcpProxy.CallToolWithContext(toolName, map[string]interface{}{}, orgID, orgName, scopeOrgID)
		if err != nil {
			p.logger.Warn("datasourceSnapshot: list_datasources failed", "error", err, "orgID", orgID)
			done <- dsSnapshotFailOpen
			return
		}
		if result == nil || result.IsError {
			done <- dsSnapshotFailOpen
			return
		}
		text := ""
		if len(result.Content) > 0 {
			text = result.Content[0].Text
		}
		snap := renderDatasourceSnapshot(text)
		done <- snap
	}()

	var snapshot string
	select {
	case snapshot = <-done:
	case <-time.After(dsMCPCallTimeout):
		p.logger.Warn("datasourceSnapshot: timeout calling list_datasources", "orgID", orgID, "timeout", dsMCPCallTimeout)
		snapshot = dsSnapshotFailOpen
	}

	p.storeDatasourceCacheWithTTL(cacheKey, snapshot, datasourceCacheTTL(snapshot))
	return snapshot
}

// findDatasourceListTool searches all registered MCP servers for a tool whose
// base name (the part after the server-id prefix) is "list_datasources".
// This makes the snapshot work regardless of what id the Grafana MCP server
// was provisioned with (e.g. "mcp-grafana", "grafana-ds", etc.).
func (p *Plugin) findDatasourceListTool() (string, bool) {
	tools, err := p.mcpProxy.ListTools()
	if err != nil {
		return "", false
	}
	for _, t := range tools {
		// Tool names are always "{serverID}_{originalName}" per mcp.Client.
		parts := strings.SplitN(t.Name, "_", 2)
		if len(parts) == 2 && parts[1] == "list_datasources" {
			return t.Name, true
		}
	}
	return "", false
}

func (p *Plugin) lookupDatasourceCache(key string) (string, bool) {
	p.dsCacheMu.Lock()
	defer p.dsCacheMu.Unlock()
	if p.dsCache == nil {
		return "", false
	}
	entry, ok := p.dsCache[key]
	if !ok {
		return "", false
	}
	ttl := entry.ttl
	if ttl <= 0 {
		ttl = dsCacheTTL
	}
	if time.Since(entry.fetchedAt) > ttl {
		return "", false
	}
	return entry.snapshot, true
}

func (p *Plugin) storeDatasourceCache(key, snapshot string) {
	p.storeDatasourceCacheWithTTL(key, snapshot, dsCacheTTL)
}

func (p *Plugin) storeDatasourceCacheWithTTL(key, snapshot string, ttl time.Duration) {
	p.dsCacheMu.Lock()
	defer p.dsCacheMu.Unlock()
	if p.dsCache == nil {
		p.dsCache = make(map[string]dsCacheEntry, dsCacheMaxOrgs+1)
	}
	p.dsCache[key] = dsCacheEntry{snapshot: snapshot, fetchedAt: time.Now(), ttl: ttl}
	if len(p.dsCache) > dsCacheMaxOrgs {
		// Evict the oldest entry — simple O(n) sweep is fine at this cardinality.
		var oldestKey string
		var oldestAt time.Time
		for k, e := range p.dsCache {
			if oldestAt.IsZero() || e.fetchedAt.Before(oldestAt) {
				oldestKey = k
				oldestAt = e.fetchedAt
			}
		}
		delete(p.dsCache, oldestKey)
	}
}

func datasourceCacheTTL(snapshot string) time.Duration {
	if snapshot == dsSnapshotFailOpen {
		return dsCacheFailOpenTTL
	}
	return dsCacheTTL
}

// renderDatasourceSnapshot parses list_datasources output into a stable bullet
// list. The tool returns JSON but the exact shape varies across Grafana
// versions — be defensive and fall open on parse failure rather than let the
// LLM see a corrupted-looking block.
func renderDatasourceSnapshot(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return dsSnapshotFailOpen
	}

	var parsed interface{}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		// Some MCP servers wrap arrays as {"datasources": [...]} or similar;
		// if we can't parse, fall open.
		return dsSnapshotFailOpen
	}

	// Accept either a top-level array or an object with "datasources".
	var entries []map[string]interface{}
	switch v := parsed.(type) {
	case []interface{}:
		for _, item := range v {
			if m, ok := item.(map[string]interface{}); ok {
				entries = append(entries, m)
			}
		}
	case map[string]interface{}:
		if arr, ok := v["datasources"].([]interface{}); ok {
			for _, item := range arr {
				if m, ok := item.(map[string]interface{}); ok {
					entries = append(entries, m)
				}
			}
		}
	}

	if len(entries) == 0 {
		return dsSnapshotFailOpen
	}

	type row struct{ dsType, name, uid string }
	var rows []row
	for _, e := range entries {
		uid, _ := e["uid"].(string)
		name, _ := e["name"].(string)
		dsType, _ := e["type"].(string)
		if uid == "" {
			continue
		}
		if dsType == "" {
			dsType = "unknown"
		}
		if name == "" {
			name = dsType
		}
		rows = append(rows, row{dsType: dsType, name: name, uid: uid})
	}
	if len(rows) == 0 {
		return dsSnapshotFailOpen
	}

	sort.Slice(rows, func(i, j int) bool {
		if rows[i].dsType != rows[j].dsType {
			return rows[i].dsType < rows[j].dsType
		}
		return rows[i].name < rows[j].name
	})

	if len(rows) > dsSnapshotMaxEntries {
		rows = rows[:dsSnapshotMaxEntries]
	}

	var b strings.Builder
	for _, r := range rows {
		fmt.Fprintf(&b, "- %s (%s): uid=%s\n", r.dsType, r.name, r.uid)
	}
	return strings.TrimRight(b.String(), "\n")
}
