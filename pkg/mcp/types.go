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

// Pointers so omitempty distinguishes "explicitly false" from "not set".
type ToolAnnotations struct {
	ReadOnlyHint    *bool `json:"readOnlyHint,omitempty"`
	DestructiveHint *bool `json:"destructiveHint,omitempty"`
	IdempotentHint  *bool `json:"idempotentHint,omitempty"`
	OpenWorldHint   *bool `json:"openWorldHint,omitempty"`
}

// Tool represents an MCP tool definition
type Tool struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description,omitempty"`
	InputSchema map[string]interface{} `json:"inputSchema"`
	Annotations *ToolAnnotations       `json:"annotations,omitempty"`
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

func boolPtr(b bool) *bool { return &b }

// Preserves nil (unspecified) for RBAC instead of mapping false → *bool(false).
func boolPtrTrueOnly(b bool) *bool {
	if !b {
		return nil
	}
	return boolPtr(true)
}

// ServerConfig represents configuration for an MCP server
type ServerConfig struct {
	ID      string            `json:"id"`
	Name    string            `json:"name"`
	URL     string            `json:"url"`
	Type    string            `json:"type"` // "openapi", "standard", "sse", "streamable-http"
	Enabled bool              `json:"enabled"`
	Headers map[string]string `json:"headers,omitempty"`
	// OAuth, when set, makes the server authenticate per Grafana user via an
	// OAuth2 authorization-code flow. The static Authorization entry in Headers
	// is ignored for OAuth-enabled servers; each user's access token is
	// injected per request by the OAuth round tripper.
	OAuth *OAuthConfig `json:"oauth,omitempty"`
}

// OAuthConfig declares how to run the authorization-code flow for a server.
type OAuthConfig struct {
	AuthorizationURL string   `json:"authorizationURL"`
	TokenURL         string   `json:"tokenURL"`
	ClientID         string   `json:"clientID"`
	ClientSecret     string   `json:"clientSecret,omitempty"`
	Scopes           []string `json:"scopes,omitempty"`
	// PKCE enables RFC 7636 code_challenge. Strongly recommended when the
	// authorization server supports it, required when clientSecret is empty.
	PKCE bool `json:"pkce,omitempty"`
	// RedirectURI is the callback URL registered with the authorization
	// server. Must match the path this plugin serves at
	// /api/plugins/consensys-asko11y-app/resources/api/oauth/{serverID}/callback.
	// When empty the handler derives it from the incoming request, but that
	// only works if the provider allows dynamic redirect URIs.
	RedirectURI string `json:"redirectURI,omitempty"`
}
