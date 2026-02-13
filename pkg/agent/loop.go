package agent

import (
	"consensys-asko11y-app/pkg/mcp"
	"consensys-asko11y-app/pkg/rbac"
	"context"
	"encoding/json"
	"fmt"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

const defaultMaxIterations = 25

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
}

func (a *AgentLoop) Run(ctx context.Context, req LoopRequest, eventCh chan<- SSEEvent) {
	defer close(eventCh)

	maxIter := req.MaxIterations
	if maxIter <= 0 {
		maxIter = defaultMaxIterations
	}
	maxTokens := req.MaxTotalTokens
	if maxTokens <= 0 {
		maxTokens = defaultMaxTotalTokens
	}

	mcpTools, err := a.mcpProxy.ListTools()
	if err != nil {
		a.logger.Error("Failed to list MCP tools, proceeding without tools", "error", err)
		mcpTools = []mcp.Tool{}
	}
	mcpTools = rbac.FilterToolsByRole(mcpTools, req.UserRole)
	openAITools := ConvertMCPToolsToOpenAI(mcpTools)

	messages := BuildContextWindow(req.SystemPrompt, req.Messages, req.Summary, req.RecentMessageCount)

	for iteration := 0; iteration < maxIter; iteration++ {
		if ctx.Err() != nil {
			return
		}

		messages = TrimMessagesToTokenLimit(messages, openAITools, maxTokens)

		a.logger.Debug("Agent loop iteration",
			"iteration", iteration,
			"messageCount", len(messages),
			"toolCount", len(openAITools))

		llmReq := ChatCompletionRequest{
			Messages: messages,
			Tools:    openAITools,
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

			toolContent, isError := a.executeTool(tc, req)

			a.send(ctx, eventCh, SSEEvent{
				Type: "tool_call_result",
				Data: ToolCallResultEvent{
					ID:      tc.ID,
					Name:    tc.Function.Name,
					Content: toolContent,
					IsError: isError,
				},
			})

			messages = append(messages, Message{
				Role:       "tool",
				ToolCallID: tc.ID,
				Content:    toolContent,
			})
		}

	}
	a.send(ctx, eventCh, SSEEvent{
		Type: "error",
		Data: ErrorEvent{Message: fmt.Sprintf("Agent loop reached maximum iterations (%d)", maxIter)},
	})
}

func (a *AgentLoop) executeTool(tc ToolCall, req LoopRequest) (content string, isError bool) {
	tool, found := a.mcpProxy.FindToolByName(tc.Function.Name)
	if !found {
		return fmt.Sprintf("Unknown tool: %s", tc.Function.Name), true
	}
	if !rbac.CanAccessTool(req.UserRole, tool) {
		return fmt.Sprintf("Access denied: %s role cannot access tool %s", req.UserRole, tc.Function.Name), true
	}

	var args map[string]interface{}
	if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err != nil {
		return fmt.Sprintf("Invalid tool arguments: %v", err), true
	}

	result, err := a.mcpProxy.CallToolWithContext(tc.Function.Name, args, req.OrgID, req.OrgName, req.ScopeOrgID)
	if err != nil {
		a.logger.Error("Tool call failed", "tool", tc.Function.Name, "error", err)
		return fmt.Sprintf("Tool call error: %v", err), true
	}

	if result.IsError {
		text := extractText(result)
		if text == "" {
			text = "Tool returned an error with no details"
		}
		return text, true
	}

	text := extractText(result)
	if text == "" {
		text = "No results returned (empty response)"
	}
	return text, false
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
