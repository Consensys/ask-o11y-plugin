package plugin

import (
	"consensys-asko11y-app/pkg/mcp"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/backend/resource/httpadapter"
)

// Make sure Plugin implements required interfaces
var (
	_ backend.CallResourceHandler   = (*Plugin)(nil)
	_ instancemgmt.InstanceDisposer = (*Plugin)(nil)
	_ backend.CheckHealthHandler    = (*Plugin)(nil)
)

// PluginSettings represents the plugin configuration
type PluginSettings struct {
	MCPServers []mcp.ServerConfig `json:"mcpServers"`
}

// Plugin is the backend plugin implementation
type Plugin struct {
	backend.CallResourceHandler
	logger   log.Logger
	mcpProxy *mcp.Proxy
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

	// Start health monitoring with 30 second intervals
	mcpProxy.StartHealthMonitoring(30 * time.Second)

	p := &Plugin{
		logger:   logger,
		mcpProxy: mcpProxy,
	}

	// Setup resource handler using httpadapter
	mux := http.NewServeMux()
	p.registerRoutes(mux)
	p.CallResourceHandler = httpadapter.New(mux)

	logger.Info("Plugin initialized",
		"pluginId", "consensys-asko11y-app",
		"mcpServers", mcpProxy.GetServerCount())

	return p, nil
}

// Dispose cleans up plugin resources
func (p *Plugin) Dispose() {
	p.mcpProxy.StopHealthMonitoring()
	p.logger.Info("Plugin disposed")
}

// CheckHealth handles health checks for the backend plugin
func (p *Plugin) CheckHealth(ctx context.Context, req *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	p.logger.Info("CheckHealth called")

	serverCount := p.mcpProxy.GetServerCount()
	message := fmt.Sprintf("Plugin is healthy (MCP servers: %d)", serverCount)

	return &backend.CheckHealthResult{
		Status:  backend.HealthStatusOk,
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
