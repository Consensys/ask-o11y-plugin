package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// OperationMetadata stores metadata about an OpenAPI operation
type OperationMetadata struct {
	Path    string
	Method  string
	BaseURL string
}

// Client represents an MCP client for a single server
type Client struct {
	config            ServerConfig
	logger            log.Logger
	mu                sync.RWMutex
	tools             []Tool
	mcpClient         *mcpsdk.Client
	session           *mcpsdk.ClientSession
	operationMetadata map[string]OperationMetadata
	openAPISpec       map[string]interface{}
	ctx               context.Context
	cancel            context.CancelFunc
	httpClient        *http.Client
}

// customRoundTripper wraps http.RoundTripper to add custom headers
type customRoundTripper struct {
	base       http.RoundTripper
	orgID      string
	orgName    string
	scopeOrgId string // Direct X-Scope-OrgId value (takes priority over orgName)
	config     ServerConfig
}

func (t *customRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	// Clone the request to avoid modifying the original
	req = req.Clone(req.Context())

	// Forward org headers to all MCP servers
	// Each server can choose which headers to use based on its requirements

	// X-Grafana-Org-Id: Grafana's numeric organization ID
	if t.orgID != "" {
		req.Header.Set("X-Grafana-Org-Id", t.orgID)
	}

	// X-Scope-OrgID: Tenant identifier for multi-tenant systems (Mimir/Cortex/Loki)
	// Priority: scopeOrgId (direct value) > orgName (Grafana org name as fallback)
	if t.scopeOrgId != "" {
		req.Header.Set("X-Scope-OrgID", t.scopeOrgId)
	} else if t.orgName != "" {
		req.Header.Set("X-Scope-OrgID", t.orgName)
	}

	// Add any configured headers (can override the above if needed)
	for key, value := range t.config.Headers {
		req.Header.Set(key, value)
	}

	return t.base.RoundTrip(req)
}

// NewClient creates a new MCP client
func NewClient(config ServerConfig, logger log.Logger) *Client {
	ctx, cancel := context.WithCancel(context.Background())

	return &Client{
		config:            config,
		logger:            logger,
		operationMetadata: make(map[string]OperationMetadata),
		ctx:               ctx,
		cancel:            cancel,
	}
}

// Close closes the MCP client session
func (c *Client) Close() error {
	c.cancel()
	if c.session != nil {
		return c.session.Close()
	}
	return nil
}

// connectMCP establishes a connection to an MCP server using the SDK
func (c *Client) connectMCP() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.session != nil {
		return nil // Already connected
	}

	// Create MCP client
	c.mcpClient = mcpsdk.NewClient(&mcpsdk.Implementation{
		Name:    "consensys-asko11y-app",
		Version: "1.0.0",
	}, nil)

	// Use custom HTTP client with configured headers (e.g., Authorization for built-in MCP)
	httpClient := c.httpClientWithHeaders()

	var transport mcpsdk.Transport
	var err error

	switch c.config.Type {
	case "sse":
		transport = &mcpsdk.SSEClientTransport{
			Endpoint:   c.config.URL,
			HTTPClient: httpClient,
		}
	case "streamable-http", "http+streamable":
		transport = &mcpsdk.StreamableClientTransport{
			Endpoint:   c.config.URL,
			HTTPClient: httpClient,
			MaxRetries: 3,
		}
	case "standard":
		// For standard MCP, we'll use SSE as fallback or custom implementation
		// The SDK doesn't have a generic HTTP JSON-RPC transport
		return fmt.Errorf("standard MCP type requires custom implementation")
	case "openapi":
		// OpenAPI is handled separately
		return nil
	default:
		return fmt.Errorf("unsupported MCP transport type: %s", c.config.Type)
	}

	// Use a fresh background context for connection to prevent issues with
	// reconnection when the parent context is canceled
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	c.session, err = c.mcpClient.Connect(ctx, transport, nil)
	if err != nil {
		return fmt.Errorf("failed to connect to MCP server: %w", err)
	}

	c.logger.Debug("Connected to MCP server", "type", c.config.Type, "url", c.config.URL)
	return nil
}

// httpClientWithHeaders returns an HTTP client that injects the server's configured headers
// into every request. This is used for servers that require static auth headers (e.g., the
// built-in grafana-llm-app MCP server which needs a service account Bearer token).
func (c *Client) httpClientWithHeaders() *http.Client {
	if len(c.config.Headers) == 0 {
		return http.DefaultClient
	}
	return &http.Client{
		Transport: &configHeaderRoundTripper{
			base:    http.DefaultTransport,
			headers: c.config.Headers,
		},
	}
}

// configHeaderRoundTripper injects static headers from ServerConfig into every request.
type configHeaderRoundTripper struct {
	base    http.RoundTripper
	headers map[string]string
}

func (t *configHeaderRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	for key, value := range t.headers {
		req.Header.Set(key, value)
	}
	return t.base.RoundTrip(req)
}

// connectMCPWithOrgContext establishes a connection to an MCP server with a custom HTTP client that includes org headers.
// This function always forces a reconnection to ensure the org headers are applied, even if a session already exists.
// Headers forwarded to all MCP servers:
//   - X-Grafana-Org-Id: Grafana's numeric organization ID
//   - X-Scope-OrgID: Tenant identifier (scopeOrgId takes priority over orgName)
func (c *Client) connectMCPWithOrgContext(orgID string, orgName string, scopeOrgId string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Always close existing session to ensure we reconnect with the new org context headers.
	// This prevents race conditions where a stale session without org headers could be reused.
	if c.session != nil {
		c.logger.Debug("Closing existing session to reconnect with org context", "orgID", orgID, "orgName", orgName, "scopeOrgId", scopeOrgId)
		c.session.Close()
		c.session = nil
	}

	// Create MCP client
	c.mcpClient = mcpsdk.NewClient(&mcpsdk.Implementation{
		Name:    "consensys-asko11y-app",
		Version: "1.0.0",
	}, nil)

	// Create custom HTTP client with customRoundTripper
	customHTTPClient := &http.Client{
		Transport: &customRoundTripper{
			base:       http.DefaultTransport,
			orgID:      orgID,
			orgName:    orgName,
			scopeOrgId: scopeOrgId,
			config:     c.config,
		},
	}

	var transport mcpsdk.Transport
	var err error

	switch c.config.Type {
	case "sse":
		transport = &mcpsdk.SSEClientTransport{
			Endpoint:   c.config.URL,
			HTTPClient: customHTTPClient,
		}
	case "streamable-http", "http+streamable":
		transport = &mcpsdk.StreamableClientTransport{
			Endpoint:   c.config.URL,
			HTTPClient: customHTTPClient,
			MaxRetries: 3,
		}
	case "standard":
		return fmt.Errorf("standard MCP type requires custom implementation")
	case "openapi":
		return nil
	default:
		return fmt.Errorf("unsupported MCP transport type: %s", c.config.Type)
	}

	// Use a fresh background context for connection
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	c.session, err = c.mcpClient.Connect(ctx, transport, nil)
	if err != nil {
		return fmt.Errorf("failed to connect to MCP server with org context: %w", err)
	}

	c.logger.Debug("Connected to MCP server with org context", "type", c.config.Type, "url", c.config.URL, "orgID", orgID, "orgName", orgName, "scopeOrgId", scopeOrgId)
	return nil
}

// ListTools fetches tools from the MCP server
func (c *Client) ListTools() ([]Tool, error) {
	c.mu.RLock()
	if c.tools != nil {
		cached := c.tools
		c.mu.RUnlock()
		return cached, nil
	}
	c.mu.RUnlock()

	var tools []Tool
	var err error

	switch c.config.Type {
	case "openapi":
		tools, err = c.listOpenAPITools()
	case "sse", "streamable-http", "http+streamable":
		tools, err = c.listMCPTools()
	default:
		// Fallback to standard MCP protocol
		tools, err = c.listStandardTools()
	}

	if err != nil {
		return nil, err
	}

	// Prefix tool names with server ID to avoid conflicts
	for i := range tools {
		tools[i].Name = fmt.Sprintf("%s_%s", c.config.ID, tools[i].Name)
	}

	c.mu.Lock()
	c.tools = tools
	c.mu.Unlock()

	return tools, nil
}

// normalizeJSONSchema ensures the schema has proper JSON Schema structure
// LiteLLM expects schemas to have at least type and properties fields as objects, not null
func normalizeJSONSchema(schema map[string]interface{}) map[string]interface{} {
	if schema == nil {
		schema = make(map[string]interface{})
	}

	// Ensure type is set
	if _, hasType := schema["type"]; !hasType {
		schema["type"] = "object"
	}

	// Ensure properties exists and is an object (not null)
	properties, hasProperties := schema["properties"]
	if !hasProperties || properties == nil {
		schema["properties"] = make(map[string]interface{})
	}

	// Ensure required is an array if it exists
	if required, hasRequired := schema["required"]; hasRequired {
		if required == nil {
			schema["required"] = []string{}
		}
	}

	// Recursively normalize nested $defs if they exist
	if defs, hasDefs := schema["$defs"].(map[string]interface{}); hasDefs {
		normalizedDefs := make(map[string]interface{})
		for key, def := range defs {
			if defMap, ok := def.(map[string]interface{}); ok {
				normalizedDefs[key] = normalizeJSONSchema(defMap)
			} else {
				normalizedDefs[key] = def
			}
		}
		schema["$defs"] = normalizedDefs
	}

	return schema
}

// listMCPTools lists tools using the MCP SDK
func (c *Client) listMCPTools() ([]Tool, error) {
	if err := c.connectMCP(); err != nil {
		return nil, err
	}

	// Use a fresh background context with timeout for listing tools
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	result, err := c.session.ListTools(ctx, &mcpsdk.ListToolsParams{})
	if err != nil {
		return nil, fmt.Errorf("failed to list tools: %w", err)
	}

	// Convert SDK tools to our Tool type
	tools := make([]Tool, len(result.Tools))
	for i, sdkTool := range result.Tools {
		inputSchema := make(map[string]interface{})
		if sdkTool.InputSchema != nil {
			// Convert the input schema
			schemaBytes, err := json.Marshal(sdkTool.InputSchema)
			if err != nil {
				c.logger.Warn("Failed to marshal input schema", "tool", sdkTool.Name, "error", err)
				continue
			}
			if err := json.Unmarshal(schemaBytes, &inputSchema); err != nil {
				c.logger.Warn("Failed to unmarshal input schema", "tool", sdkTool.Name, "error", err)
				continue
			}
		}

		// Normalize the schema to ensure it has the proper JSON Schema structure
		// LiteLLM expects at least a "properties" field as an object, not null
		inputSchema = normalizeJSONSchema(inputSchema)

		var annotations *ToolAnnotations
		if sdkTool.Annotations != nil {
			annotations = &ToolAnnotations{
				ReadOnlyHint:    boolPtr(sdkTool.Annotations.ReadOnlyHint),
				DestructiveHint: sdkTool.Annotations.DestructiveHint,
				IdempotentHint:  boolPtr(sdkTool.Annotations.IdempotentHint),
				OpenWorldHint:   sdkTool.Annotations.OpenWorldHint,
			}
		}

		tools[i] = Tool{
			Name:        sdkTool.Name,
			Description: sdkTool.Description,
			InputSchema: inputSchema,
			Annotations: annotations,
		}
	}

	return tools, nil
}

// CallTool calls a tool on the MCP server
func (c *Client) CallTool(toolName string, arguments map[string]interface{}) (*CallToolResult, error) {
	return c.CallToolWithContext(toolName, arguments, "", "", "")
}

func (c *Client) CallToolWithContext(toolName string, arguments map[string]interface{}, orgID string, orgName string, scopeOrgId string) (*CallToolResult, error) {
	// Remove server ID prefix from tool name
	originalName := strings.TrimPrefix(toolName, c.config.ID+"_")

	switch c.config.Type {
	case "openapi":
		return c.callOpenAPIToolWithContext(originalName, arguments, orgID, orgName, scopeOrgId)
	case "sse", "streamable-http", "http+streamable":
		return c.callMCPToolWithContext(originalName, arguments, orgID, orgName, scopeOrgId)
	default:
		// Fallback to standard MCP protocol
		return c.callStandardTool(originalName, arguments)
	}
}

// callMCPToolWithContext calls a tool using the MCP SDK with additional context (e.g., Org ID, Org Name, Scope Org ID)
// Org headers are forwarded to all MCP servers - each server can use whichever headers it needs.
func (c *Client) callMCPToolWithContext(toolName string, arguments map[string]interface{}, orgID string, orgName string, scopeOrgId string) (*CallToolResult, error) {
	// Track whether we're using org context for potential reconnection
	// Forward org headers to all MCP servers (not just specific ones)
	useOrgContext := orgID != "" || orgName != "" || scopeOrgId != ""

	// Reconnect with custom HTTP client that includes org headers.
	// connectMCPWithOrgContext handles closing the existing session atomically to prevent race conditions.
	if useOrgContext {
		c.logger.Debug("Calling tool with org context", "server", c.config.ID, "tool", toolName, "orgID", orgID, "orgName", orgName, "scopeOrgId", scopeOrgId)

		if err := c.connectMCPWithOrgContext(orgID, orgName, scopeOrgId); err != nil {
			c.logger.Error("Failed to connect to server with org context", "server", c.config.ID, "error", err, "orgID", orgID, "orgName", orgName, "scopeOrgId", scopeOrgId)
			return nil, err
		}
	} else {
		if err := c.connectMCP(); err != nil {
			return nil, err
		}
	}

	// Capture session reference safely under lock to prevent race conditions.
	// Another goroutine could close the session via connectMCPWithOrgContext between
	// when we established the connection and when we use it.
	c.mu.RLock()
	session := c.session
	c.mu.RUnlock()

	if session == nil {
		return nil, fmt.Errorf("session not established for tool call")
	}

	// Use a fresh background context with timeout for tool calls
	// This prevents issues with connection reuse and canceled parent contexts
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result, err := session.CallTool(ctx, &mcpsdk.CallToolParams{
		Name:      toolName,
		Arguments: arguments,
	})
	if err != nil {
		// If the call failed due to connection issues, try to reconnect once
		if strings.Contains(err.Error(), "connection closed") || strings.Contains(err.Error(), "client is closing") {
			c.logger.Warn("Connection closed, attempting to reconnect", "error", err, "server", c.config.ID)

			// Try to reconnect - use the same connection method as the original call
			// to preserve org context headers if they were used
			var reconnectErr error
			if useOrgContext {
				// connectMCPWithOrgContext handles session cleanup atomically
				reconnectErr = c.connectMCPWithOrgContext(orgID, orgName, scopeOrgId)
			} else {
				// Clear the session to force reconnection
				c.mu.Lock()
				if c.session != nil {
					c.session.Close()
					c.session = nil
				}
				c.mu.Unlock()
				reconnectErr = c.connectMCP()
			}

			if reconnectErr != nil {
				c.logger.Error("Failed to reconnect after connection closed", "error", reconnectErr, "server", c.config.ID)
				return nil, fmt.Errorf("failed to reconnect: %w", reconnectErr)
			}

			// Capture session reference safely under lock after reconnection
			c.mu.RLock()
			session = c.session
			c.mu.RUnlock()

			if session == nil {
				return nil, fmt.Errorf("session not established after reconnection")
			}

			// Retry the tool call with a fresh context
			retryCtx, retryCancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer retryCancel()

			result, err = session.CallTool(retryCtx, &mcpsdk.CallToolParams{
				Name:      toolName,
				Arguments: arguments,
			})
			if err != nil {
				c.logger.Error("Failed to call tool after reconnection", "error", err, "server", c.config.ID, "tool", toolName)
				return nil, fmt.Errorf("failed to call tool after reconnection: %w", err)
			}
		} else {
			c.logger.Error("Failed to call tool", "error", err, "server", c.config.ID, "tool", toolName)
			return nil, fmt.Errorf("failed to call tool: %w", err)
		}
	}

	// Log successful tool call with org context
	if useOrgContext {
		c.logger.Debug("Successfully called tool with org context", "server", c.config.ID, "tool", toolName, "orgID", orgID, "orgName", orgName, "scopeOrgId", scopeOrgId)
	}

	// Convert SDK result to our CallToolResult type
	content := make([]ContentBlock, len(result.Content))
	for i, sdkContent := range result.Content {
		// The SDK content is an interface, we need to type assert
		switch c := sdkContent.(type) {
		case *mcpsdk.TextContent:
			content[i] = ContentBlock{
				Type: "text",
				Text: c.Text,
			}
		case *mcpsdk.ImageContent:
			// Convert image content to text representation
			content[i] = ContentBlock{
				Type: "text",
				Text: fmt.Sprintf("[Image: %s]", c.MIMEType),
			}
		case *mcpsdk.EmbeddedResource:
			// Convert embedded resource content to text representation
			if c.Resource != nil && c.Resource.URI != "" {
				content[i] = ContentBlock{
					Type: "text",
					Text: fmt.Sprintf("[Resource: %s]", c.Resource.URI),
				}
			} else {
				content[i] = ContentBlock{
					Type: "text",
					Text: "[Embedded Resource]",
				}
			}
		default:
			// Unknown content type
			content[i] = ContentBlock{
				Type: "text",
				Text: "[Unknown content type]",
			}
		}
	}

	return &CallToolResult{
		Content: content,
		IsError: result.IsError,
	}, nil
}

// listOpenAPITools lists tools from an OpenAPI specification
func (c *Client) listOpenAPITools() ([]Tool, error) {
	specURL := c.config.URL
	if !strings.HasSuffix(specURL, "/openapi.json") {
		if strings.HasSuffix(specURL, "/") {
			specURL += "openapi.json"
		} else {
			specURL += "/openapi.json"
		}
	}

	req, err := http.NewRequest("GET", specURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	for key, value := range c.config.Headers {
		req.Header.Set(key, value)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch OpenAPI spec: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to fetch OpenAPI spec: status %d, body: %s", resp.StatusCode, string(body))
	}

	var spec map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&spec); err != nil {
		return nil, fmt.Errorf("failed to decode OpenAPI spec: %w", err)
	}

	// Store spec for validation
	c.mu.Lock()
	c.openAPISpec = spec
	c.mu.Unlock()

	paths, ok := spec["paths"].(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid OpenAPI spec: no paths found")
	}

	var tools []Tool
	for path, pathItem := range paths {
		pathItemMap, ok := pathItem.(map[string]interface{})
		if !ok {
			continue
		}

		for method, operation := range pathItemMap {
			if !isHTTPMethod(method) {
				continue
			}

			operationMap, ok := operation.(map[string]interface{})
			if !ok {
				continue
			}

			operationID, ok := operationMap["operationId"].(string)
			if !ok {
				continue
			}

			description := ""
			if desc, ok := operationMap["description"].(string); ok {
				description = desc
			} else if summary, ok := operationMap["summary"].(string); ok {
				description = summary
			}

			// Build input schema from parameters and request body
			schema := c.buildInputSchema(spec, operationMap)

			tools = append(tools, Tool{
				Name:        operationID,
				Description: description,
				InputSchema: schema,
			})

			// Store operation metadata
			c.mu.Lock()
			c.operationMetadata[operationID] = OperationMetadata{
				Path:   path,
				Method: strings.ToUpper(method),
			}
			c.mu.Unlock()
		}
	}

	return tools, nil
}

// buildInputSchema builds an input schema from OpenAPI operation
func (c *Client) buildInputSchema(spec map[string]interface{}, operation map[string]interface{}) map[string]interface{} {
	schema := map[string]interface{}{
		"type":       "object",
		"properties": make(map[string]interface{}),
	}
	var required []string

	// Add parameters (query, path, header)
	if params, ok := operation["parameters"].([]interface{}); ok {
		properties := schema["properties"].(map[string]interface{})
		for _, param := range params {
			paramMap, ok := param.(map[string]interface{})
			if !ok {
				continue
			}

			name, _ := paramMap["name"].(string)
			if paramSchema, ok := paramMap["schema"].(map[string]interface{}); ok {
				properties[name] = paramSchema
			}

			if req, ok := paramMap["required"].(bool); ok && req {
				required = append(required, name)
			}
		}
	}

	// Add request body schema
	if requestBody, ok := operation["requestBody"].(map[string]interface{}); ok {
		if content, ok := requestBody["content"].(map[string]interface{}); ok {
			if jsonContent, ok := content["application/json"].(map[string]interface{}); ok {
				if schemaRef, ok := jsonContent["schema"].(map[string]interface{}); ok {
					// Resolve $ref if present
					var bodySchema map[string]interface{}
					if ref, ok := schemaRef["$ref"].(string); ok {
						bodySchema = c.resolveRef(spec, ref)
						if bodySchema == nil {
							c.logger.Warn("Failed to resolve schema reference", "ref", ref)
							bodySchema = schemaRef
						}
					} else {
						bodySchema = schemaRef
					}

					if props, ok := bodySchema["properties"].(map[string]interface{}); ok {
						properties := schema["properties"].(map[string]interface{})
						for k, v := range props {
							properties[k] = v
						}
					}

					if req, ok := bodySchema["required"].([]interface{}); ok {
						for _, r := range req {
							if reqStr, ok := r.(string); ok {
								required = append(required, reqStr)
							}
						}
					}
				}
			}
		}
	}

	if len(required) > 0 {
		schema["required"] = required
	}

	return schema
}

// listStandardTools lists tools from a standard MCP server
func (c *Client) listStandardTools() ([]Tool, error) {
	url := c.config.URL
	if !strings.HasSuffix(url, "/") {
		url += "/"
	}
	url += "mcp/list-tools"

	reqBody := MCPRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "tools/list",
		Params:  json.RawMessage(`{}`),
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	for key, value := range c.config.Headers {
		req.Header.Set(key, value)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to list tools: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to list tools: status %d, body: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Tools []Tool `json:"tools"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return result.Tools, nil
}

func (c *Client) validateOpenAPIArguments(toolName string, arguments map[string]interface{}) error {
	c.mu.RLock()
	spec := c.openAPISpec
	opMetadata := c.operationMetadata[toolName]
	c.mu.RUnlock()

	if spec == nil {
		return nil
	}

	// Navigate to the operation in the spec
	paths, ok := spec["paths"].(map[string]interface{})
	if !ok {
		return nil
	}

	pathItem, ok := paths[opMetadata.Path].(map[string]interface{})
	if !ok {
		return nil
	}

	operation, ok := pathItem[strings.ToLower(opMetadata.Method)].(map[string]interface{})
	if !ok {
		return nil
	}

	// Get the request body schema
	requestBody, ok := operation["requestBody"].(map[string]interface{})
	if !ok {
		return nil
	}

	content, ok := requestBody["content"].(map[string]interface{})
	if !ok {
		return nil
	}

	jsonContent, ok := content["application/json"].(map[string]interface{})
	if !ok {
		return nil
	}

	schemaRef, ok := jsonContent["schema"].(map[string]interface{})
	if !ok {
		return nil
	}

	// Resolve $ref if present
	var schema map[string]interface{}
	if ref, ok := schemaRef["$ref"].(string); ok {
		schema = c.resolveRef(spec, ref)
		if schema == nil {
			return fmt.Errorf("failed to resolve schema reference: %s", ref)
		}
	} else {
		schema = schemaRef
	}

	// Validate required fields
	if required, ok := schema["required"].([]interface{}); ok {
		for _, reqField := range required {
			fieldName, ok := reqField.(string)
			if !ok {
				continue
			}
			if _, exists := arguments[fieldName]; !exists {
				return fmt.Errorf("missing required field: %s", fieldName)
			}
		}
	}

	// Validate and coerce field types
	if properties, ok := schema["properties"].(map[string]interface{}); ok {
		for argName, argValue := range arguments {
			propSchema, ok := properties[argName].(map[string]interface{})
			if !ok {
				continue
			}

			if expectedType, ok := propSchema["type"].(string); ok {
				actualType := getJSONType(argValue)

				// Handle integer coercion: JSON unmarshaling produces float64,
				// but OpenAPI may expect integer
				if expectedType == "integer" && actualType == "number" {
					if floatVal, ok := argValue.(float64); ok {
						// Check if it's a whole number
						if floatVal == float64(int64(floatVal)) {
							// Coerce to integer
							arguments[argName] = int64(floatVal)
							continue
						} else {
							return fmt.Errorf("field %s: expected type integer, got number (not a whole number)", argName)
						}
					}
				}

				// For other types, require exact match
				if actualType != expectedType {
					return fmt.Errorf("field %s: expected type %s, got %s", argName, expectedType, actualType)
				}
			}
		}
	}

	return nil
}

// resolveRef resolves a JSON Schema $ref pointer
func (c *Client) resolveRef(spec map[string]interface{}, ref string) map[string]interface{} {
	if !strings.HasPrefix(ref, "#/") {
		return nil
	}

	parts := strings.Split(strings.TrimPrefix(ref, "#/"), "/")
	current := spec

	for _, part := range parts {
		next, ok := current[part].(map[string]interface{})
		if !ok {
			return nil
		}
		current = next
	}

	return current
}

func getJSONType(value interface{}) string {
	switch value.(type) {
	case string:
		return "string"
	case float64, int, int32, int64:
		return "number"
	case bool:
		return "boolean"
	case []interface{}:
		return "array"
	case map[string]interface{}:
		return "object"
	case nil:
		return "null"
	default:
		return "unknown"
	}
}

// callOpenAPIToolWithContext calls a tool on an OpenAPI server with additional context (e.g., Org ID, Org Name, Scope Org ID)
// Org headers are forwarded to all OpenAPI servers - each server can use whichever headers it needs.
func (c *Client) callOpenAPIToolWithContext(toolName string, arguments map[string]interface{}, orgID string, orgName string, scopeOrgId string) (*CallToolResult, error) {
	// Track whether we're using org context
	useOrgContext := orgID != "" || orgName != "" || scopeOrgId != ""

	if useOrgContext {
		c.logger.Debug("Calling OpenAPI tool with org context", "server", c.config.ID, "tool", toolName, "orgID", orgID, "orgName", orgName, "scopeOrgId", scopeOrgId)
	}

	// Strip server ID prefix from tool name to get the original operation ID
	unprefixedName, _ := strings.CutPrefix(toolName, c.config.ID+"_")

	// Get operation metadata using unprefixed name
	c.mu.RLock()
	opMetadata, exists := c.operationMetadata[unprefixedName]
	c.mu.RUnlock()

	if !exists {
		c.mu.RLock()
		available := make([]string, 0, len(c.operationMetadata))
		for k := range c.operationMetadata {
			available = append(available, k)
		}
		c.mu.RUnlock()
		return nil, fmt.Errorf("operation metadata not found for tool: %s (available: %v)", unprefixedName, available)
	}

	// Validate arguments against OpenAPI schema
	if err := c.validateOpenAPIArguments(unprefixedName, arguments); err != nil {
		return nil, fmt.Errorf("argument validation failed: %w", err)
	}

	// Construct the full URL
	// The config.URL already includes any base path (e.g., http://mcpo:8000/time)
	// So we only need to append the operation path
	baseURL := strings.TrimSuffix(c.config.URL, "/")
	url := baseURL + opMetadata.Path

	// Marshal arguments as request body
	body, err := json.Marshal(arguments)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal arguments: %w", err)
	}

	req, err := http.NewRequest(opMetadata.Method, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	// Forward org headers to all OpenAPI servers - each server can use whichever headers it needs.
	// X-Grafana-Org-Id: Grafana's numeric organization ID
	if orgID != "" {
		req.Header.Set("X-Grafana-Org-Id", orgID)
	}

	// X-Scope-OrgID: Tenant identifier for multi-tenant systems (Mimir/Cortex/Loki)
	// Priority: scopeOrgId (direct value) > orgName (Grafana org name as fallback)
	if scopeOrgId != "" {
		req.Header.Set("X-Scope-OrgID", scopeOrgId)
	} else if orgName != "" {
		req.Header.Set("X-Scope-OrgID", orgName)
	}

	// Add any configured headers (can override the above if needed)
	for key, value := range c.config.Headers {
		req.Header.Set(key, value)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to call tool: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return &CallToolResult{
			Content: []ContentBlock{
				{
					Type: "text",
					Text: fmt.Sprintf("Error: %s", string(respBody)),
				},
			},
			IsError: true,
		}, nil
	}

	// Log successful tool call with org context
	if useOrgContext {
		c.logger.Debug("Successfully called OpenAPI tool with org context", "server", c.config.ID, "tool", toolName, "orgID", orgID, "orgName", orgName, "scopeOrgId", scopeOrgId)
	}

	return &CallToolResult{
		Content: []ContentBlock{
			{
				Type: "text",
				Text: string(respBody),
			},
		},
	}, nil
}

// callStandardTool calls a tool on a standard MCP server
func (c *Client) callStandardTool(toolName string, arguments map[string]interface{}) (*CallToolResult, error) {
	url := c.config.URL
	if !strings.HasSuffix(url, "/") {
		url += "/"
	}
	url += "mcp/call-tool"

	params := CallToolParams{
		Name:      toolName,
		Arguments: arguments,
	}

	paramsJSON, err := json.Marshal(params)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal params: %w", err)
	}

	reqBody := MCPRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "tools/call",
		Params:  paramsJSON,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	for key, value := range c.config.Headers {
		req.Header.Set(key, value)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to call tool: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return &CallToolResult{
			Content: []ContentBlock{
				{
					Type: "text",
					Text: fmt.Sprintf("Error: %s", string(body)),
				},
			},
			IsError: true,
		}, nil
	}

	var result CallToolResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// isHTTPMethod checks if the given string is a valid HTTP method
func isHTTPMethod(method string) bool {
	methods := []string{"get", "post", "put", "delete", "patch", "options", "head"}
	for _, m := range methods {
		if strings.ToLower(method) == m {
			return true
		}
	}
	return false
}
