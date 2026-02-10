package agent

import (
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

func TestEstimateTokens(t *testing.T) {
	// ~4 chars per token
	if got := EstimateTokens("hello world!"); got < 2 || got > 5 {
		t.Errorf("EstimateTokens('hello world!') = %d, expected ~3", got)
	}
	if got := EstimateTokens(""); got != 0 {
		t.Errorf("EstimateTokens('') = %d, expected 0", got)
	}
}
