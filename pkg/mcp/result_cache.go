package mcp

import (
	"encoding/json"
	"strconv"
	"strings"
	"sync"
	"time"
)

// cacheableToolTTL maps a tool-name suffix (the part after the serverid_
// prefix — server IDs vary, the underlying tool name doesn't) to how long a
// successful result may be reused. Only read-only, deterministic-for-a-given-
// input calls belong here.
//
// list_prometheus_metric_names was measured taking 20-30s per call in
// production traces — a regex scan of a datasource's full metric catalog —
// and accounted for the majority of all tool-call time in two separate
// alert-investigation sessions (2026-09-01), because the agent frequently
// re-issues it with the same or overlapping regex as it narrows its search.
// Caching turns repeat scans within one investigation into a no-op.
var cacheableToolTTL = map[string]time.Duration{
	"list_prometheus_metric_names": 60 * time.Second,
}

// cacheableTTL returns the TTL for toolName if it's cacheable.
func cacheableTTL(toolName string) (time.Duration, bool) {
	for suffix, ttl := range cacheableToolTTL {
		if strings.HasSuffix(toolName, suffix) {
			return ttl, true
		}
	}
	return 0, false
}

type resultCacheEntry struct {
	result    *CallToolResult
	expiresAt time.Time
}

// resultCache holds short-lived results for the tool calls named in
// cacheableToolTTL, keyed by tool name, org, user, and arguments so entries
// never cross an org or user boundary — see cacheKey.
type resultCache struct {
	mu      sync.Mutex
	entries map[string]resultCacheEntry
}

func newResultCache() *resultCache {
	return &resultCache{entries: make(map[string]resultCacheEntry)}
}

// cacheKey scopes cached results to (tool, org, scope org, user, arguments).
// User is included even though this data is typically org-wide, not
// per-user-ACL'd, as defense in depth for OAuth-enabled servers where a
// user's token could scope results differently — the primary payoff (a
// single investigation re-scanning the same datasource) is unaffected since
// one investigation always runs as one user. json.Marshal on
// map[string]interface{} sorts keys, so this is stable across calls with the
// same argument set.
func cacheKey(toolName, orgID, scopeOrgID string, userID int64, arguments map[string]interface{}) string {
	argsJSON, _ := json.Marshal(arguments)
	return strings.Join([]string{toolName, orgID, scopeOrgID, strconv.FormatInt(userID, 10), string(argsJSON)}, "|")
}

func (c *resultCache) get(key string) (*CallToolResult, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if !ok || time.Now().After(entry.expiresAt) {
		return nil, false
	}
	return entry.result, true
}

func (c *resultCache) set(key string, result *CallToolResult, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	// Opportunistic cleanup instead of a background goroutine/ticker: bounds
	// map growth without needing lifecycle coordination with Proxy.Close().
	for k, e := range c.entries {
		if now.After(e.expiresAt) {
			delete(c.entries, k)
		}
	}
	c.entries[key] = resultCacheEntry{result: result, expiresAt: now.Add(ttl)}
}
