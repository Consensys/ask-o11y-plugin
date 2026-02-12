package agent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"consensys-asko11y-app/pkg/mcp"
)

// setupTestLoop creates an AgentLoop backed by a mock LLM server.
// Returns the loop, the mock server URL (to pass as GrafanaURL in LoopRequest), and a cleanup func.
func setupTestLoop(t *testing.T, llmResponses []ChatCompletionResponse) (*AgentLoop, string, func()) {
	t.Helper()

	callIdx := 0
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if callIdx >= len(llmResponses) {
			t.Fatalf("unexpected LLM call #%d (only %d responses configured)", callIdx+1, len(llmResponses))
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(llmResponses[callIdx])
		callIdx++
	}))

	llmClient := NewLLMClient(log.DefaultLogger)
	mcpProxy := mcp.NewProxy(log.DefaultLogger)
	loop := NewAgentLoop(llmClient, mcpProxy, log.DefaultLogger)

	return loop, llmServer.URL, llmServer.Close
}

func collectEvents(eventCh <-chan SSEEvent) []SSEEvent {
	var events []SSEEvent
	for e := range eventCh {
		events = append(events, e)
	}
	return events
}

func TestAgentLoop_SimpleTextResponse(t *testing.T) {
	loop, serverURL, cleanup := setupTestLoop(t, []ChatCompletionResponse{
		{
			ID: "1",
			Choices: []Choice{{
				Message:      Message{Role: "assistant", Content: "Here is your answer."},
				FinishReason: "stop",
			}},
		},
	})
	defer cleanup()

	eventCh := make(chan SSEEvent, 32)
	req := LoopRequest{
		Messages:     []Message{{Role: "user", Content: "hello"}},
		SystemPrompt: "You are helpful.",
		GrafanaURL:   serverURL,
		AuthToken:    "test-token",
		UserRole:     "Admin",
		OrgID:        "1",
	}

	go loop.Run(context.Background(), req, eventCh)
	events := collectEvents(eventCh)

	if len(events) != 2 {
		t.Fatalf("expected 2 events (content + done), got %d: %+v", len(events), events)
	}
	if events[0].Type != "content" {
		t.Errorf("expected content event, got %q", events[0].Type)
	}
	if events[1].Type != "done" {
		t.Errorf("expected done event, got %q", events[1].Type)
	}

	content := events[0].Data.(ContentEvent)
	if content.Content != "Here is your answer." {
		t.Errorf("unexpected content: %q", content.Content)
	}
}

func TestAgentLoop_ToolCallThenText(t *testing.T) {
	// First response: tool call. Second response: text.
	// The tool call will fail (no MCP server configured) but the loop should continue.
	loop, serverURL, cleanup := setupTestLoop(t, []ChatCompletionResponse{
		{
			ID: "1",
			Choices: []Choice{{
				Message: Message{
					Role: "assistant",
					ToolCalls: []ToolCall{{
						ID:   "tc_1",
						Type: "function",
						Function: FunctionCall{
							Name:      "unknown_tool",
							Arguments: `{"query": "up"}`,
						},
					}},
				},
				FinishReason: "tool_calls",
			}},
		},
		{
			ID: "2",
			Choices: []Choice{{
				Message:      Message{Role: "assistant", Content: "Based on the error..."},
				FinishReason: "stop",
			}},
		},
	})
	defer cleanup()

	eventCh := make(chan SSEEvent, 32)
	req := LoopRequest{
		Messages:     []Message{{Role: "user", Content: "query prometheus"}},
		SystemPrompt: "sys",
		GrafanaURL:   serverURL,
		AuthToken:    "test-token",
		UserRole:     "Admin",
		OrgID:        "1",
	}

	go loop.Run(context.Background(), req, eventCh)
	events := collectEvents(eventCh)

	// Expect: tool_call_start, tool_call_result (error), content, done
	types := make([]string, len(events))
	for i, e := range events {
		types[i] = e.Type
	}

	expected := []string{"tool_call_start", "tool_call_result", "content", "done"}
	if len(types) != len(expected) {
		t.Fatalf("expected event types %v, got %v", expected, types)
	}
	for i := range expected {
		if types[i] != expected[i] {
			t.Errorf("event[%d]: expected %q, got %q", i, expected[i], types[i])
		}
	}
}

func TestAgentLoop_MaxIterations(t *testing.T) {
	// Every response requests a tool call — should hit max iterations
	toolCallResp := ChatCompletionResponse{
		ID: "loop",
		Choices: []Choice{{
			Message: Message{
				Role: "assistant",
				ToolCalls: []ToolCall{{
					ID:   "tc",
					Type: "function",
					Function: FunctionCall{
						Name:      "some_tool",
						Arguments: "{}",
					},
				}},
			},
			FinishReason: "tool_calls",
		}},
	}

	// Create enough responses for max 3 iterations
	responses := make([]ChatCompletionResponse, 5)
	for i := range responses {
		responses[i] = toolCallResp
	}

	loop, serverURL, cleanup := setupTestLoop(t, responses)
	defer cleanup()

	eventCh := make(chan SSEEvent, 64)
	req := LoopRequest{
		Messages:      []Message{{Role: "user", Content: "loop forever"}},
		SystemPrompt:  "sys",
		MaxIterations: 3,
		GrafanaURL:    serverURL,
		AuthToken:     "test-token",
		UserRole:      "Admin",
		OrgID:         "1",
	}

	go loop.Run(context.Background(), req, eventCh)
	events := collectEvents(eventCh)

	// Last event should be an error about max iterations
	last := events[len(events)-1]
	if last.Type != "error" {
		t.Fatalf("expected last event to be error, got %q", last.Type)
	}
}

func TestAgentLoop_ReasoningContent(t *testing.T) {
	loop, serverURL, cleanup := setupTestLoop(t, []ChatCompletionResponse{
		{
			ID: "1",
			Choices: []Choice{{
				Message: Message{
					Role:             "assistant",
					Content:          "The answer is 42.",
					ReasoningContent: "Let me think about this...",
				},
				FinishReason: "stop",
			}},
		},
	})
	defer cleanup()

	eventCh := make(chan SSEEvent, 32)
	req := LoopRequest{
		Messages:     []Message{{Role: "user", Content: "hello"}},
		SystemPrompt: "You are helpful.",
		GrafanaURL:   serverURL,
		AuthToken:    "test-token",
		UserRole:     "Admin",
		OrgID:        "1",
	}

	go loop.Run(context.Background(), req, eventCh)
	events := collectEvents(eventCh)

	types := make([]string, len(events))
	for i, e := range events {
		types[i] = e.Type
	}

	expected := []string{"reasoning", "content", "done"}
	if len(types) != len(expected) {
		t.Fatalf("expected event types %v, got %v", expected, types)
	}
	for i := range expected {
		if types[i] != expected[i] {
			t.Errorf("event[%d]: expected %q, got %q", i, expected[i], types[i])
		}
	}

	reasoning := events[0].Data.(ReasoningEvent)
	if reasoning.Content != "Let me think about this..." {
		t.Errorf("unexpected reasoning: %q", reasoning.Content)
	}
	content := events[1].Data.(ContentEvent)
	if content.Content != "The answer is 42." {
		t.Errorf("unexpected content: %q", content.Content)
	}
}

func TestAgentLoop_ReasoningWithToolCalls(t *testing.T) {
	loop, serverURL, cleanup := setupTestLoop(t, []ChatCompletionResponse{
		{
			ID: "1",
			Choices: []Choice{{
				Message: Message{
					Role:             "assistant",
					ReasoningContent: "I need to query metrics first.",
					ToolCalls: []ToolCall{{
						ID:   "tc_1",
						Type: "function",
						Function: FunctionCall{
							Name:      "unknown_tool",
							Arguments: `{"query": "up"}`,
						},
					}},
				},
				FinishReason: "tool_calls",
			}},
		},
		{
			ID: "2",
			Choices: []Choice{{
				Message:      Message{Role: "assistant", Content: "Based on the results..."},
				FinishReason: "stop",
			}},
		},
	})
	defer cleanup()

	eventCh := make(chan SSEEvent, 32)
	req := LoopRequest{
		Messages:     []Message{{Role: "user", Content: "query metrics"}},
		SystemPrompt: "sys",
		GrafanaURL:   serverURL,
		AuthToken:    "test-token",
		UserRole:     "Admin",
		OrgID:        "1",
	}

	go loop.Run(context.Background(), req, eventCh)
	events := collectEvents(eventCh)

	types := make([]string, len(events))
	for i, e := range events {
		types[i] = e.Type
	}

	expected := []string{"reasoning", "tool_call_start", "tool_call_result", "content", "done"}
	if len(types) != len(expected) {
		t.Fatalf("expected event types %v, got %v", expected, types)
	}
	for i := range expected {
		if types[i] != expected[i] {
			t.Errorf("event[%d]: expected %q, got %q", i, expected[i], types[i])
		}
	}
}

func TestAgentLoop_ContextCancellation(t *testing.T) {
	// Slow server — context will be cancelled
	slowServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer slowServer.Close()

	llmClient := NewLLMClient(log.DefaultLogger)
	mcpProxy := mcp.NewProxy(log.DefaultLogger)
	loop := NewAgentLoop(llmClient, mcpProxy, log.DefaultLogger)

	ctx, cancel := context.WithCancel(context.Background())

	eventCh := make(chan SSEEvent, 32)
	req := LoopRequest{
		Messages:     []Message{{Role: "user", Content: "hello"}},
		SystemPrompt: "sys",
		GrafanaURL:   slowServer.URL,
		AuthToken:    "",
		UserRole:     "Admin",
		OrgID:        "1",
	}

	done := make(chan struct{})
	go func() {
		loop.Run(ctx, req, eventCh)
		close(done)
	}()

	cancel()
	<-done

	events := collectEvents(eventCh)
	// Should have no events or possibly an error — but should not hang
	for _, e := range events {
		if e.Type == "done" {
			t.Error("should not emit done event on cancellation")
		}
	}
}
