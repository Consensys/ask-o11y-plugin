package plugin

import (
	"consensys-asko11y-app/pkg/agent"
	"consensys-asko11y-app/pkg/mcp"
	"consensys-asko11y-app/pkg/rbac"
	"context"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/backend/resource/httpadapter"
	"github.com/redis/go-redis/v9"
)

const PluginID = "consensys-asko11y-app"

var (
	_ backend.CallResourceHandler   = (*Plugin)(nil)
	_ instancemgmt.InstanceDisposer = (*Plugin)(nil)
	_ backend.CheckHealthHandler    = (*Plugin)(nil)
)

type RedisConfig struct {
	Addr     string
	Password string
	DB       int
}

func getRedisAddr() string {
	if addr := os.Getenv("GF_PLUGIN_ASKO11Y_REDIS_ADDR"); addr != "" {
		return addr
	}
	return "localhost:6379"
}

// builtInMCPBaseURL returns the localhost base URL for communicating with
// plugins in the same Grafana instance. Uses localhost to avoid hairpin
// routing through external proxies/CDN that cfg.AppURL() may point to.
func builtInMCPBaseURL() string {
	if override := os.Getenv("GF_PLUGIN_ASKO11Y_BUILTIN_MCP_BASE_URL"); override != "" {
		return strings.TrimRight(override, "/")
	}
	port := os.Getenv("GF_SERVER_HTTP_PORT")
	if port == "" {
		port = "3000"
	}
	return "http://localhost:" + port
}

func createRedisClient(logger log.Logger) (*redis.Client, error) {
	// Try GF_PLUGIN_ASKO11Y_REDIS first (full connection string)
	redisURL := os.Getenv("GF_PLUGIN_ASKO11Y_REDIS")
	if redisURL != "" {
		opt, err := redis.ParseURL(redisURL)
		if err != nil {
			return nil, fmt.Errorf("failed to parse GF_PLUGIN_ASKO11Y_REDIS: %w", err)
		}
		logger.Info("Using Redis connection from GF_PLUGIN_ASKO11Y_REDIS")
		return redis.NewClient(opt), nil
	}

	// Fall back to individual environment variables
	addr := getRedisAddr()
	password := os.Getenv("GF_PLUGIN_ASKO11Y_REDIS_PASSWORD")

	db := 0
	if dbStr := os.Getenv("GF_PLUGIN_ASKO11Y_REDIS_DB"); dbStr != "" {
		var err error
		db, err = strconv.Atoi(dbStr)
		if err != nil {
			logger.Warn("Invalid GF_PLUGIN_ASKO11Y_REDIS_DB value, using default 0", "value", dbStr, "error", err)
			db = 0
		}
	}

	opt := &redis.Options{
		Addr:     addr,
		Password: password,
		DB:       db,
	}

	logger.Info("Using Redis connection from individual environment variables",
		"addr", addr,
		"db", db,
		"hasPassword", password != "")

	return redis.NewClient(opt), nil
}

type PluginSettings struct {
	MCPServers    []mcp.ServerConfig `json:"mcpServers"`
	UseBuiltInMCP bool               `json:"useBuiltInMCP"`
}

type Plugin struct {
	backend.CallResourceHandler
	logger        log.Logger
	mcpProxy      *mcp.Proxy
	agentLoop     *agent.AgentLoop
	shareStore    ShareStoreInterface
	runStore      RunStoreInterface
	redisClient   *redis.Client
	usingRedis    bool
	useBuiltInMCP bool
	ctx           context.Context
	cancel        context.CancelFunc
	runCancelsMu  sync.Mutex
	runCancels    map[string]context.CancelFunc
}

func NewPlugin(ctx context.Context, settings backend.AppInstanceSettings) (instancemgmt.Instance, error) {
	logger := log.DefaultLogger

	var pluginSettings PluginSettings
	if err := json.Unmarshal(settings.JSONData, &pluginSettings); err != nil {
		logger.Warn("Failed to parse plugin settings, using empty config", "error", err)
		pluginSettings = PluginSettings{
			MCPServers: []mcp.ServerConfig{},
		}
	}

	mcpProxy := mcp.NewProxy(logger)
	mcpProxy.UpdateConfig(pluginSettings.MCPServers)

	mcpProxy.StartHealthMonitoring(MCPHealthMonitoringInterval)

	var shareStore ShareStoreInterface
	var redisClient *redis.Client
	usingRedis := false

	redisClient, err := createRedisClient(logger)
	if err == nil {
		ctx, cancel := context.WithTimeout(context.Background(), RedisConnectionTimeout)
		defer cancel()
		if err := redisClient.Ping(ctx).Err(); err == nil {
			rateLimiter := NewRedisRateLimiter(redisClient, logger)
			shareStore = NewRedisShareStore(redisClient, logger, rateLimiter)
			usingRedis = true
			logger.Info("Using Redis for session sharing", "redisAddr", getRedisAddr())
		} else {
			logger.Warn("Redis connection test failed, falling back to in-memory storage", "error", err)
			redisClient.Close()
			redisClient = nil
		}
	} else {
		logger.Warn("Failed to create Redis client, falling back to in-memory storage", "error", err)
	}

	var runStore RunStoreInterface
	if !usingRedis {
		rateLimiter := NewInMemoryRateLimiter(logger)
		shareStore = NewShareStore(logger, rateLimiter)
		runStore = NewRunStore(logger)
		logger.Info("Using in-memory storage for session sharing (not suitable for multi-replica deployments)")
	} else {
		runStore = NewRedisRunStore(redisClient, logger)
	}

	pluginCtx, cancel := context.WithCancel(context.Background())

	llmClient := agent.NewLLMClient(logger)
	agentLoop := agent.NewAgentLoop(llmClient, mcpProxy, logger)

	p := &Plugin{
		logger:        logger,
		mcpProxy:      mcpProxy,
		agentLoop:     agentLoop,
		shareStore:    shareStore,
		runStore:      runStore,
		redisClient:   redisClient,
		usingRedis:    usingRedis,
		useBuiltInMCP: pluginSettings.UseBuiltInMCP,
		ctx:           pluginCtx,
		cancel:        cancel,
		runCancels:    make(map[string]context.CancelFunc),
	}

	if !usingRedis {
		go func() {
			ticker := time.NewTicker(ShareCleanupInterval)
			defer ticker.Stop()
			for {
				select {
				case <-ticker.C:
					shareStore.CleanupExpired()
				case <-pluginCtx.Done():
					return
				}
			}
		}()
	}

	go func() {
		ticker := time.NewTicker(RunCleanupInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				runStore.CleanupOld()
			case <-pluginCtx.Done():
				return
			}
		}
	}()

	mux := http.NewServeMux()
	p.registerRoutes(mux)
	p.CallResourceHandler = httpadapter.New(mux)

	logger.Info("Plugin initialized",
		"pluginId", PluginID,
		"mcpServers", mcpProxy.GetServerCount())

	return p, nil
}

func (p *Plugin) Dispose() {
	p.runCancelsMu.Lock()
	for _, cancel := range p.runCancels {
		cancel()
	}
	p.runCancels = nil
	p.runCancelsMu.Unlock()

	if p.cancel != nil {
		p.cancel()
	}
	p.mcpProxy.StopHealthMonitoring()
	if p.redisClient != nil {
		if err := p.redisClient.Close(); err != nil {
			p.logger.Warn("Failed to close Redis client", "error", err)
		}
	}
	p.logger.Info("Plugin disposed")
}

func (p *Plugin) CheckHealth(ctx context.Context, req *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	p.logger.Info("CheckHealth called")

	serverCount := p.mcpProxy.GetServerCount()
	status := backend.HealthStatusOk
	message := fmt.Sprintf("Plugin is healthy (MCP servers: %d)", serverCount)

	if p.usingRedis && p.redisClient != nil {
		healthCtx, cancel := context.WithTimeout(ctx, HealthCheckTimeout)
		defer cancel()
		if err := p.redisClient.Ping(healthCtx).Err(); err != nil {
			message = fmt.Sprintf("Plugin is healthy but Redis connection failed (MCP servers: %d). Session sharing may not work across replicas.", serverCount)
			p.logger.Warn("Redis health check failed", "error", err)
		} else {
			message = fmt.Sprintf("Plugin is healthy (MCP servers: %d, Redis: connected)", serverCount)
		}
	} else if !p.usingRedis {
		message = fmt.Sprintf("Plugin is healthy but using in-memory storage (MCP servers: %d). Session sharing will not work across multiple Grafana replicas. Configure Redis for production.", serverCount)
	}

	return &backend.CheckHealthResult{
		Status:  status,
		Message: message,
	}, nil
}

func (p *Plugin) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/health", p.handleHealth)
	mux.HandleFunc("/mcp", p.handleMCP)
	mux.HandleFunc("/api/mcp/tools", p.handleMCPTools)
	mux.HandleFunc("/api/mcp/call-tool", p.handleMCPCallTool)
	mux.HandleFunc("/api/mcp/servers", p.handleMCPServers)
	mux.HandleFunc("/api/agent/run", p.handleAgentRun)
	mux.HandleFunc("/api/agent/runs/", p.handleAgentRuns)
	mux.HandleFunc("/api/sessions/share", p.handleCreateShare)
	mux.HandleFunc("/api/sessions/shared/", p.handleGetSharedSession)
	mux.HandleFunc("/api/sessions/share/", p.handleDeleteShare)
	mux.HandleFunc("/api/sessions/", p.handleGetSessionShares)

	mux.HandleFunc("/", p.handleDefault)
}

func getUserRole(r *http.Request) string {
	pluginContext := httpadapter.PluginConfigFromContext(r.Context())
	if pluginContext.User != nil {
		role := string(pluginContext.User.Role)
		if role != "" {
			return role
		}
	}

	roleHeaders := []string{
		"X-Grafana-User-Role",
		"X-Grafana-Org-Role",
		"X-Grafana-Role",
	}

	for _, header := range roleHeaders {
		if role := r.Header.Get(header); role != "" {
			return role
		}
	}

	return "Viewer"
}

func (p *Plugin) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	response := map[string]interface{}{
		"status":     "ok",
		"message":    "MCP Proxy is running",
		"mcpServers": p.mcpProxy.GetServerCount(),
	}

	json.NewEncoder(w).Encode(response)
}

func (p *Plugin) handleMCP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}

	p.logger.Debug("Handling MCP JSON-RPC request", "bodyLength", len(body))

	response, err := p.mcpProxy.HandleMCPRequest(body)
	if err != nil {
		p.logger.Error("Failed to handle MCP request", "error", err)
		http.Error(w, fmt.Sprintf("Internal error: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(response)
}

func (p *Plugin) handleMCPTools(w http.ResponseWriter, r *http.Request) {
	userRole := getUserRole(r)
	p.logger.Info("MCP tools request", "method", r.Method, "role", userRole)

	tools, err := p.mcpProxy.ListTools()
	if err != nil {
		p.logger.Error("Failed to list tools", "error", err)
		http.Error(w, fmt.Sprintf("Failed to list tools: %v", err), http.StatusInternalServerError)
		return
	}

	filteredTools := rbac.FilterToolsByRole(tools, userRole)
	p.logger.Debug("Tools filtered by role", "role", userRole, "totalTools", len(tools), "filteredTools", len(filteredTools))

	w.Header().Set("Content-Type", "application/json")

	response := map[string]interface{}{
		"tools": filteredTools,
	}

	json.NewEncoder(w).Encode(response)
}

func (p *Plugin) handleMCPCallTool(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userRole := getUserRole(r)

	var req struct {
		Name       string                 `json:"name"`
		Arguments  map[string]interface{} `json:"arguments"`
		OrgName    string                 `json:"orgName"`
		ScopeOrgId string                 `json:"scopeOrgId"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request: %v", err), http.StatusBadRequest)
		return
	}

	p.logger.Info("MCP call tool request", "tool", req.Name, "role", userRole)

	tool, found := p.mcpProxy.FindToolByName(req.Name)
	if !found {
		// Tool cache may be empty if ListTools hasn't been called yet; populate it.
		if _, err := p.mcpProxy.ListTools(); err == nil {
			tool, found = p.mcpProxy.FindToolByName(req.Name)
		}
		if !found {
			http.Error(w, fmt.Sprintf("Unknown tool: %s", req.Name), http.StatusNotFound)
			return
		}
	}
	if !rbac.CanAccessTool(userRole, tool) {
		p.logger.Warn("Access denied to tool", "tool", req.Name, "role", userRole)
		http.Error(w, fmt.Sprintf("Access denied: %s role cannot access tool %s", userRole, req.Name), http.StatusForbidden)
		return
	}

	orgID := r.Header.Get("X-Grafana-Org-Id")
	if orgID == "" {
		orgID = "1"
	}

	p.logger.Debug("Tool call context", "orgID", orgID, "orgName", req.OrgName, "scopeOrgId", req.ScopeOrgId, "tool", req.Name)

	result, err := p.mcpProxy.CallToolWithContext(req.Name, req.Arguments, orgID, req.OrgName, req.ScopeOrgId)
	if err != nil {
		p.logger.Error("Failed to call tool", "error", err)
		http.Error(w, fmt.Sprintf("Failed to call tool: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (p *Plugin) handleMCPServers(w http.ResponseWriter, r *http.Request) {
	p.logger.Info("MCP servers status request", "method", r.Method)

	healthMonitor := p.mcpProxy.GetHealthMonitor()
	serversHealth := healthMonitor.GetAllHealth()
	systemHealth := healthMonitor.GetSystemHealth()

	w.Header().Set("Content-Type", "application/json")

	response := map[string]interface{}{
		"servers":      serversHealth,
		"systemHealth": systemHealth,
	}

	json.NewEncoder(w).Encode(response)
}

func (p *Plugin) handleAgentRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userRole := getUserRole(r)
	userID := getUserID(r)
	orgID := r.Header.Get("X-Grafana-Org-Id")
	if orgID == "" {
		orgID = "1"
	}

	var req agent.RunRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request: %v", err), http.StatusBadRequest)
		return
	}

	if len(req.Messages) == 0 {
		http.Error(w, "messages is required", http.StatusBadRequest)
		return
	}
	if req.SystemPrompt == "" {
		http.Error(w, "systemPrompt is required", http.StatusBadRequest)
		return
	}

	cfg := backend.GrafanaConfigFromContext(r.Context())
	if cfg == nil {
		p.logger.Error("Grafana configuration not available in request context")
		http.Error(w, "Grafana configuration not available", http.StatusInternalServerError)
		return
	}
	saToken, err := cfg.PluginAppClientSecret()
	if err != nil {
		p.logger.Error("Failed to get service account token from context", "error", err)
		http.Error(w, "Failed to resolve service account token", http.StatusInternalServerError)
		return
	}

	if p.useBuiltInMCP {
		builtInURL := builtInMCPBaseURL() + "/api/plugins/grafana-llm-app/resources/mcp/grafana"
		p.mcpProxy.EnsureServer(mcp.ServerConfig{
			ID:      "mcp-grafana",
			Name:    "Grafana Built-in MCP",
			URL:     builtInURL,
			Type:    "streamable-http",
			Enabled: true,
			Headers: map[string]string{
				"Authorization": "Bearer " + saToken,
			},
		})
	}

	if req.Mode != "" && req.Mode != "stream" && req.Mode != "detached" {
		http.Error(w, "Invalid mode: must be 'stream' or 'detached'", http.StatusBadRequest)
		return
	}

	runID, err := generateShareID()
	if err != nil {
		p.logger.Error("Failed to generate run ID", "error", err)
		http.Error(w, "Failed to generate run ID", http.StatusInternalServerError)
		return
	}

	numericOrgID := getOrgID(r)
	p.runStore.CreateRun(runID, userID, numericOrgID)

	p.logger.Info("Agent run request", "role", userRole, "orgID", orgID, "runId", runID, "mode", req.Mode, "messageCount", len(req.Messages))

	eventCh := make(chan agent.SSEEvent, 16)

	loopReq := agent.LoopRequest{
		Messages:           req.Messages,
		SystemPrompt:       req.SystemPrompt,
		Summary:            req.Summary,
		MaxTotalTokens:     req.MaxTotalTokens,
		RecentMessageCount: req.RecentMessageCount,
		MaxIterations:      AgentMaxIterations,
		GrafanaURL:         builtInMCPBaseURL(),
		AuthToken:          saToken,
		UserCookie:         r.Header.Get("Cookie"),
		UserRole:           userRole,
		OrgID:              orgID,
		OrgName:            req.OrgName,
		ScopeOrgID:         req.ScopeOrgID,
	}

	if req.Mode == "detached" {
		runCtx, runCancel := context.WithCancel(p.ctx)

		p.runCancelsMu.Lock()
		p.runCancels[runID] = runCancel
		p.runCancelsMu.Unlock()

		go p.agentLoop.Run(runCtx, loopReq, eventCh)
		go func() {
			p.consumeAgentEvents(runID, eventCh)
			runCancel()
			p.runCancelsMu.Lock()
			delete(p.runCancels, runID)
			p.runCancelsMu.Unlock()
		}()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"runId":  runID,
			"status": RunStatusRunning,
		})
		return
	}

	// Stream mode: subscribe BEFORE launching consumer to avoid losing early events.
	broadcaster := p.runStore.GetBroadcaster(runID)
	if broadcaster == nil {
		http.Error(w, "Internal error: no broadcaster for run", http.StatusInternalServerError)
		return
	}
	subscriberCh, unsub := broadcaster.Subscribe()

	loopCtx, loopCancel := context.WithCancel(p.ctx)
	defer loopCancel()
	go func() {
		<-r.Context().Done()
		loopCancel()
	}()

	go p.agentLoop.Run(loopCtx, loopReq, eventCh)
	go p.consumeAgentEvents(runID, eventCh)

	p.streamRunSSE(w, runID, subscriberCh, unsub)
}

func (p *Plugin) consumeAgentEvents(runID string, eventCh <-chan agent.SSEEvent) {
	var lastEvent agent.SSEEvent
	for event := range eventCh {
		p.runStore.AppendEvent(runID, event)
		lastEvent = event
	}

	switch lastEvent.Type {
	case "done":
		p.runStore.FinishRun(runID, RunStatusCompleted, "")
	case "error":
		var errMsg string
		if ee, ok := lastEvent.Data.(agent.ErrorEvent); ok {
			errMsg = ee.Message
		}
		p.runStore.FinishRun(runID, RunStatusFailed, errMsg)
	case "":
		p.runStore.FinishRun(runID, RunStatusFailed, "agent terminated without producing events")
	default:
		p.runStore.FinishRun(runID, RunStatusCancelled, "")
	}
}

func initSSEWriter(w http.ResponseWriter) (http.Flusher, bool) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming not supported", http.StatusInternalServerError)
		return nil, false
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	return flusher, true
}

func (p *Plugin) streamRunSSE(w http.ResponseWriter, runID string, ch <-chan agent.SSEEvent, unsub func()) {
	defer unsub()

	flusher, ok := initSSEWriter(w)
	if !ok {
		return
	}

	startEvent := agent.SSEEvent{
		Type: "run_started",
		Data: agent.RunStartedEvent{RunID: runID},
	}
	if data, err := agent.MarshalSSE(startEvent); err == nil {
		if _, err := w.Write(data); err != nil {
			return
		}
		flusher.Flush()
	}

	for event := range ch {
		data, err := agent.MarshalSSE(event)
		if err != nil {
			p.logger.Error("Failed to marshal SSE event", "error", err)
			continue
		}
		if _, err := w.Write(data); err != nil {
			p.logger.Debug("Client disconnected during SSE stream", "error", err)
			return
		}
		flusher.Flush()
	}
}

func (p *Plugin) getAuthorizedRun(w http.ResponseWriter, r *http.Request, runID string) (*AgentRun, bool) {
	run, err := p.runStore.GetRun(runID)
	if err != nil {
		http.Error(w, "Run not found", http.StatusNotFound)
		return nil, false
	}

	if run.OrgID != getOrgID(r) || run.UserID != getUserID(r) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return nil, false
	}

	return run, true
}

func (p *Plugin) handleAgentRuns(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	prefix := "/api/agent/runs/"
	if !strings.HasPrefix(path, prefix) {
		http.Error(w, "Invalid path format", http.StatusBadRequest)
		return
	}

	remainder := strings.TrimPrefix(path, prefix)
	if remainder == "" {
		http.Error(w, "Run ID required", http.StatusBadRequest)
		return
	}

	if runID, isCancel := strings.CutSuffix(remainder, "/cancel"); isCancel {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !isValidSecureID(runID) {
			http.Error(w, "Invalid run ID format", http.StatusBadRequest)
			return
		}
		p.handleCancelRun(w, r, runID)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	runID, isEvents := strings.CutSuffix(remainder, "/events")
	if !isValidSecureID(runID) {
		http.Error(w, "Invalid run ID format", http.StatusBadRequest)
		return
	}

	if isEvents {
		p.handleAgentRunEvents(w, r, runID)
		return
	}

	run, ok := p.getAuthorizedRun(w, r, runID)
	if !ok {
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(run)
}

func (p *Plugin) handleCancelRun(w http.ResponseWriter, r *http.Request, runID string) {
	run, ok := p.getAuthorizedRun(w, r, runID)
	if !ok {
		return
	}

	if run.Status != RunStatusRunning {
		http.Error(w, "Run is not running", http.StatusConflict)
		return
	}

	p.runCancelsMu.Lock()
	cancelFn, exists := p.runCancels[runID]
	p.runCancelsMu.Unlock()

	if exists {
		cancelFn()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "cancelled"})
}

func (p *Plugin) handleAgentRunEvents(w http.ResponseWriter, r *http.Request, runID string) {
	if _, ok := p.getAuthorizedRun(w, r, runID); !ok {
		return
	}

	run, subscriberCh, unsub, err := p.runStore.SubscribeAndSnapshot(runID)
	if err != nil {
		http.Error(w, "Run not found", http.StatusNotFound)
		return
	}
	if unsub != nil {
		defer unsub()
	}

	flusher, ok := initSSEWriter(w)
	if !ok {
		return
	}

	for _, event := range run.Events {
		data, err := agent.MarshalSSE(event)
		if err != nil {
			p.logger.Error("Failed to marshal SSE event during replay", "error", err, "runId", runID, "eventType", event.Type)
			continue
		}
		if _, err := w.Write(data); err != nil {
			return
		}
	}
	flusher.Flush()

	if subscriberCh == nil {
		return
	}

	// SSE keepalive: send comment lines to prevent proxy idle timeouts.
	// Also select on r.Context().Done() since httpadapter's Write never
	// returns an error, so we can't detect client disconnection via writes.
	keepalive := time.NewTicker(15 * time.Second)
	defer keepalive.Stop()

	for {
		select {
		case event, ok := <-subscriberCh:
			if !ok {
				return
			}
			data, err := agent.MarshalSSE(event)
			if err != nil {
				p.logger.Error("Failed to marshal SSE event", "error", err, "runId", runID, "eventType", event.Type)
				continue
			}
			w.Write(data)
			flusher.Flush()
		case <-keepalive.C:
			w.Write([]byte(": keepalive\n\n"))
			flusher.Flush()
		case <-r.Context().Done():
			p.logger.Debug("Client disconnected during SSE reconnect stream", "runId", runID)
			return
		}
	}
}

func (p *Plugin) handleDefault(w http.ResponseWriter, r *http.Request) {
	p.logger.Info("Default handler", "path", r.URL.Path, "method", r.Method)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	response := map[string]interface{}{
		"message": "Consensys Assistant Backend Plugin",
		"path":    r.URL.Path,
	}

	json.NewEncoder(w).Encode(response)
}

func getUserID(r *http.Request) int64 {
	pluginContext := httpadapter.PluginConfigFromContext(r.Context())
	if pluginContext.User != nil && pluginContext.User.Login != "" {
		h := fnv.New64a()
		h.Write([]byte(pluginContext.User.Login))
		return int64(h.Sum64() & 0x7FFFFFFFFFFFFFFF)
	}

	if id, err := strconv.ParseInt(r.Header.Get("X-Grafana-User-Id"), 10, 64); err == nil {
		return id
	}

	return 0
}

func stringPtr(s string) *string {
	return &s
}

func getOrgID(r *http.Request) int64 {
	if id, err := strconv.ParseInt(r.Header.Get("X-Grafana-Org-Id"), 10, 64); err == nil && id > 0 {
		return id
	}
	return 1
}

func (p *Plugin) handleCreateShare(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	orgID := getOrgID(r)
	userID := getUserID(r)

	var req struct {
		SessionID      string          `json:"sessionId"`
		SessionData    json.RawMessage `json:"sessionData"`
		ExpiresInDays  *int            `json:"expiresInDays,omitempty"`
		ExpiresInHours *int            `json:"expiresInHours,omitempty"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request: %v", err), http.StatusBadRequest)
		return
	}

	if err := ValidateSessionData(req.SessionData); err != nil {
		p.logger.Warn("Invalid session data", "error", err)
		http.Error(w, fmt.Sprintf("Invalid session data: %v", err), http.StatusBadRequest)
		return
	}

	var sessionData map[string]interface{}
	if err := json.Unmarshal(req.SessionData, &sessionData); err != nil {
		http.Error(w, "Invalid session data format", http.StatusBadRequest)
		return
	}

	if sessionID, ok := sessionData["id"].(string); !ok || sessionID != req.SessionID {
		http.Error(w, "Session ID mismatch", http.StatusBadRequest)
		return
	}

	var expiresInHours *int
	if req.ExpiresInHours != nil {
		if *req.ExpiresInHours <= 0 {
			http.Error(w, "expiresInHours must be positive", http.StatusBadRequest)
			return
		}
		expiresInHours = req.ExpiresInHours
	} else if req.ExpiresInDays != nil {
		if *req.ExpiresInDays <= 0 {
			http.Error(w, "expiresInDays must be positive", http.StatusBadRequest)
			return
		}
		hours := *req.ExpiresInDays * 24
		expiresInHours = &hours
	}

	share, err := p.shareStore.CreateShare(req.SessionID, req.SessionData, orgID, userID, expiresInHours)
	if err != nil {
		if err.Error() == "rate limit exceeded: too many share requests" {
			http.Error(w, "Too many share requests. Please try again later.", http.StatusTooManyRequests)
			return
		}
		p.logger.Error("Failed to create share", "error", err)
		http.Error(w, fmt.Sprintf("Failed to create share: %v", err), http.StatusInternalServerError)
		return
	}

	shareURL := fmt.Sprintf("/a/%s/shared/%s?orgId=%d", PluginID, share.ShareID, orgID)

	var expiresAtStr *string
	if share.ExpiresAt != nil {
		expStr := share.ExpiresAt.Format(time.RFC3339)
		expiresAtStr = stringPtr(expStr)
	}

	response := map[string]interface{}{
		"shareId":   share.ShareID,
		"shareUrl":  shareURL,
		"expiresAt": expiresAtStr,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (p *Plugin) handleGetSharedSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	path := r.URL.Path
	if !strings.HasPrefix(path, "/api/sessions/shared/") {
		http.Error(w, "Invalid path format", http.StatusBadRequest)
		return
	}

	shareID := strings.TrimPrefix(path, "/api/sessions/shared/")
	if shareID == "" {
		http.Error(w, "Share ID required", http.StatusBadRequest)
		return
	}

	orgID := getOrgID(r)

	share, err := p.shareStore.GetShare(shareID)
	if err != nil {
		if err.Error() == "share not found" {
			http.Error(w, "Share link not found", http.StatusNotFound)
			return
		}
		if err.Error() == "share expired" {
			http.Error(w, "This share link has expired", http.StatusNotFound)
			return
		}
		p.logger.Error("Failed to get share", "error", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	if share.OrgID != orgID {
		http.Error(w, "You don't have access to this shared session", http.StatusForbidden)
		return
	}

	var sessionData map[string]interface{}
	if err := json.Unmarshal(share.SessionData, &sessionData); err != nil {
		p.logger.Error("Failed to parse session data", "error", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	sessionData["isShared"] = true
	sessionData["sharedBy"] = fmt.Sprintf("%d", share.UserID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sessionData)
}

func (p *Plugin) handleDeleteShare(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	path := r.URL.Path
	if !strings.HasPrefix(path, "/api/sessions/share/") {
		http.Error(w, "Invalid path format", http.StatusBadRequest)
		return
	}

	shareID := strings.TrimPrefix(path, "/api/sessions/share/")
	if shareID == "" {
		http.Error(w, "Share ID required", http.StatusBadRequest)
		return
	}

	userID := getUserID(r)

	share, err := p.shareStore.GetShare(shareID)
	if err != nil {
		if err.Error() == "share not found" || err.Error() == "share expired" {
			http.Error(w, "Share link not found", http.StatusNotFound)
			return
		}
		p.logger.Error("Failed to get share", "error", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	if share.UserID != userID {
		http.Error(w, "You don't have permission to revoke this share", http.StatusForbidden)
		return
	}

	if err := p.shareStore.DeleteShare(shareID); err != nil {
		p.logger.Error("Failed to delete share", "error", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	response := map[string]interface{}{
		"success": true,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (p *Plugin) handleGetSessionShares(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	path := r.URL.Path

	if strings.HasPrefix(path, "/api/sessions/shared/") {
		http.Error(w, "Invalid path format", http.StatusBadRequest)
		return
	}
	if strings.HasPrefix(path, "/api/sessions/share/") {
		http.Error(w, "Invalid path format", http.StatusBadRequest)
		return
	}
	if path == "/api/sessions/share" {
		http.Error(w, "Invalid path format", http.StatusBadRequest)
		return
	}

	prefix := "/api/sessions/"
	suffix := "/shares"

	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		http.Error(w, "Invalid path format", http.StatusBadRequest)
		return
	}

	sessionID := strings.TrimPrefix(strings.TrimSuffix(path, suffix), prefix)
	if sessionID == "" {
		http.Error(w, "Session ID required", http.StatusBadRequest)
		return
	}

	userID := getUserID(r)

	shares := p.shareStore.GetSharesBySession(sessionID)

	var userShares []map[string]interface{}
	for _, share := range shares {
		if share.UserID == userID {
			shareURL := fmt.Sprintf("/a/%s/shared/%s?orgId=%d", PluginID, share.ShareID, share.OrgID)
			var expiresAtStr *string
			if share.ExpiresAt != nil {
				expStr := share.ExpiresAt.Format(time.RFC3339)
				expiresAtStr = stringPtr(expStr)
			}
			userShares = append(userShares, map[string]interface{}{
				"shareId":   share.ShareID,
				"shareUrl":  shareURL,
				"expiresAt": expiresAtStr,
			})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(userShares)
}
