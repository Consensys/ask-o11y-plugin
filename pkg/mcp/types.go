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
	ReadOnlyHint    *bool  `json:"readOnlyHint,omitempty"`
	DestructiveHint *bool  `json:"destructiveHint,omitempty"`
	IdempotentHint  *bool  `json:"idempotentHint,omitempty"`
	OpenWorldHint   *bool  `json:"openWorldHint,omitempty"`
	Title           string `json:"title,omitempty"`
}

// Tool represents an MCP tool definition
type Tool struct {
	Name         string                 `json:"name"`
	Title        string                 `json:"title,omitempty"`
	Description  string                 `json:"description,omitempty"`
	InputSchema  map[string]interface{} `json:"inputSchema"`
	OutputSchema map[string]interface{} `json:"outputSchema,omitempty"`
	Annotations  *ToolAnnotations       `json:"annotations,omitempty"`
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
	Content           []ContentBlock `json:"content"`
	StructuredContent interface{}    `json:"structuredContent,omitempty"`
	IsError           bool           `json:"isError,omitempty"`
}

// ContentBlock represents a content block in the response
type ContentBlock struct {
	Type        string                 `json:"type"`
	Text        string                 `json:"text,omitempty"`
	Data        string                 `json:"data,omitempty"`
	MimeType    string                 `json:"mimeType,omitempty"`
	URI         string                 `json:"uri,omitempty"`
	Name        string                 `json:"name,omitempty"`
	Title       string                 `json:"title,omitempty"`
	Description string                 `json:"description,omitempty"`
	Resource    map[string]interface{} `json:"resource,omitempty"`
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
	ID             string                      `json:"id"`
	Name           string                      `json:"name"`
	URL            string                      `json:"url"`
	Type           string                      `json:"type"` // "openapi", "standard", "sse", "streamable-http"
	Enabled        bool                        `json:"enabled"`
	Trusted        bool                        `json:"trusted,omitempty"`
	Headers        map[string]string           `json:"headers,omitempty"`
	ToolSelections map[string]bool             `json:"toolSelections,omitempty"`
	RiskOverrides  map[string]ToolRiskOverride `json:"riskOverrides,omitempty"`
}

// ToolRiskOverride lets administrators override a tool's MCP annotations or
// heuristic risk classification without exposing secrets to the browser.
type ToolRiskOverride struct {
	RequiresApproval *bool  `json:"requiresApproval,omitempty"`
	ReadOnly         *bool  `json:"readOnly,omitempty"`
	Destructive      *bool  `json:"destructive,omitempty"`
	OpenWorld        *bool  `json:"openWorld,omitempty"`
	Reason           string `json:"reason,omitempty"`
}
