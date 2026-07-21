package agent

import (
	"consensys-asko11y-app/pkg/mcp"
	"consensys-asko11y-app/pkg/rbac"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

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
	Model              string
	AllowModelFallback bool
	ConversationType   string

	GrafanaURL string
	AuthToken  string

	UserRole   string
	OrgID      string
	OrgName    string
	ScopeOrgID string

	// ExcludeToolNames, when set, removes these tools from the available set
	// before the loop runs. Used to hide graphiti write tools from user sessions.
	ExcludeToolNames []string

	// MCPServers carries per-server tool-selection settings, used to honor the
	// user's Manage Tools choices inside the agent loop (not just at HTTP edges).
	MCPServers []mcp.ServerConfig

	ApprovalPolicy       string
	MaxParallelToolCalls int
	RegisterApproval     ApprovalRegistrar
	CheckApprovalGrant   ApprovalGrantChecker
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
	mcpTools = mcp.FilterToolsBySelection(mcpTools, req.MCPServers)
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
			Model:     req.Model,
			Messages:  callMessages,
			Tools:     openAITools,
			MaxTokens: completionBudget,
		}
		resp, err := a.chatCompletionWithFallback(ctx, llmReq, req)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			a.send(ctx, eventCh, SSEEvent{
				Type: "error",
				Data: llmErrorEvent(err),
			})
			return
		}

		msg := resp.Choices[0].Message

		if len(msg.ToolCalls) == 0 {
			if msg.Content != "" {
				a.send(ctx, eventCh, SSEEvent{
					Type: "final_report",
					Data: FinalReportEvent{
						Verdict:    finalReportVerdict(req.ConversationType),
						Confidence: "medium",
						Summary:    summarizeFinalContent(msg.Content),
					},
				})
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

			toolContent, isError, errorKind := a.executeToolWithApproval(ctx, eventCh, tc, req)

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
			if !isError {
				a.send(ctx, eventCh, SSEEvent{
					Type: "evidence",
					Data: EvidenceEvent{
						ID:       tc.ID,
						Title:    evidenceTitle(tc.Function.Name),
						Summary:  summarizeToolEvidence(toolContent),
						Source:   "mcp",
						ToolName: tc.Function.Name,
						Query:    extractEvidenceQuery(tc.Function.Arguments),
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

func (a *AgentLoop) chatCompletionWithFallback(ctx context.Context, llmReq ChatCompletionRequest, req LoopRequest) (*ChatCompletionResponse, error) {
	resp, err := a.llmClient.ChatCompletion(ctx, llmReq, req.GrafanaURL, req.AuthToken, req.OrgID)
	if err == nil {
		return resp, nil
	}

	var llmErr *LLMHTTPError
	if !req.AllowModelFallback || llmReq.Model != "large" || !errors.As(err, &llmErr) || llmErr.StatusCode < 500 {
		return nil, err
	}

	fallbackReq := llmReq
	fallbackReq.Model = "base"
	a.logger.Warn("LLM large model failed; retrying auto-selected run with base model",
		"status", llmErr.StatusCode,
		"requestId", llmErr.RequestID,
		"messageCount", llmErr.MessageCount,
		"toolCount", llmErr.ToolCount)

	resp, fallbackErr := a.llmClient.ChatCompletion(ctx, fallbackReq, req.GrafanaURL, req.AuthToken, req.OrgID)
	if fallbackErr != nil {
		a.logger.Warn("LLM base fallback failed", "error", fallbackErr)
		return nil, fallbackErr
	}

	a.logger.Info("LLM base fallback succeeded after large model failure", "requestId", llmErr.RequestID)
	return resp, nil
}

func llmErrorEvent(err error) ErrorEvent {
	var llmErr *LLMHTTPError
	if errors.As(err, &llmErr) {
		return ErrorEvent{
			Message:    llmErr.UserMessage(),
			Code:       llmErr.Code(),
			StatusCode: llmErr.StatusCode,
			RequestID:  llmErr.RequestID,
			Retryable:  llmErr.Retryable,
		}
	}
	return ErrorEvent{
		Message: fmt.Sprintf("LLM error: %v", err),
		Code:    "llm_error",
	}
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
	if !mcp.IsToolEnabled(tc.Function.Name, req.MCPServers) {
		return fmt.Sprintf("Tool %s is disabled in MCP server settings", tc.Function.Name), true, "tool"
	}

	var args map[string]interface{}
	if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err != nil {
		return fmt.Sprintf("Invalid tool arguments: %v", err), true, "tool"
	}
	mcp.EnsureScopedGraphitiArgs(tool, args, req.OrgID)

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

func (a *AgentLoop) executeToolWithApproval(ctx context.Context, eventCh chan<- SSEEvent, tc ToolCall, req LoopRequest) (content string, isError bool, errorKind string) {
	tool, found := a.mcpProxy.FindToolByName(tc.Function.Name)
	if !found {
		return a.executeTool(ctx, tc, req)
	}

	risk := mcp.ClassifyToolRisk(tool, req.MCPServers)
	if !approvalPolicyEnabled(req.ApprovalPolicy) || !risk.RequiresApproval {
		return a.executeTool(ctx, tc, req)
	}

	approval := ApprovalRequestEvent{
		ApprovalID: tc.ID,
		ToolCallID: tc.ID,
		ToolName:   tc.Function.Name,
		Risk:       riskLabel(risk),
		Reason:     risk.Reason,
		Arguments:  tc.Function.Arguments,
	}

	if req.CheckApprovalGrant != nil {
		granted, err := req.CheckApprovalGrant(ctx, approval)
		if err != nil {
			a.logger.Warn("Failed to check saved approval grant", "error", err, "tool", tc.Function.Name)
		} else if granted {
			resolved := ApprovalResolvedEvent{
				ApprovalID: approval.ApprovalID,
				Decision:   "approved",
				Comment:    "approved by saved tool grant",
				ResolvedAt: time.Now().UTC().Format(time.RFC3339),
			}
			a.send(ctx, eventCh, SSEEvent{Type: "approval_request", Data: approval})
			a.send(ctx, eventCh, SSEEvent{Type: "approval_resolved", Data: resolved})
			return a.executeTool(ctx, tc, req)
		}
	}

	if req.RegisterApproval == nil {
		return fmt.Sprintf("Tool %s requires approval before execution: %s", tc.Function.Name, risk.Reason), true, "approval_required"
	}

	waitApproval, err := req.RegisterApproval(ctx, approval)
	if err != nil {
		return fmt.Sprintf("Failed to prepare approval for tool %s: %v", tc.Function.Name, err), true, "approval_required"
	}

	a.send(ctx, eventCh, SSEEvent{
		Type: "approval_request",
		Data: approval,
	})

	resolved, err := waitApproval(ctx)
	if err != nil {
		if ctx.Err() != nil {
			return "", true, "approval_required"
		}
		return fmt.Sprintf("Tool %s approval failed: %v", tc.Function.Name, err), true, "approval_required"
	}
	if resolved.ResolvedAt == "" {
		resolved.ResolvedAt = time.Now().UTC().Format(time.RFC3339)
	}
	a.send(ctx, eventCh, SSEEvent{
		Type: "approval_resolved",
		Data: resolved,
	})

	if resolved.Decision != "approved" {
		return fmt.Sprintf("Tool %s was not approved by the user.", tc.Function.Name), true, "approval_denied"
	}

	return a.executeTool(ctx, tc, req)
}

func approvalPolicyEnabled(policy string) bool {
	switch strings.ToLower(strings.TrimSpace(policy)) {
	case "", "off", "none", "never", "disabled":
		return false
	default:
		return true
	}
}

func riskLabel(risk mcp.ToolRisk) string {
	switch {
	case risk.Destructive:
		return "destructive"
	case risk.OpenWorld:
		return "open_world"
	case !risk.ReadOnly:
		return "write"
	default:
		return "read"
	}
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
	if out == "" && result.StructuredContent != nil {
		if data, err := json.Marshal(result.StructuredContent); err == nil {
			out = string(data)
		}
	}
	return out
}

func evidenceTitle(toolName string) string {
	name := strings.ReplaceAll(toolName, "_", " ")
	if len(name) > 80 {
		name = name[:80]
	}
	return "Evidence from " + name
}

func summarizeToolEvidence(content string) string {
	return truncateWhitespace(content, 600)
}

func summarizeFinalContent(content string) string {
	return truncateWhitespace(content, 900)
}

func finalReportVerdict(conversationType string) string {
	if conversationType == "investigation" {
		return "Incident report generated"
	}
	return "Response generated"
}

func truncateWhitespace(s string, max int) string {
	fields := strings.Fields(s)
	trimmed := strings.Join(fields, " ")
	if max > 0 && len(trimmed) > max {
		return trimmed[:max] + "..."
	}
	return trimmed
}

func extractEvidenceQuery(arguments string) string {
	var args map[string]interface{}
	if err := json.Unmarshal([]byte(arguments), &args); err != nil {
		return ""
	}
	for _, key := range []string{"query", "expr", "logql", "traceql", "promql"} {
		if value, ok := args[key].(string); ok {
			return value
		}
	}
	return ""
}

func (a *AgentLoop) send(ctx context.Context, ch chan<- SSEEvent, event SSEEvent) {
	select {
	case ch <- event:
	case <-ctx.Done():
	}
}
