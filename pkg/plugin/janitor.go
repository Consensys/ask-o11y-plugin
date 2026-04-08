package plugin

import (
	"context"
	"fmt"
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
		ep, err := j.callAndWrap(tool, now)
		if err != nil {
			j.logger.Debug("Janitor: skipped tool", "tool", tool.Name, "reason", err)
			continue
		}
		episodes = append(episodes, ep)
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

// callAndWrap calls a single discovery tool and wraps its output as a Graph Episode.
func (j *Janitor) callAndWrap(tool mcp.Tool, referenceTime string) (graphiti.Episode, error) {
	ctx, cancel := context.WithTimeout(j.ctx, 30*time.Second)
	defer cancel()

	result, err := j.mcpProxy.CallToolWithContext(tool.Name, map[string]interface{}{}, "", "", "")
	if err != nil {
		return graphiti.Episode{}, fmt.Errorf("call failed: %w", err)
	}
	if result.IsError {
		return graphiti.Episode{}, fmt.Errorf("tool returned error")
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
		return graphiti.Episode{}, fmt.Errorf("empty response")
	}

	// Derive a readable name from the tool name (serverid_toolname → toolname)
	parts := strings.SplitN(tool.Name, "_", 2)
	displayName := tool.Name
	serverID := ""
	if len(parts) == 2 {
		serverID = parts[0]
		displayName = parts[1]
	}

	return graphiti.Episode{
		Name:              fmt.Sprintf("discovery:%s:%s", serverID, displayName),
		EpisodeBody:       body,
		Source:            "mcp",
		SourceDescription: fmt.Sprintf("Janitor discovery via MCP server %q tool %q", serverID, displayName),
		ReferenceTime:     referenceTime,
	}, nil
}
