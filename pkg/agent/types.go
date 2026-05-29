package agent

import (
	"context"
	"encoding/json"
)

type Message struct {
	Role       string     `json:"role"`
	Content    string     `json:"content,omitempty"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
}

type ToolCall struct {
	ID       string       `json:"id"`
	Type     string       `json:"type"`
	Function FunctionCall `json:"function"`
}

type FunctionCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type OpenAITool struct {
	Type     string         `json:"type"`
	Function OpenAIFunction `json:"function"`
}

type OpenAIFunction struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description,omitempty"`
	Parameters  map[string]interface{} `json:"parameters,omitempty"`
}

type ChatCompletionRequest struct {
	Model     string       `json:"model,omitempty"`
	Messages  []Message    `json:"messages"`
	Tools     []OpenAITool `json:"tools,omitempty"`
	Stream    bool         `json:"stream,omitempty"`
	MaxTokens int          `json:"max_tokens,omitempty"`
}

type ChatCompletionResponse struct {
	ID      string   `json:"id"`
	Choices []Choice `json:"choices"`
	Usage   *Usage   `json:"usage,omitempty"`
}

type Choice struct {
	Index        int     `json:"index"`
	Message      Message `json:"message"`
	FinishReason string  `json:"finish_reason"`
}

type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

type SSEEvent struct {
	Type     string      `json:"type"`
	Data     interface{} `json:"data"`
	Sequence int64       `json:"sequence"`
}

type ContentEvent struct {
	Content string `json:"content"`
}

type ToolCallStartEvent struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type ToolCallResultEvent struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Content string `json:"content"`
	IsError bool   `json:"isError"`
	// ErrorKind classifies a failed tool call so the UI can show a different
	// treatment for transport outages vs tool-layer errors. Empty on success.
	// Values: "transport" | "tool" | "protocol" | "".
	ErrorKind string `json:"errorKind,omitempty"`
}

type PlanStep struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	Status      string `json:"status"`
}

type RunPlanEvent struct {
	Objective string     `json:"objective"`
	Steps     []PlanStep `json:"steps"`
}

type StepEvent struct {
	ID     string `json:"id"`
	Title  string `json:"title,omitempty"`
	Status string `json:"status"`
}

type EvidenceEvent struct {
	ID            string `json:"id"`
	StepID        string `json:"stepId,omitempty"`
	Title         string `json:"title"`
	Summary       string `json:"summary"`
	Source        string `json:"source,omitempty"`
	ToolName      string `json:"toolName,omitempty"`
	Query         string `json:"query,omitempty"`
	DatasourceUID string `json:"datasourceUid,omitempty"`
	TimeRange     string `json:"timeRange,omitempty"`
}

type ApprovalRequestEvent struct {
	ApprovalID string `json:"approvalId"`
	ToolCallID string `json:"toolCallId"`
	ToolName   string `json:"toolName"`
	Risk       string `json:"risk"`
	Reason     string `json:"reason"`
	Arguments  string `json:"arguments"`
}

type ApprovalResolvedEvent struct {
	ApprovalID string `json:"approvalId"`
	Decision   string `json:"decision"`
	Comment    string `json:"comment,omitempty"`
	ResolvedAt string `json:"resolvedAt,omitempty"`
}

type FinalReportEvent struct {
	Verdict     string   `json:"verdict,omitempty"`
	Confidence  string   `json:"confidence,omitempty"`
	Summary     string   `json:"summary"`
	EvidenceIDs []string `json:"evidenceIds,omitempty"`
	Gaps        []string `json:"gaps,omitempty"`
	NextSteps   []string `json:"nextSteps,omitempty"`
}

// MCPUnavailableEvent is emitted at most once per run when enough distinct
// tool calls fail with a transport error that we can confidently tell the
// user MCP is unreachable — rather than letting the agent fabricate around
// missing data.
type MCPUnavailableEvent struct {
	Message string `json:"message"`
}

type DoneEvent struct {
	TotalIterations int `json:"totalIterations"`
}

type ErrorEvent struct {
	Message string `json:"message"`
}

type RunRequest struct {
	Message    string `json:"message"`
	Type       string `json:"type,omitempty"`
	SessionID  string `json:"sessionId,omitempty"`
	OrgName    string `json:"orgName,omitempty"`
	ScopeOrgID string `json:"scopeOrgId,omitempty"`
}

type RunStartedEvent struct {
	RunID     string `json:"runId"`
	SessionID string `json:"sessionId,omitempty"`
}

func MarshalSSE(event SSEEvent) ([]byte, error) {
	data, err := json.Marshal(event)
	if err != nil {
		return nil, err
	}
	line := make([]byte, 0, len(data)+8)
	line = append(line, "data: "...)
	line = append(line, data...)
	line = append(line, '\n', '\n')
	return line, nil
}

type ApprovalWaitFunc func(context.Context) (ApprovalResolvedEvent, error)
type ApprovalRegistrar func(context.Context, ApprovalRequestEvent) (ApprovalWaitFunc, error)
