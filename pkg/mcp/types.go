package mcp

import (
	"encoding/json"
)

// MCPRequest represents an MCP protocol request
type MCPRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      interface{}     `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// MCPResponse represents an MCP protocol response
type MCPResponse struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      interface{} `json:"id"`
	Result  interface{} `json:"result,omitempty"`
	Error   *MCPError   `json:"error,omitempty"`
}

// MCPError represents an MCP error
type MCPError struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

// Tool represents an MCP tool definition
type Tool struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description,omitempty"`
	InputSchema map[string]interface{} `json:"inputSchema"`
}

// ListToolsResult represents the result of listing tools
type ListToolsResult struct {
	Tools []Tool `json:"tools"`
}

// CallToolParams represents parameters for calling a tool
type CallToolParams struct {
	Name      string                 `json:"name"`
	Arguments map[string]interface{} `json:"arguments,omitempty"`
}

// CallToolResult represents the result of calling a tool
type CallToolResult struct {
	Content []ContentBlock `json:"content"`
	IsError bool           `json:"isError,omitempty"`
}

// ContentBlock represents a content block in the response
type ContentBlock struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

// AuthType represents the authentication method for an MCP server
type AuthType string

const (
	AuthTypeNone    AuthType = "none"
	AuthTypeHeaders AuthType = "headers"
	AuthTypeOAuth   AuthType = "oauth2.1"
)

// OAuth2Config represents OAuth 2.1 configuration for an MCP server
type OAuth2Config struct {
	ClientID               string   `json:"clientId,omitempty"`
	ClientSecret           string   `json:"clientSecret,omitempty"`
	DiscoveryURL           string   `json:"discoveryUrl,omitempty"`
	AuthorizationEndpoint  string   `json:"authorizationEndpoint,omitempty"`
	TokenEndpoint          string   `json:"tokenEndpoint,omitempty"`
	RegistrationEndpoint   string   `json:"registrationEndpoint,omitempty"`
	Scopes                 []string `json:"scopes,omitempty"`
	Resource               string   `json:"resource,omitempty"`
	TokenStatus            string   `json:"tokenStatus,omitempty"`
	TokenExpiresAt         string   `json:"tokenExpiresAt,omitempty"`
	LastError              string   `json:"lastError,omitempty"`
	UseDynamicRegistration bool     `json:"useDynamicRegistration,omitempty"`
}

// ServerConfig represents configuration for an MCP server
type ServerConfig struct {
	ID       string            `json:"id"`
	Name     string            `json:"name"`
	URL      string            `json:"url"`
	Type     string            `json:"type"` // "openapi", "standard", "sse", "streamable-http"
	Enabled  bool              `json:"enabled"`
	Headers  map[string]string `json:"headers,omitempty"` // Used when AuthType is "headers"
	AuthType AuthType          `json:"authType,omitempty"` // Authentication method (defaults to "headers")
	OAuth    *OAuth2Config     `json:"oauth,omitempty"`    // OAuth 2.1 configuration (used when AuthType is "oauth2.1")
}
