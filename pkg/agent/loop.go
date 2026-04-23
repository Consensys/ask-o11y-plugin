package agent

import (
	"consensys-asko11y-app/pkg/mcp"
	"consensys-asko11y-app/pkg/rbac"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/backend/tracing"
)

const defaultMaxIterations = 25
const defaultMaxCompletionTokens = 4096
const minCompletionTokens = 512

// nearLimitWarning is injected as a one-shot system message on the second-to-last
// iteration to steer the LLM toward a honest final answer instead of fabricating
// around missing data when the loop is about to abort at maxIter.
const nearLimitWarning = "[SYSTEM: You are approaching the iteration limit. Produce a final answer NOW based ONLY on tool results you have actually retrieved this session. If you lack data, say so explicitly — do not fabricate.]"

type AgentLoop struct {
	llmClient *LLMClient
	mcpProxy  *mcp.Proxy
	logger    log.Logger
}

func NewAgentLoop(llmClient *LLMClient, mcpProxy *mcp.Proxy, logger log.Logger) *AgentLoop {
	return &AgentLoop{
		llmClient: llmClient,
		mcpProxy:  mcpProxy,
		logger:    logger,
	}
}

type LoopRequest struct {
	Messages           []Message
	SystemPrompt       string
	Summary            string
	MaxTotalTokens     int
	RecentMessageCount int
	MaxIterations      int

	GrafanaURL string
	AuthToken  string

	UserRole   string
	OrgID      string
	OrgName    string
	ScopeOrgID string

	// ExcludeToolNames, when set, removes these tools from the available set
	// before the loop runs. Used to hide graphiti write tools from user sessions.
	ExcludeToolNames []string
}

func (a *AgentLoop) Run(ctx context.Context, req LoopRequest, eventCh chan<- SSEEvent) {
	defer close(eventCh)

	maxIter := req.MaxIterations
	if maxIter <= 0 {
		maxIter = defaultMaxIterations
	}
	maxTokens := req.MaxTotalTokens
	if maxTokens <= 0 {
		maxTokens = DefaultMaxTotalTokens
	}
	completionBudget := completionTokenBudget(maxTokens)
	promptBudget := maxTokens - completionBudget

	mcpTools, err := a.mcpProxy.ListTools()
	if err != nil {
		a.logger.Error("Failed to list MCP tools, proceeding without tools", "error", err)
		mcpTools = []mcp.Tool{}
	}
	mcpTools = rbac.FilterToolsByRole(mcpTools, req.UserRole)
	if len(req.ExcludeToolNames) > 0 {
		excluded := make(map[string]bool, len(req.ExcludeToolNames))
		for _, n := range req.ExcludeToolNames {
			excluded[n] = true
		}
		var filtered []mcp.Tool
		for _, t := range mcpTools {
			if !excluded[t.Name] {
				filtered = append(filtered, t)
			}
		}
		mcpTools = filtered
	}
	openAITools := ConvertMCPToolsToOpenAI(mcpTools)

	toolTokens := estimateToolTokens(openAITools)
	if toolTokens > maxToolDefinitionTokens {
		a.logger.Warn("Tool definitions exceed token threshold, compressing descriptions to reduce LLM token usage",
			"toolCount", len(openAITools),
			"estimatedToolTokens", toolTokens,
			"maxToolDefinitionTokens", maxToolDefinitionTokens,
		)
		openAITools = TrimToolsToTokenBudget(openAITools, maxToolDefinitionTokens)
	}

	messages := BuildContextWindow(req.SystemPrompt, req.Messages, req.Summary, req.RecentMessageCount)

	// Per-run state for transport-failure aggregation. We emit at most one
	// mcp_unavailable event per run, once at least 2 distinct tools have hit
	// transport errors — that's a strong enough signal to tell the user MCP
	// is down rather than letting the agent chain fabricated summaries.
	transportFailedTools := map[string]struct{}{}
	mcpUnavailableEmitted := false

	for iteration := 0; iteration < maxIter; iteration++ {
		if ctx.Err() != nil {
			return
		}

		messages = TrimMessagesToTokenLimit(messages, openAITools, promptBudget)

		a.logger.Debug("Agent loop iteration",
			"iteration", iteration,
			"messageCount", len(messages),
			"toolCount", len(openAITools))

		// One-shot warning on the second-to-last iteration so the LLM produces a
		// final answer from tool results it actually retrieved rather than
		// fabricating a summary when the loop aborts at maxIter.
		callMessages := messages
		if maxIter >= 2 && iteration == maxIter-2 {
			callMessages = append(append([]Message{}, messages...), Message{
				Role:    "system",
				Content: nearLimitWarning,
			})
		}

		llmReq := ChatCompletionRequest{
			Messages:  callMessages,
			Tools:     openAITools,
			MaxTokens: completionBudget,
		}
		resp, err := a.llmClient.ChatCompletion(ctx, llmReq, req.GrafanaURL, req.AuthToken, req.OrgID)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			a.send(ctx, eventCh, SSEEvent{
				Type: "error",
				Data: ErrorEvent{Message: fmt.Sprintf("LLM error: %v", err)},
			})
			return
		}

		msg := resp.Choices[0].Message

		if len(msg.ToolCalls) == 0 {
			if msg.Content != "" {
				a.send(ctx, eventCh, SSEEvent{
					Type: "content",
					Data: ContentEvent{Content: msg.Content},
				})
			}
			a.send(ctx, eventCh, SSEEvent{
				Type: "done",
				Data: DoneEvent{TotalIterations: iteration + 1},
			})
			return
		}

		msg.Content = ""
		messages = append(messages, msg)

		for _, tc := range msg.ToolCalls {
			if ctx.Err() != nil {
				return
			}

			a.send(ctx, eventCh, SSEEvent{
				Type: "tool_call_start",
				Data: ToolCallStartEvent{
					ID:        tc.ID,
					Name:      tc.Function.Name,
					Arguments: tc.Function.Arguments,
				},
			})

			toolContent, isError, errorKind := a.executeTool(ctx, tc, req)

			a.send(ctx, eventCh, SSEEvent{
				Type: "tool_call_result",
				Data: ToolCallResultEvent{
					ID:        tc.ID,
					Name:      tc.Function.Name,
					Content:   toolContent,
					IsError:   isError,
					ErrorKind: errorKind,
				},
			})

			// LLM-facing content: when the failure is a transport outage, replace
			// the raw error text with a directive so the model sees that result
			// is UNAVAILABLE and must not fabricate around it. The SSE event
			// above still carries the raw content so the user sees real errors.
			llmContent := toolContent
			if errorKind == "transport" {
				llmContent = fmt.Sprintf("[SYSTEM: MCP transport failure for tool '%s' after retries. Result is UNAVAILABLE — do not fabricate output. Either retry this tool once, or tell the user the data is currently unavailable.]", tc.Function.Name)
				transportFailedTools[tc.Function.Name] = struct{}{}
			}
			messages = append(messages, Message{
				Role:       "tool",
				ToolCallID: tc.ID,
				Content:    llmContent,
			})

			if !mcpUnavailableEmitted && len(transportFailedTools) >= 2 {
				mcpUnavailableEmitted = true
				a.send(ctx, eventCh, SSEEvent{
					Type: "mcp_unavailable",
					Data: MCPUnavailableEvent{
						Message: "MCP server unreachable — results may be incomplete. Please retry.",
					},
				})
			}
		}

	}
	a.send(ctx, eventCh, SSEEvent{
		Type: "error",
		Data: ErrorEvent{Message: fmt.Sprintf("Agent loop reached maximum iterations (%d)", maxIter)},
	})
}

func completionTokenBudget(maxTotalTokens int) int {
	if maxTotalTokens <= 0 {
		return defaultMaxCompletionTokens
	}

	budget := maxTotalTokens / 8
	if budget < minCompletionTokens {
		budget = minCompletionTokens
	}
	if half := maxTotalTokens / 2; half > 0 && budget > half {
		budget = half
	}
	if budget > defaultMaxCompletionTokens {
		budget = defaultMaxCompletionTokens
	}
	return budget
}

func (a *AgentLoop) executeTool(ctx context.Context, tc ToolCall, req LoopRequest) (content string, isError bool, errorKind string) {
	_, span := tracing.DefaultTracer().Start(ctx, "mcp_tool_call",
		trace.WithAttributes(attribute.String("mcp.tool_name", tc.Function.Name)))
	defer func() {
		span.SetAttributes(attribute.Bool("mcp.is_error", isError))
		if errorKind != "" {
			span.SetAttributes(attribute.String("mcp.error_kind", errorKind))
		}
		span.End()
	}()

	tool, found := a.mcpProxy.FindToolByName(tc.Function.Name)
	if !found {
		return fmt.Sprintf("Unknown tool: %s", tc.Function.Name), true, "tool"
	}
	if !rbac.CanAccessTool(req.UserRole, tool) {
		return fmt.Sprintf("Access denied: %s role cannot access tool %s", req.UserRole, tc.Function.Name), true, "tool"
	}

	var args map[string]interface{}
	if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err != nil {
		return fmt.Sprintf("Invalid tool arguments: %v", err), true, "tool"
	}
	ensureScopedGraphitiArgs(tool, args, req.OrgID)

	result, err := a.mcpProxy.CallToolWithContext(tc.Function.Name, args, req.OrgID, req.OrgName, req.ScopeOrgID)
	if err != nil {
		a.logger.Error("Tool call failed", "tool", tc.Function.Name, "error", err)
		var te *mcp.TransportError
		if errors.As(err, &te) {
			return fmt.Sprintf("Tool call error: %v", err), true, "transport"
		}
		return fmt.Sprintf("Tool call error: %v", err), true, "protocol"
	}

	if result.IsError {
		text := extractText(result)
		if text == "" {
			text = "Tool returned an error with no details"
		}
		return text, true, "tool"
	}

	text := extractText(result)
	if text == "" {
		text = "No results returned (empty response)"
	}
	return text, false, ""
}

func ensureScopedGraphitiArgs(tool mcp.Tool, args map[string]interface{}, orgID string) {
	if orgID == "" || !strings.HasPrefix(tool.Name, "graphiti_") {
		return
	}

	properties, ok := tool.InputSchema["properties"].(map[string]interface{})
	if !ok || properties["group_id"] == nil {
		return
	}

	// Always force group_id to the org-scoped value — never trust LLM-supplied
	// values, which would break multi-org data isolation.
	args["group_id"] = "org_" + orgID
}

func extractText(result *mcp.CallToolResult) string {
	var out string
	for _, block := range result.Content {
		if block.Type == "text" {
			if out != "" {
				out += "\n"
			}
			out += block.Text
		}
	}
	return out
}

func (a *AgentLoop) send(ctx context.Context, ch chan<- SSEEvent, event SSEEvent) {
	select {
	case ch <- event:
	case <-ctx.Done():
	}
}
