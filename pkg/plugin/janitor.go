package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"strings"
	"sync"
	"time"

	"consensys-asko11y-app/pkg/graphiti"
	"consensys-asko11y-app/pkg/mcp"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

const JanitorScavengeInterval = 1 * time.Hour

// Janitor periodically extracts live system state from all available MCP tools
// and ingests it as Graph Facts into Graphiti. It only calls tools that require
// no mandatory arguments (discovery/listing tools), so it can run unattended
// without per-query parameters.
//
// Each tool output is hashed and compared with the previous cycle. Only changed
// outputs are re-ingested, avoiding redundant Graphiti entity extraction.
//
// Large tool outputs (JSON arrays) are split into per-item episodes so Graphiti's
// LLM can process each item individually for better entity extraction quality.
//
// orgID is set lazily via SetOrgID on the first inbound HTTP request, since
// backend.AppInstanceSettings carries no org identity — only request headers do.
type Janitor struct {
	ctx            context.Context
	cancel         context.CancelFunc
	interval       time.Duration
	orgID          int64
	orgIDMu        sync.RWMutex
	mcpProxy       *mcp.Proxy
	graphitiClient *graphiti.Client
	logger         log.Logger
	// prevHashes caches the FNV-64a hash of each tool's last output.
	// Keyed by fully-qualified tool name.
	prevHashes   map[string]uint64
	prevHashesMu sync.RWMutex
}

// NewJanitor creates a Janitor. Call SetOrgID before the first scavenge.
func NewJanitor(ctx context.Context, mcpProxy *mcp.Proxy, graphitiClient *graphiti.Client, logger log.Logger, interval time.Duration) *Janitor {
	ctx, cancel := context.WithCancel(ctx)
	return &Janitor{
		ctx:            ctx,
		cancel:         cancel,
		interval:       interval,
		mcpProxy:       mcpProxy,
		graphitiClient: graphitiClient,
		logger:         logger,
		prevHashes:     make(map[string]uint64),
	}
}

// SetOrgID records the org this plugin instance serves.
// Safe to call concurrently; subsequent calls with the same value are no-ops.
func (j *Janitor) SetOrgID(orgID int64) {
	j.orgIDMu.Lock()
	defer j.orgIDMu.Unlock()
	if j.orgID == 0 && orgID != 0 {
		j.orgID = orgID
		j.logger.Debug("Janitor org ID set", "orgID", orgID)
	}
}

func (j *Janitor) getOrgID() int64 {
	j.orgIDMu.RLock()
	defer j.orgIDMu.RUnlock()
	return j.orgID
}

// Start runs the periodic scavenge loop. Call in a goroutine.
func (j *Janitor) Start() {
	j.logger.Info("Janitor started", "interval", j.interval, "orgID", j.orgID)
	ticker := time.NewTicker(j.interval)
	defer ticker.Stop()
	for {
		select {
		case <-j.ctx.Done():
			j.logger.Info("Janitor stopped")
			return
		case <-ticker.C:
			j.Scavenge()
		}
	}
}

// Stop signals the scavenge loop to exit.
func (j *Janitor) Stop() {
	j.cancel()
}

// Scavenge performs one extraction cycle: lists all MCP tools, calls the ones
// that need no required arguments, and ingests the results into Graphiti.
// Safe to call directly for on-demand updates (e.g. UI "Build graph" button,
// post-chat opt-in).
func (j *Janitor) Scavenge() {
	orgID := j.getOrgID()
	if orgID == 0 {
		j.logger.Debug("Janitor: skipping scavenge, org ID not yet known")
		return
	}

	j.logger.Info("Janitor scavenge started", "orgID", orgID)

	tools, err := j.mcpProxy.ListTools()
	if err != nil {
		j.logger.Warn("Janitor: failed to list MCP tools", "error", err)
		return
	}

	groupID := fmt.Sprintf("org_%d", orgID)
	now := time.Now().UTC().Format(time.RFC3339)

	var episodes []graphiti.Episode
	for _, tool := range tools {
		if !isDiscoveryTool(tool) {
			continue
		}
		eps, err := j.callAndWrap(tool, now)
		if err != nil {
			j.logger.Debug("Janitor: skipped tool", "tool", tool.Name, "reason", err)
			continue
		}
		episodes = append(episodes, eps...)
	}

	if len(episodes) == 0 {
		j.logger.Debug("Janitor: no episodes generated", "orgID", orgID)
		return
	}

	ctx, cancel := context.WithTimeout(j.ctx, 2*time.Minute)
	defer cancel()

	if err := j.graphitiClient.AddEpisodes(ctx, groupID, episodes); err != nil {
		j.logger.Error("Janitor: failed to ingest episodes", "error", err, "orgID", orgID)
		return
	}

	j.logger.Info("Janitor scavenge completed", "episodes", len(episodes), "orgID", orgID)
}

// isDiscoveryTool returns true if the tool can be called with no arguments —
// i.e. its InputSchema has an empty or absent "required" list.
// This targets listing/enumeration tools (datasources, dashboards, alert rules, etc.)
// and avoids query tools that need specific parameters (PromQL, LogQL, etc.).
func isDiscoveryTool(tool mcp.Tool) bool {
	required, ok := tool.InputSchema["required"]
	if !ok || required == nil {
		return true
	}
	if reqs, ok := required.([]interface{}); ok {
		return len(reqs) == 0
	}
	if reqs, ok := required.([]string); ok {
		return len(reqs) == 0
	}
	return false
}

// hashContent returns the FNV-64a hash of a string.
func hashContent(s string) uint64 {
	h := fnv.New64a()
	h.Write([]byte(s))
	return h.Sum64()
}

// checkAndUpdateHash returns true if the tool output differs from the last
// scavenge cycle. It also updates the stored hash for the next comparison.
func (j *Janitor) checkAndUpdateHash(toolName, body string) bool {
	newHash := hashContent(body)

	j.prevHashesMu.Lock()
	defer j.prevHashesMu.Unlock()

	prevHash, exists := j.prevHashes[toolName]
	j.prevHashes[toolName] = newHash
	return !exists || prevHash != newHash
}

// callAndWrap calls a single discovery tool, checks for changes, and wraps
// its output as one or more Graph Episodes. JSON arrays are split into
// per-item episodes for better entity extraction quality.
func (j *Janitor) callAndWrap(tool mcp.Tool, referenceTime string) ([]graphiti.Episode, error) {
	ctx, cancel := context.WithTimeout(j.ctx, 30*time.Second)
	defer cancel()

	result, err := j.mcpProxy.CallToolWithContext(tool.Name, map[string]interface{}{}, "", "", "")
	if err != nil {
		return nil, fmt.Errorf("call failed: %w", err)
	}
	if result.IsError {
		return nil, fmt.Errorf("tool returned error")
	}

	_ = ctx // context used via timeout above

	var sb strings.Builder
	for _, block := range result.Content {
		if block.Type == "text" {
			sb.WriteString(block.Text)
		}
	}
	body := sb.String()
	if strings.TrimSpace(body) == "" {
		return nil, fmt.Errorf("empty response")
	}

	// Skip ingestion if the output hasn't changed since last scavenge.
	if !j.checkAndUpdateHash(tool.Name, body) {
		return nil, fmt.Errorf("unchanged since last scavenge")
	}

	// Derive a readable name from the tool name (serverid_toolname → toolname)
	parts := strings.SplitN(tool.Name, "_", 2)
	displayName := tool.Name
	serverID := ""
	if len(parts) == 2 {
		serverID = parts[0]
		displayName = parts[1]
	}

	return splitToolOutput(body, serverID, displayName, referenceTime), nil
}

// splitToolOutput converts raw tool output into one or more focused episodes.
// JSON arrays are split into individual items; each item becomes its own episode
// so Graphiti's entity extraction LLM can process smaller, focused chunks.
func splitToolOutput(body, serverID, displayName, referenceTime string) []graphiti.Episode {
	trimmed := strings.TrimSpace(body)

	// Attempt to parse as JSON array and split into per-item episodes.
	if len(trimmed) > 0 && trimmed[0] == '[' {
		var items []json.RawMessage
		if json.Unmarshal([]byte(trimmed), &items) == nil && len(items) > 1 {
			return splitJSONArray(items, serverID, displayName, referenceTime)
		}
	}

	// Attempt to parse as a JSON object with a list-like field (common pattern:
	// {"dashboards": [...], "count": N} or {"results": [...]}).
	if len(trimmed) > 0 && trimmed[0] == '{' {
		if eps := splitJSONObjectWithList(trimmed, serverID, displayName, referenceTime); len(eps) > 0 {
			return eps
		}
	}

	// Fallback: single episode for non-array / small output.
	source := "text"
	if json.Valid([]byte(trimmed)) {
		source = "json"
	}
	return []graphiti.Episode{{
		Name:              fmt.Sprintf("discovery:%s:%s", serverID, displayName),
		EpisodeBody:       trimmed,
		Source:            source,
		SourceDescription: fmt.Sprintf("Janitor discovery via MCP server %q tool %q", serverID, displayName),
		ReferenceTime:     referenceTime,
		EntityTypes:       graphiti.ObservabilityEntityTypes(),
	}}
}

// splitJSONArray creates one episode per JSON array element.
func splitJSONArray(items []json.RawMessage, serverID, displayName, referenceTime string) []graphiti.Episode {
	entityTypes := graphiti.ObservabilityEntityTypes()
	episodes := make([]graphiti.Episode, 0, len(items))
	for i, raw := range items {
		itemStr := string(raw)
		name := extractItemName(raw, i)
		episodes = append(episodes, graphiti.Episode{
			Name:              fmt.Sprintf("discovery:%s:%s:%s", serverID, displayName, name),
			EpisodeBody:       itemStr,
			Source:            "json",
			SourceDescription: fmt.Sprintf("Janitor discovery via MCP server %q tool %q (item %d)", serverID, displayName, i),
			ReferenceTime:     referenceTime,
			EntityTypes:       entityTypes,
		})
	}
	return episodes
}

// splitJSONObjectWithList looks for common list-valued fields in a JSON object
// (e.g., "dashboards", "results", "items", "rules", "alerts", "datasources")
// and splits the list items into individual episodes.
func splitJSONObjectWithList(body, serverID, displayName, referenceTime string) []graphiti.Episode {
	var obj map[string]json.RawMessage
	if json.Unmarshal([]byte(body), &obj) != nil {
		return nil
	}
	// Known list field names in common Grafana API / MCP tool responses.
	listFields := []string{
		"dashboards", "results", "items", "rules", "alerts",
		"datasources", "data", "panels", "folders", "teams",
		"serviceAccounts", "users", "orgs", "annotations",
	}
	for _, field := range listFields {
		raw, ok := obj[field]
		if !ok {
			continue
		}
		var items []json.RawMessage
		if json.Unmarshal(raw, &items) == nil && len(items) > 1 {
			return splitJSONArray(items, serverID, displayName, referenceTime)
		}
	}
	return nil
}

// extractItemName tries to pull a human-readable name from a JSON item for
// use in the episode name. Falls back to the item index.
func extractItemName(raw json.RawMessage, index int) string {
	var obj map[string]interface{}
	if json.Unmarshal(raw, &obj) != nil {
		return fmt.Sprintf("item_%d", index)
	}
	// Try common name fields in priority order.
	for _, key := range []string{"title", "name", "uid", "id"} {
		if v, ok := obj[key]; ok {
			s := fmt.Sprintf("%v", v)
			if s != "" {
				return sanitizeEpisodeName(s)
			}
		}
	}
	return fmt.Sprintf("item_%d", index)
}

// sanitizeEpisodeName cleans a string for use in an episode name.
func sanitizeEpisodeName(s string) string {
	s = strings.ToLower(s)
	s = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '-'
	}, s)
	// Collapse multiple dashes.
	for strings.Contains(s, "--") {
		s = strings.ReplaceAll(s, "--", "-")
	}
	return strings.Trim(s, "-")
}
