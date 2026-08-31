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
		{Role: "user", Content: strings.Repeat("a", 40000)},      // ~10000 tokens
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

	result := trimToolResponses(messages, 100, 100, nil)
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

func toolCallMessage(assistantContent string, ids ...string) Message {
	tcs := make([]ToolCall, len(ids))
	for i, id := range ids {
		tcs[i] = ToolCall{ID: id, Type: "function", Function: FunctionCall{Name: "query_prometheus_" + id}}
	}
	return Message{Role: "assistant", Content: assistantContent, ToolCalls: tcs}
}

func toolResultMessage(id, content string) Message {
	return Message{Role: "tool", ToolCallID: id, Content: content}
}

func TestEvictStaleToolResults_KeepsAllWhenUnderLimit(t *testing.T) {
	messages := []Message{
		{Role: "system", Content: "sys"},
		toolCallMessage("", "1", "2"),
		toolResultMessage("1", "result one"),
		toolResultMessage("2", "result two"),
	}

	result := evictStaleToolResults(messages, 5, nil)
	if result[2].Content != "result one" || result[3].Content != "result two" {
		t.Fatalf("expected results untouched when under keepRecent, got %+v", result)
	}
}

func TestEvictStaleToolResults_EvictsOldestKeepsNewest(t *testing.T) {
	var messages []Message
	for i := 1; i <= 5; i++ {
		id := fmt.Sprintf("%d", i)
		messages = append(messages, toolCallMessage("", id))
		messages = append(messages, toolResultMessage(id, "result "+id))
	}

	result := evictStaleToolResults(messages, 2, nil)

	var toolMsgs []Message
	for _, m := range result {
		if m.Role == "tool" {
			toolMsgs = append(toolMsgs, m)
		}
	}
	if len(toolMsgs) != 5 {
		t.Fatalf("expected 5 tool messages, got %d", len(toolMsgs))
	}
	// Oldest 3 evicted, newest 2 kept in full.
	for i := 0; i < 3; i++ {
		if !strings.HasPrefix(toolMsgs[i].Content, EvictedToolResultMarker) {
			t.Errorf("expected tool result %d to be evicted, got %q", i, toolMsgs[i].Content)
		}
		if !strings.Contains(toolMsgs[i].Content, "query_prometheus_") {
			t.Errorf("expected placeholder to name the tool, got %q", toolMsgs[i].Content)
		}
	}
	for i := 3; i < 5; i++ {
		if strings.HasPrefix(toolMsgs[i].Content, EvictedToolResultMarker) {
			t.Errorf("expected tool result %d to remain in full, got %q", i, toolMsgs[i].Content)
		}
	}
}

func TestEvictStaleToolResults_NoSummarizerFallsBackToPlaceholder(t *testing.T) {
	var messages []Message
	for i := 1; i <= 3; i++ {
		id := fmt.Sprintf("%d", i)
		messages = append(messages, toolCallMessage("", id))
		messages = append(messages, toolResultMessage(id, "result "+id))
	}

	result := evictStaleToolResults(messages, 0, nil)
	for _, m := range result {
		if m.Role != "tool" {
			continue
		}
		if strings.HasPrefix(m.Content, EvictedToolResultMarker) && !strings.Contains(m.Content, "no summary available") {
			t.Errorf("expected nil-summarizer fallback text, got %q", m.Content)
		}
	}
}

func TestEvictStaleToolResults_UsesSummarizerOncePerResult(t *testing.T) {
	var messages []Message
	for i := 1; i <= 5; i++ {
		id := fmt.Sprintf("%d", i)
		messages = append(messages, toolCallMessage("", id))
		messages = append(messages, toolResultMessage(id, "raw content "+id))
	}

	var calls []string
	summarize := func(toolName, content string) string {
		calls = append(calls, content)
		return "summary of: " + content
	}

	first := evictStaleToolResults(messages, 2, summarize)

	var evicted int
	for _, m := range first {
		if m.Role == "tool" && strings.HasPrefix(m.Content, EvictedToolResultMarker) {
			evicted++
			if !strings.Contains(m.Content, "summary of: raw content") {
				t.Errorf("expected summarizer output embedded in placeholder, got %q", m.Content)
			}
		}
	}
	if evicted != 3 {
		t.Fatalf("expected 3 evicted results, got %d", evicted)
	}
	if len(calls) != 3 {
		t.Fatalf("expected summarizer called exactly once per stale result (3), got %d calls", len(calls))
	}

	// Re-running eviction on the already-evicted output must not call the
	// summarizer again — evictStaleToolResults is idempotent.
	second := evictStaleToolResults(first, 2, summarize)
	if len(calls) != 3 {
		t.Fatalf("expected no additional summarizer calls on re-eviction, got %d total calls", len(calls))
	}
	for i, m := range second {
		if m.Role != "tool" {
			continue
		}
		if strings.Count(m.Content, EvictedToolResultMarker) > 1 {
			t.Fatalf("message[%d] has a duplicated eviction marker: %q", i, m.Content)
		}
		if m.Content != first[i].Content {
			t.Errorf("message[%d] changed on re-eviction: %q -> %q", i, first[i].Content, m.Content)
		}
	}
}

func TestTrimToolResponses_HighVolumeToolGetsTighterLimit(t *testing.T) {
	toolNames := map[string]string{
		"1": "query_loki_logs",
		"2": "create_annotation",
	}
	messages := []Message{
		toolResultMessage("1", strings.Repeat("x", 100000)),
		toolResultMessage("2", strings.Repeat("y", 100000)),
	}

	result := trimToolResponses(messages, 8000, 3000, toolNames)

	if got := EstimateTokens(result[0].Content); got > 3000+10 {
		t.Errorf("expected high-volume tool result capped near 3000 tokens, got %d", got)
	}
	if got := EstimateTokens(result[1].Content); got <= 3000 {
		t.Errorf("expected non-high-volume tool result to use the higher 8000 cap, got %d tokens", got)
	}
}

func TestIsHighVolumeTool(t *testing.T) {
	cases := map[string]bool{
		"query_prometheus":      true,
		"query_loki_logs":       true,
		"tempo_traceql-search":  true,
		"list_pyroscope_labels": true,
		"get_dashboard_by_uid":  true,
		"create_annotation":     false,
		"list_incidents":        false,
		"get_current_oncall":    false,
	}
	for name, want := range cases {
		if got := isHighVolumeTool(name); got != want {
			t.Errorf("isHighVolumeTool(%q) = %v, want %v", name, got, want)
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
