package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// Proxy aggregates multiple MCP servers
type Proxy struct {
	clients       map[string]*Client
	logger        log.Logger
	mu            sync.RWMutex
	healthMonitor *HealthMonitor
	ctx           context.Context
}

// NewProxy creates a new MCP proxy
func NewProxy(ctx context.Context, logger log.Logger) *Proxy {
	p := &Proxy{
		clients: make(map[string]*Client),
		logger:  logger,
		ctx:     ctx,
	}
	p.healthMonitor = NewHealthMonitor(p, logger)
	return p
}

// StartHealthMonitoring starts the health monitoring with the given interval
func (p *Proxy) StartHealthMonitoring(interval time.Duration) {
	p.healthMonitor.Start(interval)
}

// StopHealthMonitoring stops the health monitoring
func (p *Proxy) StopHealthMonitoring() {
	p.healthMonitor.Stop()
}

// GetHealthMonitor returns the health monitor
func (p *Proxy) GetHealthMonitor() *HealthMonitor {
	return p.healthMonitor
}

// UpdateConfig updates the proxy configuration with new server configs
func (p *Proxy) UpdateConfig(configs []ServerConfig) {
	newConfigs := make(map[string]ServerConfig)
	for _, config := range configs {
		if config.Enabled {
			newConfigs[config.ID] = config
		}
	}

	// Collect stale clients under lock, then close outside the lock
	// to avoid holding mu while blocking on network I/O.
	var stale []*Client

	p.mu.Lock()
	for id := range p.clients {
		if _, exists := newConfigs[id]; !exists {
			stale = append(stale, p.clients[id])
			delete(p.clients, id)
			p.logger.Info("Removed MCP client", "id", id)
		}
	}
	for id, config := range newConfigs {
		if _, exists := p.clients[id]; !exists {
			p.clients[id] = NewClient(p.ctx, config, p.logger)
			p.logger.Info("Added MCP client", "id", id, "url", config.URL, "type", config.Type)
		}
	}
	p.mu.Unlock()

	for _, c := range stale {
		if err := c.Close(); err != nil {
			p.logger.Warn("Failed to close removed MCP client", "error", err)
		}
	}
}

// ListTools aggregates tools from all configured MCP servers
func (p *Proxy) ListTools() ([]Tool, error) {
	p.mu.RLock()
	clients := make([]*Client, 0, len(p.clients))
	for _, client := range p.clients {
		clients = append(clients, client)
	}
	p.mu.RUnlock()

	if len(clients) == 0 {
		return []Tool{}, nil
	}

	// Fetch tools from all servers concurrently
	type result struct {
		tools []Tool
		err   error
	}

	results := make(chan result, len(clients))
	for _, client := range clients {
		go func(c *Client) {
			tools, err := c.ListTools()
			results <- result{tools: tools, err: err}
		}(client)
	}

	// Collect results
	allTools := []Tool{}
	var errors []string

	for i := 0; i < len(clients); i++ {
		res := <-results
		if res.err != nil {
			errors = append(errors, sanitizeError(res.err))
			p.logger.Warn("Failed to list tools from server", "error", sanitizeError(res.err))
		} else {
			allTools = append(allTools, res.tools...)
		}
	}

	if len(allTools) == 0 && len(errors) > 0 {
		return nil, fmt.Errorf("all servers failed: %s", strings.Join(errors, "; "))
	}

	p.logger.Debug("Listed tools from MCP servers", "total", len(allTools), "servers", len(clients))

	return allTools, nil
}

// CallTool routes a tool call to the appropriate MCP server
func (p *Proxy) CallTool(toolName string, arguments map[string]interface{}) (*CallToolResult, error) {
	return p.CallToolWithContext(toolName, arguments, "", "", "")
}

// CallToolWithContext routes a tool call to the appropriate MCP server with additional context (e.g., Org ID, Org Name, Scope Org ID)
func (p *Proxy) CallToolWithContext(toolName string, arguments map[string]interface{}, orgID string, orgName string, scopeOrgId string) (*CallToolResult, error) {
	// Extract server ID from tool name prefix
	parts := strings.SplitN(toolName, "_", 2)
	if len(parts) < 2 {
		return nil, fmt.Errorf("invalid tool name format: %s (expected serverid_toolname)", toolName)
	}

	serverID := parts[0]

	p.mu.RLock()
	client, exists := p.clients[serverID]
	p.mu.RUnlock()

	if !exists {
		return &CallToolResult{
			Content: []ContentBlock{
				{
					Type: "text",
					Text: fmt.Sprintf("Server not found: %s", serverID),
				},
			},
			IsError: true,
		}, nil
	}

	p.logger.Debug("Calling tool on MCP server", "tool", toolName, "server", serverID, "orgID", orgID, "orgName", orgName, "scopeOrgId", scopeOrgId)

	return client.CallToolWithContext(toolName, arguments, orgID, orgName, scopeOrgId)
}

// HandleMCPRequest handles an MCP JSON-RPC request
func (p *Proxy) HandleMCPRequest(reqData []byte) ([]byte, error) {
	var req MCPRequest
	if err := json.Unmarshal(reqData, &req); err != nil {
		return p.errorResponse(nil, -32700, "Parse error", nil)
	}

	p.logger.Debug("Handling MCP request", "method", req.Method, "id", req.ID)

	switch req.Method {
	case "tools/list":
		return p.handleListTools(req)
	case "tools/call":
		return p.handleCallTool(req)
	case "initialize":
		return p.handleInitialize(req)
	default:
		return p.errorResponse(req.ID, -32601, fmt.Sprintf("Method not found: %s", req.Method), nil)
	}
}

func (p *Proxy) handleInitialize(req MCPRequest) ([]byte, error) {
	result := map[string]interface{}{
		"protocolVersion": "2024-11-05",
		"capabilities": map[string]interface{}{
			"tools": map[string]interface{}{},
		},
		"serverInfo": map[string]interface{}{
			"name":    "consensys-mcp-proxy",
			"version": "1.0.0",
		},
	}

	return p.successResponse(req.ID, result)
}

func (p *Proxy) handleListTools(req MCPRequest) ([]byte, error) {
	tools, err := p.ListTools()
	if err != nil {
		return p.errorResponse(req.ID, -32603, "Internal error", sanitizeError(err))
	}

	result := ListToolsResult{
		Tools: tools,
	}

	return p.successResponse(req.ID, result)
}

func (p *Proxy) handleCallTool(req MCPRequest) ([]byte, error) {
	var params CallToolParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return p.errorResponse(req.ID, -32602, "Invalid params", err.Error())
	}

	result, err := p.CallTool(params.Name, params.Arguments)
	if err != nil {
		return p.errorResponse(req.ID, -32603, "Internal error", sanitizeError(err))
	}

	return p.successResponse(req.ID, result)
}

func (p *Proxy) successResponse(id interface{}, result interface{}) ([]byte, error) {
	resp := MCPResponse{
		JSONRPC: "2.0",
		ID:      id,
		Result:  result,
	}

	return json.Marshal(resp)
}

func (p *Proxy) errorResponse(id interface{}, code int, message string, data interface{}) ([]byte, error) {
	resp := MCPResponse{
		JSONRPC: "2.0",
		ID:      id,
		Error: &MCPError{
			Code:    code,
			Message: message,
			Data:    data,
		},
	}

	return json.Marshal(resp)
}

// Lock ordering: proxy.mu -> client.mu (must never be reversed).
func (p *Proxy) FindToolByName(name string) (Tool, bool) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	for _, client := range p.clients {
		client.mu.RLock()
		for _, t := range client.tools {
			if t.Name == name {
				client.mu.RUnlock()
				return t, true
			}
		}
		client.mu.RUnlock()
	}
	return Tool{}, false
}

func (p *Proxy) GetServerCount() int {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return len(p.clients)
}

// Close closes all MCP client connections managed by this proxy.
func (p *Proxy) Close() {
	p.mu.Lock()
	clients := make([]*Client, 0, len(p.clients))
	for _, c := range p.clients {
		clients = append(clients, c)
	}
	p.mu.Unlock()

	for _, c := range clients {
		if err := c.Close(); err != nil {
			p.logger.Warn("Failed to close MCP client", "error", err)
		}
	}
}

func (p *Proxy) EnsureServer(config ServerConfig) {
	// Capture replaced client under lock, then close it outside the lock
	// to avoid holding mu while blocking on network I/O.
	var replaced *Client

	p.mu.Lock()
	if existing, ok := p.clients[config.ID]; ok {
		if existing.config.URL == config.URL && headersEqual(existing.config.Headers, config.Headers) {
			p.mu.Unlock()
			return
		}
		replaced = existing
		p.logger.Debug("Replacing MCP client", "id", config.ID)
	}

	p.clients[config.ID] = NewClient(p.ctx, config, p.logger)
	p.mu.Unlock()

	if replaced != nil {
		if err := replaced.Close(); err != nil {
			p.logger.Warn("Failed to close replaced MCP client", "id", config.ID, "error", err)
		}
	}

	p.logger.Info("Ensured MCP client", "id", config.ID, "url", config.URL, "type", config.Type)
}

func headersEqual(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}
