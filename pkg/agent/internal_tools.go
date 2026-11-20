package agent

import (
	"context"
	"strings"

	"consensys-asko11y-app/pkg/mcp"
)

// filterToolsByAllowlist keeps exactly the named MCP tools. Used by the
// workflow runner to scope an unattended session to its provisioned set.
func filterToolsByAllowlist(tools []mcp.Tool, allow []string) []mcp.Tool {
	if len(allow) == 0 {
		return tools
	}
	allowed := make(map[string]bool, len(allow))
	for _, n := range allow {
		allowed[n] = true
	}
	filtered := make([]mcp.Tool, 0, len(tools))
	for _, t := range tools {
		if allowed[t.Name] {
			filtered = append(filtered, t)
		}
	}
	return filtered
}

// InternalTool is a tool the plugin injects into one run's loop request. It
// is dispatched inside the agent loop, bypasses the MCP proxy, and never
// appears in the interactive tool catalog: it exists only for the run whose
// LoopRequest carries it. This is how the workflow runner exposes
// spawn_session and share_session to workflow sessions without registering
// them anywhere an interactive user could list or call them.
type InternalTool struct {
	Name        string
	Description string
	// Parameters is the JSON-schema "parameters" object of the function spec.
	Parameters map[string]interface{}
	// Handler receives the raw JSON arguments string. It returns the tool
	// content and an error flag, mirroring MCP tool-result semantics: an
	// error result is shown to the model as a failed call, never a panic.
	Handler func(ctx context.Context, arguments string) (content string, isError bool)
}

// spec renders the tool as an OpenAI function definition.
func (t InternalTool) spec() OpenAITool {
	return OpenAITool{
		Type: "function",
		Function: OpenAIFunction{
			Name:        t.Name,
			Description: t.Description,
			Parameters:  t.Parameters,
		},
	}
}

// internalTool returns the injected tool with that name, if this run has one.
func (r LoopRequest) internalTool(name string) (InternalTool, bool) {
	for _, t := range r.InternalTools {
		if t.Name == name {
			return t, true
		}
	}
	return InternalTool{}, false
}

// allowTool reports whether an MCP tool name is in this run's allowlist. An
// empty allowlist allows every tool — interactive runs never set it.
func (r LoopRequest) allowTool(name string) bool {
	if len(r.AllowToolNames) == 0 {
		return true
	}
	for _, n := range r.AllowToolNames {
		if n == name {
			return true
		}
	}
	return false
}

// executeInternalTool runs an injected tool. Errors are returned as tool
// errors so the model can react to them, exactly like MCP tool failures.
func (a *AgentLoop) executeInternalTool(ctx context.Context, tc ToolCall, it InternalTool) (content string, isError bool, errorKind string) {
	content, isError = it.Handler(ctx, tc.Function.Arguments)
	if strings.TrimSpace(content) == "" {
		content = "No results returned (empty response)"
	}
	if isError {
		return content, true, "tool"
	}
	return content, false, ""
}
