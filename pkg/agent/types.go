package agent

import "encoding/json"

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
	Model    string       `json:"model"`
	Messages []Message    `json:"messages"`
	Tools    []OpenAITool `json:"tools,omitempty"`
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
	Type string      `json:"type"`
	Data interface{} `json:"data"`
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
}

type DoneEvent struct {
	TotalIterations int `json:"totalIterations"`
}

type ErrorEvent struct {
	Message string `json:"message"`
}

type RunRequest struct {
	Messages           []Message `json:"messages"`
	SystemPrompt       string    `json:"systemPrompt"`
	Summary            string    `json:"summary,omitempty"`
	MaxTotalTokens     int       `json:"maxTotalTokens,omitempty"`
	RecentMessageCount int       `json:"recentMessageCount,omitempty"`
	OrgName            string    `json:"orgName,omitempty"`
	ScopeOrgID         string    `json:"scopeOrgId,omitempty"`
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
