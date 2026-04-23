package agent

import (
	"fmt"
	"strings"
	"testing"
)

func TestBuildContextWindow(t *testing.T) {
	messages := make([]Message, 20)
	for i := range messages {
		messages[i] = Message{Role: "user", Content: "msg"}
	}

	result := BuildContextWindow("system prompt", messages, "", 5)

	// system prompt + last 5 messages
	if len(result) != 6 {
		t.Fatalf("expected 6 messages, got %d", len(result))
	}
	if result[0].Role != "system" {
		t.Errorf("first message should be system, got %q", result[0].Role)
	}
}

func TestBuildContextWindow_WithSummary(t *testing.T) {
	messages := make([]Message, 20)
	for i := range messages {
		messages[i] = Message{Role: "user", Content: "msg"}
	}

	result := BuildContextWindow("system prompt", messages, "summary of old msgs", 5)

	// system + summary + last 5 messages
	if len(result) != 7 {
		t.Fatalf("expected 7 messages, got %d", len(result))
	}
	if !strings.Contains(result[1].Content, "summary of old msgs") {
		t.Errorf("expected summary in second message, got %q", result[1].Content)
	}
}

func TestBuildContextWindow_ShortConversation(t *testing.T) {
	messages := []Message{
		{Role: "user", Content: "hello"},
		{Role: "assistant", Content: "hi"},
	}

	// Summary should be ignored when conversation is shorter than recentCount
	result := BuildContextWindow("sys", messages, "summary", 10)
	if len(result) != 3 { // system + 2 messages (no summary)
		t.Fatalf("expected 3 messages, got %d", len(result))
	}
}

func TestTrimMessagesToTokenLimit(t *testing.T) {
	messages := []Message{
		{Role: "system", Content: "system prompt"},
		{Role: "user", Content: "hello"},
		{Role: "assistant", Content: "world"},
	}

	// Large limit — no trimming
	result := TrimMessagesToTokenLimit(messages, nil, 100_000)
	if len(result) != 3 {
		t.Fatalf("expected 3 messages (no trim), got %d", len(result))
	}
}

func TestTrimMessagesToTokenLimit_DropsOldMessages(t *testing.T) {
	messages := []Message{
		{Role: "system", Content: "sys"},
		{Role: "user", Content: strings.Repeat("a", 40000)},    // ~10000 tokens
		{Role: "assistant", Content: strings.Repeat("b", 40000)}, // ~10000 tokens
		{Role: "user", Content: "recent"},                        // small
	}

	// Very tight limit — should keep system + last message
	result := TrimMessagesToTokenLimit(messages, nil, 2000)
	if len(result) < 2 {
		t.Fatalf("expected at least 2 messages (system+last), got %d", len(result))
	}
	if result[0].Role != "system" {
		t.Errorf("first message should be system, got %q", result[0].Role)
	}
	if !hasTruncationNotice(result) {
		t.Errorf("expected truncation notice after system prompt, got %+v", result)
	}
}

func TestTrimMessagesToTokenLimit_TruncationNoticeIsIdempotent(t *testing.T) {
	messages := []Message{
		{Role: "system", Content: "sys"},
		{Role: "user", Content: strings.Repeat("a", 40000)},
		{Role: "assistant", Content: strings.Repeat("b", 40000)},
		{Role: "user", Content: "recent"},
	}

	first := TrimMessagesToTokenLimit(messages, nil, 2000)
	second := TrimMessagesToTokenLimit(first, nil, 2000)

	count := 0
	for _, m := range second {
		if m.Role == "system" && strings.Contains(m.Content, TruncationMarker) {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("expected exactly one truncation notice after re-trim, got %d (messages=%+v)", count, second)
	}
}

func TestTrimMessagesToTokenLimit_NoNoticeWhenNoDrop(t *testing.T) {
	messages := []Message{
		{Role: "system", Content: "sys"},
		{Role: "user", Content: "hello"},
		{Role: "assistant", Content: "world"},
	}
	result := TrimMessagesToTokenLimit(messages, nil, 100_000)
	if hasTruncationNotice(result) {
		t.Fatalf("did not expect truncation notice when nothing was dropped, got %+v", result)
	}
}

func TestTrimToolResponses(t *testing.T) {
	messages := []Message{
		{Role: "tool", ToolCallID: "1", Content: strings.Repeat("x", 100000)},
	}

	result := trimToolResponses(messages, 100)
	if !strings.Contains(result[0].Content, "[...truncated]") {
		t.Error("expected tool response to be truncated")
	}
}

func TestSanitizeMessages(t *testing.T) {
	tests := []struct {
		name     string
		input    []Message
		expected int
	}{
		{
			name: "removes empty assistant",
			input: []Message{
				{Role: "user", Content: "hello"},
				{Role: "assistant", Content: ""},
				{Role: "user", Content: "world"},
			},
			expected: 2,
		},
		{
			name: "keeps assistant with content",
			input: []Message{
				{Role: "user", Content: "hello"},
				{Role: "assistant", Content: "I can help"},
				{Role: "user", Content: "thanks"},
			},
			expected: 3,
		},
		{
			name: "keeps assistant with tool calls",
			input: []Message{
				{Role: "user", Content: "query metrics"},
				{Role: "assistant", Content: "", ToolCalls: []ToolCall{
					{ID: "1", Type: "function", Function: FunctionCall{Name: "query_prometheus", Arguments: "{}"}},
				}},
			},
			expected: 2,
		},
		{
			name: "removes whitespace-only assistant",
			input: []Message{
				{Role: "user", Content: "hello"},
				{Role: "assistant", Content: "   \n\t  "},
				{Role: "user", Content: "world"},
			},
			expected: 2,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := sanitizeMessages(tt.input)
			if len(result) != tt.expected {
				t.Fatalf("expected %d messages, got %d", tt.expected, len(result))
			}
		})
	}
}

func TestBuildContextWindow_FiltersEmptyAssistant(t *testing.T) {
	messages := []Message{
		{Role: "user", Content: "hello"},
		{Role: "assistant", Content: ""},
		{Role: "user", Content: "retry"},
	}

	result := BuildContextWindow("sys", messages, "", 10)
	if len(result) != 3 {
		t.Fatalf("expected 3 messages, got %d", len(result))
	}
	for _, m := range result {
		if m.Role == "assistant" {
			t.Error("empty assistant message should have been filtered")
		}
	}
}

func TestEstimateTokens(t *testing.T) {
	// ~4 chars per token
	if got := EstimateTokens("hello world!"); got < 2 || got > 5 {
		t.Errorf("EstimateTokens('hello world!') = %d, expected ~3", got)
	}
	if got := EstimateTokens(""); got != 0 {
		t.Errorf("EstimateTokens('') = %d, expected 0", got)
	}
}

func TestTrimToolsToTokenBudget_NoTrimWhenUnderBudget(t *testing.T) {
	tools := []OpenAITool{
		{Type: "function", Function: OpenAIFunction{Name: "a", Description: "short"}},
	}
	result := TrimToolsToTokenBudget(tools, 100_000)
	if result[0].Function.Description != "short" {
		t.Errorf("expected description unchanged, got %q", result[0].Function.Description)
	}
}

func TestTrimToolsToTokenBudget_TruncatesLongDescriptions(t *testing.T) {
	longDesc := strings.Repeat("x", 1000)
	tools := make([]OpenAITool, 50)
	for i := range tools {
		tools[i] = OpenAITool{
			Type: "function",
			Function: OpenAIFunction{
				Name:        fmt.Sprintf("tool_%d", i),
				Description: longDesc,
			},
		}
	}

	result := TrimToolsToTokenBudget(tools, maxToolDefinitionTokens)
	for _, tool := range result {
		if len(tool.Function.Description) > maxToolDescriptionChars+5 {
			t.Errorf("expected description truncated to ~%d chars, got %d", maxToolDescriptionChars, len(tool.Function.Description))
		}
	}
}

func TestTrimToolsToTokenBudget_StripsParameterDescriptionsWhenNeeded(t *testing.T) {
	paramDesc := strings.Repeat("p", 500)
	tools := make([]OpenAITool, 50)
	for i := range tools {
		tools[i] = OpenAITool{
			Type: "function",
			Function: OpenAIFunction{
				Name:        fmt.Sprintf("tool_%d", i),
				Description: strings.Repeat("d", 600),
				Parameters: map[string]interface{}{
					"type": "object",
					"properties": map[string]interface{}{
						"query": map[string]interface{}{
							"type":        "string",
							"description": paramDesc,
						},
					},
				},
			},
		}
	}

	originalTokens := estimateToolTokens(tools)
	result := TrimToolsToTokenBudget(tools, maxToolDefinitionTokens)
	trimmedTokens := estimateToolTokens(result)

	// The trimmed result should be strictly smaller than the original.
	if trimmedTokens >= originalTokens {
		t.Errorf("expected trimmed tools to use fewer tokens: original=%d trimmed=%d", originalTokens, trimmedTokens)
	}

	// Descriptions should have been truncated.
	for _, tool := range result {
		if len(tool.Function.Description) > maxToolDescriptionChars+5 {
			t.Errorf("expected description truncated to ~%d chars, got %d", maxToolDescriptionChars, len(tool.Function.Description))
		}
	}

	// Parameter type should still be present but descriptions should be gone.
	for _, tool := range result {
		if tool.Function.Parameters == nil {
			continue
		}
		props, ok := tool.Function.Parameters["properties"].(map[string]interface{})
		if !ok {
			continue
		}
		queryProp, ok := props["query"].(map[string]interface{})
		if !ok {
			continue
		}
		if queryProp["type"] != "string" {
			t.Errorf("expected parameter type 'string' preserved, got %v", queryProp["type"])
		}
		if _, hasDesc := queryProp["description"]; hasDesc {
			t.Error("expected parameter description to be stripped")
		}
	}
}

func TestTrimToolsToTokenBudget_ZeroBudget(t *testing.T) {
	tools := []OpenAITool{
		{Type: "function", Function: OpenAIFunction{Name: "a", Description: "b"}},
	}
	result := TrimToolsToTokenBudget(tools, 0)
	if result[0].Function.Description != "b" {
		t.Errorf("zero budget should be a no-op, got %q", result[0].Function.Description)
	}
}

func TestStripSchemaDescriptions(t *testing.T) {
	schema := map[string]interface{}{
		"type":        "object",
		"description": "should be removed",
		"properties": map[string]interface{}{
			"query": map[string]interface{}{
				"type":        "string",
				"description": "also removed",
			},
		},
		"required": []interface{}{"query"},
	}

	result := stripSchemaDescriptions(schema)
	if _, ok := result["description"]; ok {
		t.Error("top-level description should be stripped")
	}
	props := result["properties"].(map[string]interface{})
	query := props["query"].(map[string]interface{})
	if _, ok := query["description"]; ok {
		t.Error("nested description should be stripped")
	}
	if query["type"] != "string" {
		t.Errorf("type should be preserved, got %v", query["type"])
	}
	if result["required"] == nil {
		t.Error("required should be preserved")
	}
}
