package plugin

import (
	"context"
	"fmt"
	"sync"
	"time"

	"consensys-asko11y-app/pkg/agent"
	"consensys-asko11y-app/pkg/mcp"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// Scout runs a full agentic discovery session on a configurable schedule.
// It shares the same system prompt and episode ingestion pipeline as the manual
// "Build Knowledge Graph" button, but scopes the initial message to the
// configured lookback window so the LLM focuses on what is active right now.
//
// GrafanaURL, SAToken, and OrgID are set lazily from the first inbound HTTP
// request, since the backend context carries no org identity at startup.
type Scout struct {
	ctx    context.Context
	cancel context.CancelFunc

	interval  time.Duration
	agentLoop *agent.AgentLoop
	mcpProxy  *mcp.Proxy
	logger    log.Logger
	settings  PluginSettings

	// Lazily set from inbound HTTP requests.
	orgID      int64
	grafanaURL string
	saToken    string
	cfgMu      sync.RWMutex
}

// NewScout creates a Scout. Call SetGrafanaConfig and SetOrgID before the first Scavenge.
func NewScout(
	ctx context.Context,
	agentLoop *agent.AgentLoop,
	mcpProxy *mcp.Proxy,
	logger log.Logger,
	interval time.Duration,
	settings PluginSettings,
) *Scout {
	ctx, cancel := context.WithCancel(ctx)
	return &Scout{
		ctx:       ctx,
		cancel:    cancel,
		interval:  interval,
		agentLoop: agentLoop,
		mcpProxy:  mcpProxy,
		logger:    logger,
		settings:  settings,
	}
}

// OrgID returns the org this plugin instance serves, or 0 if not yet set.
func (s *Scout) OrgID() int64 {
	s.cfgMu.RLock()
	defer s.cfgMu.RUnlock()
	return s.orgID
}

// SetOrgID records the org this plugin instance serves.
// Safe to call concurrently; subsequent calls with the same value are no-ops.
func (s *Scout) SetOrgID(orgID int64) {
	s.cfgMu.Lock()
	defer s.cfgMu.Unlock()
	if s.orgID == 0 && orgID != 0 {
		s.orgID = orgID
	}
}

// SetGrafanaConfig updates the Grafana URL (write-once) and SA token (always
// refreshed so token rotation is picked up on the next scavenge).
func (s *Scout) SetGrafanaConfig(grafanaURL, saToken string) {
	s.cfgMu.Lock()
	defer s.cfgMu.Unlock()
	if s.grafanaURL == "" && grafanaURL != "" {
		s.grafanaURL = grafanaURL
	}
	if saToken != "" {
		s.saToken = saToken
	}
}

func (s *Scout) config() (orgID int64, grafanaURL, saToken string) {
	s.cfgMu.RLock()
	defer s.cfgMu.RUnlock()
	return s.orgID, s.grafanaURL, s.saToken
}

// Start runs the periodic scavenge loop. Call in a goroutine.
func (s *Scout) Start() {
	s.logger.Info("Scout started", "interval", s.interval)
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	for {
		select {
		case <-s.ctx.Done():
			s.logger.Info("Scout stopped")
			return
		case <-ticker.C:
			s.Scavenge()
		}
	}
}

// Stop signals the scavenge loop to exit.
func (s *Scout) Stop() {
	s.cancel()
}

// Scavenge runs one full agentic discovery session scoped to the lookback window
// and ingests the resulting synthesis into the knowledge graph.
// Safe to call directly for on-demand updates (e.g. after config changes).
func (s *Scout) Scavenge() {
	orgID, grafanaURL, saToken := s.config()
	if orgID == 0 {
		s.logger.Debug("Scout: skipping scavenge, org ID not yet known")
		return
	}
	if grafanaURL == "" {
		s.logger.Debug("Scout: skipping scavenge, Grafana URL not yet known")
		return
	}
	tools, err := s.mcpProxy.ListTools()
	if err != nil {
		s.logger.Warn("Scout: unable to list MCP tools", "error", err)
		return
	}
	if !hasGraphitiMemoryTool(tools) {
		s.logger.Debug("Scout: skipping scavenge, graphiti MCP tools unavailable")
		return
	}

	s.logger.Info("Scout scavenge started", "orgID", orgID, "lookback", s.interval)

	if s.settings.UseBuiltInMCP && saToken != "" {
		builtInURL := grafanaURL + "/api/plugins/grafana-llm-app/resources/mcp/grafana"
		if err := s.mcpProxy.EnsureServer(mcp.ServerConfig{
			ID:      "mcp-grafana",
			Name:    "Grafana Built-in MCP",
			URL:     builtInURL,
			Type:    "streamable-http",
			Enabled: true,
			Headers: map[string]string{"Authorization": "Bearer " + saToken},
		}); err != nil {
			s.logger.Warn("Scout: failed to register built-in MCP server", "error", err)
		}
	}

	loopReq := agent.LoopRequest{
		Messages:           []agent.Message{{Role: "user", Content: s.discoveryMessage()}},
		SystemPrompt:       GraphitiDiscoverySystemPrompt,
		MaxTotalTokens:     s.settings.MaxTotalTokens,
		RecentMessageCount: s.settings.RecentMessageCount,
		MaxIterations:      GraphitiDiscoveryMaxIter,
		GrafanaURL:         grafanaURL,
		AuthToken:          saToken,
		OrgID:              fmt.Sprintf("%d", orgID),
		OrgName:            fmt.Sprintf("Org%d", orgID),
		ExcludeToolNames:   graphitiWriteToolNames,
	}

	eventCh := make(chan agent.SSEEvent, GraphitiDiscoveryMaxIter*6)
	runCtx, runCancel := context.WithCancel(s.ctx)
	defer runCancel()

	go s.agentLoop.Run(runCtx, loopReq, eventCh)

	lastEvent, synthesis := collectDiscoverySynthesis(eventCh, nil)

	if lastEvent.Type != "done" {
		s.logger.Warn("Scout scavenge did not complete cleanly", "lastEvent", lastEvent.Type, "orgID", orgID)
		return
	}
	if err := ingestGraphitiMemory(
		s.mcpProxy,
		orgID,
		"scout_synthesis",
		synthesis,
		"text",
		"Scheduled service topology discovery - scout synthesis",
	); err != nil {
		s.logger.Warn("Scout: failed to ingest synthesis", "error", err, "orgID", orgID)
		return
	}

	s.logger.Info("Scout scavenge completed", "orgID", orgID)
}

// discoveryMessage builds the initial user message scoped to the lookback window.
func (s *Scout) discoveryMessage() string {
	lb := humanDuration(s.interval)
	return fmt.Sprintf(
		`Execute the full discovery plan scoped to the last %s:
1. List datasources
2. Call list_prometheus_label_values for EACH of: service_name, service, job, app, namespace, cluster (one call per label)
3. Run query_prometheus with expr "count by (service_name) (up == 1)" — do NOT query raw "up"
4. Search traces in Tempo for call edges between services
5. Check kube-state-metrics if available
6. Synthesize — your synthesis MUST list every business service by name. Filter out monitoring infrastructure (prometheus, grafana, tempo, mimir, loki, alloy, alertmanager, otel-collector, node-exporter, pushgateway, kube-prometheus, ingress-nginx).`,
		lb,
	)
}

// humanDuration formats a duration as a short string suitable for both human
// display and PromQL range vectors (e.g. 5m, 1h).
func humanDuration(d time.Duration) string {
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	default:
		return fmt.Sprintf("%dh", int(d.Hours()))
	}
}

// parseScanInterval converts a UI interval string to a duration.
// Returns (0, false) for "off" or unrecognised values.
func parseScanInterval(s string) (time.Duration, bool) {
	switch s {
	case "5m":
		return 5 * time.Minute, true
	case "15m":
		return 15 * time.Minute, true
	case "30m":
		return 30 * time.Minute, true
	case "1h":
		return 1 * time.Hour, true
	case "3h":
		return 3 * time.Hour, true
	case "12h":
		return 12 * time.Hour, true
	case "24h":
		return 24 * time.Hour, true
	default:
		return 0, false
	}
}
