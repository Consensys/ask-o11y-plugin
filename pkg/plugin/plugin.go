package plugin

import (
	"consensys-asko11y-app/pkg/mcp"
	"context"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/backend/resource/httpadapter"
	"github.com/redis/go-redis/v9"
)

// PluginID is the plugin identifier
const PluginID = "consensys-asko11y-app"

// Make sure Plugin implements required interfaces
var (
	_ backend.CallResourceHandler   = (*Plugin)(nil)
	_ instancemgmt.InstanceDisposer = (*Plugin)(nil)
	_ backend.CheckHealthHandler    = (*Plugin)(nil)
)

// RedisConfig holds Redis connection configuration
type RedisConfig struct {
	Addr     string
	Password string
	DB       int
}

// getRedisAddr returns the Redis address from environment variables
func getRedisAddr() string {
	if addr := os.Getenv("GF_PLUGIN_ASKO11Y_REDIS_ADDR"); addr != "" {
		return addr
	}
	return "localhost:6379"
}

// createRedisClient creates a Redis client from environment variables
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

// PluginSettings represents the plugin configuration
type PluginSettings struct {
	MCPServers []mcp.ServerConfig `json:"mcpServers"`
}

// Plugin is the backend plugin implementation
type Plugin struct {
	backend.CallResourceHandler
	logger      log.Logger
	mcpProxy    *mcp.Proxy
	shareStore  ShareStoreInterface
	redisClient *redis.Client      // Store Redis client for health checks and cleanup
	usingRedis  bool               // Track if we're using Redis or in-memory
	ctx         context.Context    // Plugin lifecycle context
	cancel      context.CancelFunc // Cancel function for plugin lifecycle context
}

// NewPlugin creates a new backend plugin instance
func NewPlugin(ctx context.Context, settings backend.AppInstanceSettings) (instancemgmt.Instance, error) {
	logger := log.DefaultLogger

	// Parse plugin settings
	var pluginSettings PluginSettings
	if err := json.Unmarshal(settings.JSONData, &pluginSettings); err != nil {
		logger.Warn("Failed to parse plugin settings, using empty config", "error", err)
		pluginSettings = PluginSettings{
			MCPServers: []mcp.ServerConfig{},
		}
	}

	// Create MCP proxy
	mcpProxy := mcp.NewProxy(logger)
	mcpProxy.UpdateConfig(pluginSettings.MCPServers)

	// Start health monitoring
	mcpProxy.StartHealthMonitoring(MCPHealthMonitoringInterval)

	// Try to create Redis-backed share store, fallback to in-memory
	var shareStore ShareStoreInterface
	var redisClient *redis.Client
	usingRedis := false

	redisClient, err := createRedisClient(logger)
	if err == nil {
		// Test connection
		ctx, cancel := context.WithTimeout(context.Background(), RedisConnectionTimeout)
		defer cancel()
		if err := redisClient.Ping(ctx).Err(); err == nil {
			// Create Redis-backed rate limiter
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

	// Fallback to in-memory store if Redis is not available
	if !usingRedis {
		// Create in-memory rate limiter
		rateLimiter := NewInMemoryRateLimiter(logger)
		shareStore = NewShareStore(logger, rateLimiter)
		logger.Info("Using in-memory storage for session sharing (not suitable for multi-replica deployments)")
	}

	// Create a context that lives for the plugin's lifetime (not the initialization context)
	pluginCtx, cancel := context.WithCancel(context.Background())

	p := &Plugin{
		logger:      logger,
		mcpProxy:    mcpProxy,
		shareStore:  shareStore,
		redisClient: redisClient,
		usingRedis:  usingRedis,
		ctx:         pluginCtx,
		cancel:      cancel,
	}

	// Start cleanup goroutine for expired shares (only needed for in-memory store)
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

	// Setup resource handler using httpadapter
	mux := http.NewServeMux()
	p.registerRoutes(mux)
	p.CallResourceHandler = httpadapter.New(mux)

	logger.Info("Plugin initialized",
		"pluginId", PluginID,
		"mcpServers", mcpProxy.GetServerCount())

	return p, nil
}

// Dispose cleans up plugin resources
func (p *Plugin) Dispose() {
	// Cancel the plugin lifecycle context to stop the cleanup goroutine
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

// CheckHealth handles health checks for the backend plugin
func (p *Plugin) CheckHealth(ctx context.Context, req *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	p.logger.Info("CheckHealth called")

	serverCount := p.mcpProxy.GetServerCount()
	status := backend.HealthStatusOk
	message := fmt.Sprintf("Plugin is healthy (MCP servers: %d)", serverCount)

	// Check Redis connection if using Redis
	if p.usingRedis && p.redisClient != nil {
		healthCtx, cancel := context.WithTimeout(ctx, HealthCheckTimeout)
		defer cancel()
		if err := p.redisClient.Ping(healthCtx).Err(); err != nil {
			// Plugin is still functional, but Redis is down - use warning message
			message = fmt.Sprintf("Plugin is healthy but Redis connection failed (MCP servers: %d). Session sharing may not work across replicas.", serverCount)
			p.logger.Warn("Redis health check failed", "error", err)
		} else {
			message = fmt.Sprintf("Plugin is healthy (MCP servers: %d, Redis: connected)", serverCount)
		}
	} else if !p.usingRedis {
		// Plugin is functional but using in-memory storage - include warning in message
		message = fmt.Sprintf("Plugin is healthy but using in-memory storage (MCP servers: %d). Session sharing will not work across multiple Grafana replicas. Configure Redis for production.", serverCount)
	}

	return &backend.CheckHealthResult{
		Status:  status,
		Message: message,
	}, nil
}

// registerRoutes registers HTTP routes for the plugin
func (p *Plugin) registerRoutes(mux *http.ServeMux) {
	// Health check endpoint
	mux.HandleFunc("/health", p.handleHealth)

	// MCP JSON-RPC endpoint
	mux.HandleFunc("/mcp", p.handleMCP)

	// API endpoints for MCP operations (alternative REST-style interface)
	mux.HandleFunc("/api/mcp/tools", p.handleMCPTools)
	mux.HandleFunc("/api/mcp/call-tool", p.handleMCPCallTool)
	mux.HandleFunc("/api/mcp/servers", p.handleMCPServers)

	// Session sharing endpoints
	// IMPORTANT: Register more specific routes BEFORE general ones
	// Go's ServeMux matches longest pattern, but we need specific routes first to avoid conflicts
	mux.HandleFunc("/api/sessions/share", p.handleCreateShare)        // Exact match: POST /api/sessions/share
	mux.HandleFunc("/api/sessions/shared/", p.handleGetSharedSession) // Prefix: GET /api/sessions/shared/{shareId}
	mux.HandleFunc("/api/sessions/share/", p.handleDeleteShare)       // Prefix: DELETE /api/sessions/share/{shareId}
	mux.HandleFunc("/api/sessions/", p.handleGetSessionShares)        // Prefix: GET /api/sessions/{sessionId}/shares (must be last)

	// Fallback handler
	mux.HandleFunc("/", p.handleDefault)
}

// getUserRole extracts the user's role from the Grafana plugin context
func getUserRole(r *http.Request) string {
	// Extract PluginContext from the request context
	// This is provided by the httpadapter and contains user information
	pluginContext := httpadapter.PluginConfigFromContext(r.Context())
	if pluginContext.User != nil {
		role := string(pluginContext.User.Role)
		if role != "" {
			return role
		}
	}

	// Fallback: try to get role from headers (for testing or direct API calls)
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

	// Default to most restrictive role if no role information found
	return "Viewer"
}

// isReadOnlyTool checks if a tool is read-only (safe for Viewers)
func isReadOnlyTool(toolName string) bool {
	// List of read-only Grafana tools (get, list, query, search, find, generate operations)
	readOnlyTools := map[string]bool{
		"mcp-grafana_fetch_pyroscope_profile":         true,
		"mcp-grafana_find_error_pattern_logs":         true,
		"mcp-grafana_find_slow_requests":              true,
		"mcp-grafana_generate_deeplink":               true,
		"mcp-grafana_get_alert_group":                 true,
		"mcp-grafana_get_alert_rule_by_uid":           true,
		"mcp-grafana_get_annotation_tags":             true,
		"mcp-grafana_get_annotations":                 true,
		"mcp-grafana_get_assertions":                  true,
		"mcp-grafana_get_current_oncall_users":        true,
		"mcp-grafana_get_dashboard_by_uid":            true,
		"mcp-grafana_get_dashboard_panel_queries":     true,
		"mcp-grafana_get_dashboard_property":          true,
		"mcp-grafana_get_dashboard_summary":           true,
		"mcp-grafana_get_datasource_by_name":          true,
		"mcp-grafana_get_datasource_by_uid":           true,
		"mcp-grafana_get_incident":                    true,
		"mcp-grafana_get_oncall_shift":                true,
		"mcp-grafana_get_sift_analysis":               true,
		"mcp-grafana_get_sift_investigation":          true,
		"mcp-grafana_list_alert_groups":               true,
		"mcp-grafana_list_alert_rules":                true,
		"mcp-grafana_list_contact_points":             true,
		"mcp-grafana_list_datasources":                true,
		"mcp-grafana_list_incidents":                  true,
		"mcp-grafana_list_loki_label_names":           true,
		"mcp-grafana_list_loki_label_values":          true,
		"mcp-grafana_list_oncall_schedules":           true,
		"mcp-grafana_list_oncall_teams":               true,
		"mcp-grafana_list_oncall_users":               true,
		"mcp-grafana_list_prometheus_label_names":     true,
		"mcp-grafana_list_prometheus_label_values":    true,
		"mcp-grafana_list_prometheus_metric_metadata": true,
		"mcp-grafana_list_prometheus_metric_names":    true,
		"mcp-grafana_list_pyroscope_label_names":      true,
		"mcp-grafana_list_pyroscope_label_values":     true,
		"mcp-grafana_list_pyroscope_profile_types":    true,
		"mcp-grafana_list_sift_investigations":        true,
		"mcp-grafana_list_teams":                      true,
		"mcp-grafana_list_users_by_org":               true,
		"mcp-grafana_query_loki_logs":                 true,
		"mcp-grafana_query_loki_stats":                true,
		"mcp-grafana_query_prometheus":                true,
		"mcp-grafana_search_dashboards":               true,
		"mcp-grafana_search_folders":                  true,
	}

	return readOnlyTools[toolName]
}

// canAccessTool checks if a user with the given role can access a tool
func canAccessTool(role string, toolName string) bool {
	// Admin and Editor can access all tools
	if role == "Admin" || role == "Editor" {
		return true
	}

	// Viewer can only access read-only tools
	if role == "Viewer" {
		// Non-Grafana tools are accessible to all roles
		if len(toolName) < 12 || toolName[:12] != "mcp-grafana_" {
			return true
		}
		// Grafana tools: check if read-only
		return isReadOnlyTool(toolName)
	}

	// Unknown roles default to Viewer permissions
	if len(toolName) < 12 || toolName[:12] != "mcp-grafana_" {
		return true
	}
	return isReadOnlyTool(toolName)
}

// filterToolsByRole filters the tool list based on user role
func filterToolsByRole(tools []mcp.Tool, role string) []mcp.Tool {
	// Admin and Editor get all tools
	if role == "Admin" || role == "Editor" {
		return tools
	}

	// Viewer gets filtered tools
	filtered := make([]mcp.Tool, 0, len(tools))
	for _, tool := range tools {
		if canAccessTool(role, tool.Name) {
			filtered = append(filtered, tool)
		}
	}

	return filtered
}

// handleHealth handles health check requests
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

// handleMCP handles MCP JSON-RPC requests
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

// handleMCPTools handles MCP tool listing requests (REST-style)
func (p *Plugin) handleMCPTools(w http.ResponseWriter, r *http.Request) {
	// Get user role from headers
	userRole := getUserRole(r)
	p.logger.Info("MCP tools request", "method", r.Method, "role", userRole)

	tools, err := p.mcpProxy.ListTools()
	if err != nil {
		p.logger.Error("Failed to list tools", "error", err)
		http.Error(w, fmt.Sprintf("Failed to list tools: %v", err), http.StatusInternalServerError)
		return
	}

	// Filter tools based on user role
	filteredTools := filterToolsByRole(tools, userRole)
	p.logger.Debug("Tools filtered by role", "role", userRole, "totalTools", len(tools), "filteredTools", len(filteredTools))

	w.Header().Set("Content-Type", "application/json")

	response := map[string]interface{}{
		"tools": filteredTools,
	}

	json.NewEncoder(w).Encode(response)
}

// handleMCPCallTool handles MCP tool call requests (REST-style)
func (p *Plugin) handleMCPCallTool(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get user role from headers
	userRole := getUserRole(r)

	var req struct {
		Name       string                 `json:"name"`
		Arguments  map[string]interface{} `json:"arguments"`
		OrgName    string                 `json:"orgName"`    // Org name passed in body (headers not forwarded by Grafana proxy)
		ScopeOrgId string                 `json:"scopeOrgId"` // Direct X-Scope-OrgId value if provided
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request: %v", err), http.StatusBadRequest)
		return
	}

	p.logger.Info("MCP call tool request", "tool", req.Name, "role", userRole)

	// Check if user has access to this tool
	if !canAccessTool(userRole, req.Name) {
		p.logger.Warn("Access denied to tool", "tool", req.Name, "role", userRole)
		http.Error(w, fmt.Sprintf("Access denied: %s role cannot access tool %s", userRole, req.Name), http.StatusForbidden)
		return
	}

	// Extract Org ID from request header (automatically forwarded by Grafana)
	// Org Name and Scope Org ID come from the request body (custom headers are NOT forwarded by Grafana's proxy)
	orgID := r.Header.Get("X-Grafana-Org-Id")
	if orgID == "" {
		orgID = "1" // Default to org 1 if not specified
	}
	orgName := req.OrgName
	scopeOrgId := req.ScopeOrgId

	p.logger.Debug("Tool call context", "orgID", orgID, "orgName", orgName, "scopeOrgId", scopeOrgId, "tool", req.Name)

	result, err := p.mcpProxy.CallToolWithContext(req.Name, req.Arguments, orgID, orgName, scopeOrgId)
	if err != nil {
		p.logger.Error("Failed to call tool", "error", err)
		http.Error(w, fmt.Sprintf("Failed to call tool: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// handleMCPServers handles MCP server status requests
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

// handleDefault handles all other requests
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

// getUserID extracts the user ID from the Grafana plugin context
// Note: Grafana SDK User struct may not have ID field directly
// We use Login as a unique identifier, or fallback to header
func getUserID(r *http.Request) int64 {
	pluginContext := httpadapter.PluginConfigFromContext(r.Context())
	if pluginContext.User != nil {
		// Try to get user ID from Login (hash it to int64 for storage)
		login := pluginContext.User.Login
		if login != "" {
			// Use FNV-1a hash for deterministic, collision-resistant hashing
			// FNV-1a is fast, has good distribution, and avoids overflow issues
			h := fnv.New64a()
			h.Write([]byte(login))
			hash := h.Sum64()

			// Convert uint64 to int64 safely (take lower 63 bits to ensure positive)
			// This avoids sign issues while maintaining good distribution
			return int64(hash & 0x7FFFFFFFFFFFFFFF)
		}
	}

	// Fallback: try to get from header
	userIDHeader := r.Header.Get("X-Grafana-User-Id")
	if userIDHeader != "" {
		var userID int64
		if _, err := fmt.Sscanf(userIDHeader, "%d", &userID); err == nil {
			return userID
		}
	}

	return 0
}

// stringPtr returns a pointer to a copy of the string, allocated on the heap
// This ensures the pointer remains valid after the function returns
// Go's escape analysis will move the string to the heap automatically
func stringPtr(s string) *string {
	// Create a new string allocation to ensure pointer remains valid
	// The compiler will escape this to the heap
	sCopy := s
	return &sCopy
}

// getOrgID extracts the organization ID from the request header
func getOrgID(r *http.Request) int64 {
	orgIDStr := r.Header.Get("X-Grafana-Org-Id")
	if orgIDStr == "" {
		return 1 // Default to org 1 if not specified
	}

	var orgID int64
	fmt.Sscanf(orgIDStr, "%d", &orgID)
	if orgID == 0 {
		return 1 // Default to org 1 if parsing fails
	}
	return orgID
}

// handleCreateShare handles POST /api/sessions/share
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
		ExpiresInDays  *int            `json:"expiresInDays,omitempty"`  // Deprecated: use ExpiresInHours (converted to hours internally)
		ExpiresInHours *int            `json:"expiresInHours,omitempty"` // Accepts hours directly
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request: %v", err), http.StatusBadRequest)
		return
	}

	// Validate session data
	if err := ValidateSessionData(req.SessionData); err != nil {
		p.logger.Warn("Invalid session data", "error", err)
		http.Error(w, fmt.Sprintf("Invalid session data: %v", err), http.StatusBadRequest)
		return
	}

	// Validate sessionId matches session data
	var sessionData map[string]interface{}
	if err := json.Unmarshal(req.SessionData, &sessionData); err != nil {
		http.Error(w, "Invalid session data format", http.StatusBadRequest)
		return
	}

	if sessionID, ok := sessionData["id"].(string); !ok || sessionID != req.SessionID {
		http.Error(w, "Session ID mismatch", http.StatusBadRequest)
		return
	}

	// Handle expiration: prefer ExpiresInHours, fall back to ExpiresInDays (for backward compatibility)
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
		// Convert days to hours for backward compatibility
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

	// Build share URL
	shareURL := fmt.Sprintf("/a/%s/shared/%s?orgId=%d", PluginID, share.ShareID, orgID)

	var expiresAtStr *string
	if share.ExpiresAt != nil {
		// Allocate string on heap to avoid pointer to local variable going out of scope
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

// handleGetSharedSession handles GET /api/sessions/shared/:shareId
func (p *Plugin) handleGetSharedSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract shareId from URL path
	// Path format: /api/sessions/shared/{shareId}
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

	// Get share
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

	// Validate org match
	if share.OrgID != orgID {
		http.Error(w, "You don't have access to this shared session", http.StatusForbidden)
		return
	}

	// Parse session data
	var sessionData map[string]interface{}
	if err := json.Unmarshal(share.SessionData, &sessionData); err != nil {
		p.logger.Error("Failed to parse session data", "error", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	// Add shared metadata
	sessionData["isShared"] = true
	sessionData["sharedBy"] = fmt.Sprintf("%d", share.UserID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sessionData)
}

// handleDeleteShare handles DELETE /api/sessions/share/:shareId
func (p *Plugin) handleDeleteShare(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract shareId from URL path
	// Path format: /api/sessions/share/{shareId}
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

	// Get share to verify ownership
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

	// Validate ownership
	if share.UserID != userID {
		http.Error(w, "You don't have permission to revoke this share", http.StatusForbidden)
		return
	}

	// Delete share
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

// handleGetSessionShares handles GET /api/sessions/:sessionId/shares
func (p *Plugin) handleGetSessionShares(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract sessionId from URL path
	// Path format: /api/sessions/{sessionId}/shares
	// IMPORTANT: This handler must reject paths that match more specific routes
	path := r.URL.Path

	// Reject paths that should be handled by more specific routes
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

	// Extract sessionId: remove prefix and suffix
	sessionID := strings.TrimPrefix(strings.TrimSuffix(path, suffix), prefix)
	if sessionID == "" {
		http.Error(w, "Session ID required", http.StatusBadRequest)
		return
	}

	userID := getUserID(r)

	// Get shares for session
	shares := p.shareStore.GetSharesBySession(sessionID)

	// Filter to only shares created by this user
	var userShares []map[string]interface{}
	for _, share := range shares {
		if share.UserID == userID {
			shareURL := fmt.Sprintf("/a/%s/shared/%s?orgId=%d", PluginID, share.ShareID, share.OrgID)
			var expiresAtStr *string
			if share.ExpiresAt != nil {
				// Allocate string on heap to avoid pointer to local variable going out of scope
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
