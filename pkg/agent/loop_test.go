package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"consensys-asko11y-app/pkg/mcp"
)

// respondAsStream writes a ChatCompletionResponse as an OpenAI-compatible SSE stream.
func respondAsStream(w http.ResponseWriter, resp ChatCompletionResponse) {
	w.Header().Set("Content-Type", "text/event-stream")
	enc := json.NewEncoder(w)

	emitChunk := func(chunk streamChunk) {
		w.Write([]byte("data: ")) //nolint:errcheck
		enc.Encode(chunk)         //nolint:errcheck
		w.Write([]byte("\n"))     //nolint:errcheck
	}

	for _, choice := range resp.Choices {
		// Role chunk
		emitChunk(streamChunk{
			ID: resp.ID,
			Choices: []streamChoice{{
				Index: choice.Index,
				Delta: streamDelta{Role: choice.Message.Role},
			}},
		})

		// Content chunk
		if choice.Message.Content != "" {
			emitChunk(streamChunk{
				ID: resp.ID,
				Choices: []streamChoice{{
					Index: choice.Index,
					Delta: streamDelta{Content: choice.Message.Content},
				}},
			})
		}

		// Tool call chunks (one per tool call, full arguments in a single chunk)
		for i, tc := range choice.Message.ToolCalls {
			emitChunk(streamChunk{
				ID: resp.ID,
				Choices: []streamChoice{{
					Index: choice.Index,
					Delta: streamDelta{
						ToolCalls: []toolCallChunk{{
							Index: i,
							ID:    tc.ID,
							Type:  tc.Type,
							Function: functionChunk{
								Name:      tc.Function.Name,
								Arguments: tc.Function.Arguments,
							},
						}},
					},
				}},
			})
		}

		// Finish reason chunk
		fr := choice.FinishReason
		emitChunk(streamChunk{
			ID: resp.ID,
			Choices: []streamChoice{{
				Index:        choice.Index,
				Delta:        streamDelta{},
				FinishReason: &fr,
			}},
			Usage: resp.Usage,
		})
	}

	w.Write([]byte("data: [DONE]\n\n")) //nolint:errcheck
}

// setupTestLoop creates an AgentLoop backed by a mock LLM server.
// Returns the loop, the mock server URL (to pass as GrafanaURL in LoopRequest), and a cleanup func.
func setupTestLoop(t *testing.T, llmResponses []ChatCompletionResponse) (*AgentLoop, string, func()) {
	t.Helper()

	var callIdx atomic.Int32
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		idx := int(callIdx.Add(1)) - 1
		if idx >= len(llmResponses) {
			t.Errorf("unexpected LLM call #%d (only %d responses configured)", idx+1, len(llmResponses))
			return
		}
		respondAsStream(w, llmResponses[idx])
	}))

	llmClient := NewLLMClient(log.DefaultLogger, &http.Client{Timeout: llmTimeout})
	mcpProxy := mcp.NewProxy(context.Background(), log.DefaultLogger)
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

	expectedTypes := []string{"run_plan", "step_start", "step_done", "final_report", "content", "done"}
	if len(events) != len(expectedTypes) {
		t.Fatalf("expected event types %v, got %+v", expectedTypes, events)
	}
	for i, expected := range expectedTypes {
		if events[i].Type != expected {
			t.Errorf("event[%d]: expected %q, got %q", i, expected, events[i].Type)
		}
	}

	content := events[4].Data.(ContentEvent)
	if content.Content != "Here is your answer." {
		t.Errorf("unexpected content: %q", content.Content)
	}
}

func TestAgentLoop_ForwardsRequestedModel(t *testing.T) {
	receivedModel := make(chan string, 1)
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("failed to decode request: %v", err)
		}
		receivedModel <- req.Model
		respondAsStream(w, ChatCompletionResponse{
			ID: "1",
			Choices: []Choice{{
				Message:      Message{Role: "assistant", Content: "ok"},
				FinishReason: "stop",
			}},
		})
	}))
	defer llmServer.Close()

	llmClient := NewLLMClient(log.DefaultLogger, &http.Client{Timeout: llmTimeout})
	mcpProxy := mcp.NewProxy(context.Background(), log.DefaultLogger)
	loop := NewAgentLoop(llmClient, mcpProxy, log.DefaultLogger)

	eventCh := make(chan SSEEvent, 32)
	req := LoopRequest{
		Messages:     []Message{{Role: "user", Content: "hello"}},
		SystemPrompt: "sys",
		Model:        "large",
		GrafanaURL:   llmServer.URL,
		AuthToken:    "test-token",
		UserRole:     "Admin",
		OrgID:        "1",
	}

	go loop.Run(context.Background(), req, eventCh)
	collectEvents(eventCh)

	if got := <-receivedModel; got != "large" {
		t.Fatalf("expected model large, got %q", got)
	}
}

func TestAgentLoop_FallsBackFromAutoLargeToBaseOnLLM5xx(t *testing.T) {
	var models []string
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("failed to decode request: %v", err)
		}
		models = append(models, req.Model)
		if req.Model == "large" {
			w.Header().Set("X-Request-Id", "large-req")
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(`{"error":"large provider failed"}`)) //nolint:errcheck
			return
		}
		respondAsStream(w, ChatCompletionResponse{
			ID: "base-ok",
			Choices: []Choice{{
				Message:      Message{Role: "assistant", Content: "base recovered"},
				FinishReason: "stop",
			}},
		})
	}))
	defer llmServer.Close()

	llmClient := NewLLMClient(log.DefaultLogger, &http.Client{Timeout: llmTimeout})
	mcpProxy := mcp.NewProxy(context.Background(), log.DefaultLogger)
	loop := NewAgentLoop(llmClient, mcpProxy, log.DefaultLogger)

	eventCh := make(chan SSEEvent, 32)
	req := LoopRequest{
		Messages:           []Message{{Role: "user", Content: "investigate"}},
		SystemPrompt:       "sys",
		Model:              "large",
		AllowModelFallback: true,
		GrafanaURL:         llmServer.URL,
		AuthToken:          "test-token",
		UserRole:           "Admin",
		OrgID:              "1",
	}

	go loop.Run(context.Background(), req, eventCh)
	events := collectEvents(eventCh)

	if len(models) != 3 || models[0] != "large" || models[1] != "large" || models[2] != "base" {
		t.Fatalf("models = %v, want large retry then base fallback", models)
	}
	expectedTypes := []string{"run_plan", "step_start", "step_done", "final_report", "content", "done"}
	if len(events) != len(expectedTypes) {
		t.Fatalf("expected event types %v, got %+v", expectedTypes, events)
	}
	for i, expected := range expectedTypes {
		if events[i].Type != expected {
			t.Errorf("event[%d]: expected %q, got %q", i, expected, events[i].Type)
		}
	}
	if content := events[4].Data.(ContentEvent).Content; content != "base recovered" {
		t.Fatalf("content = %q, want base recovered", content)
	}
}

func TestAgentLoop_SendsDiagnosticErrorForLLMStatus(t *testing.T) {
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Request-Id", "req-500")
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"provider failed"}`)) //nolint:errcheck
	}))
	defer llmServer.Close()

	llmClient := NewLLMClient(log.DefaultLogger, &http.Client{Timeout: llmTimeout})
	mcpProxy := mcp.NewProxy(context.Background(), log.DefaultLogger)
	loop := NewAgentLoop(llmClient, mcpProxy, log.DefaultLogger)

	eventCh := make(chan SSEEvent, 32)
	req := LoopRequest{
		Messages:     []Message{{Role: "user", Content: "hello"}},
		SystemPrompt: "sys",
		Model:        "large",
		GrafanaURL:   llmServer.URL,
		AuthToken:    "test-token",
		UserRole:     "Admin",
		OrgID:        "1",
	}

	go loop.Run(context.Background(), req, eventCh)
	events := collectEvents(eventCh)

	expectedTypes := []string{"run_plan", "step_start", "error"}
	if len(events) != len(expectedTypes) {
		t.Fatalf("expected event types %v, got %+v", expectedTypes, events)
	}
	for i, expected := range expectedTypes {
		if events[i].Type != expected {
			t.Errorf("event[%d]: expected %q, got %q", i, expected, events[i].Type)
		}
	}
	errEvent := events[2].Data.(ErrorEvent)
	if errEvent.Code != "llm_http_500" || errEvent.StatusCode != http.StatusInternalServerError {
		t.Fatalf("unexpected error event: %+v", errEvent)
	}
	if errEvent.RequestID != "req-500" || !strings.Contains(errEvent.Message, "Request ID: req-500") {
		t.Fatalf("missing request id in error event: %+v", errEvent)
	}
	if strings.Contains(errEvent.Message, "provider failed") {
		t.Fatalf("user error leaked provider body: %s", errEvent.Message)
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

	// Expect structured run events around the tool call and final answer.
	types := make([]string, len(events))
	for i, e := range events {
		types[i] = e.Type
	}

	expected := []string{"run_plan", "step_start", "tool_call_start", "tool_call_result", "step_done", "final_report", "content", "done"}
	if len(types) != len(expected) {
		t.Fatalf("expected event types %v, got %v", expected, types)
	}
	for i := range expected {
		if types[i] != expected[i] {
			t.Errorf("event[%d]: expected %q, got %q", i, expected[i], types[i])
		}
	}
}

func TestAgentLoop_ContentWithToolCalls_DropsContent(t *testing.T) {
	// LLM returns content AND tool calls — the content is "thinking out loud"
	// and should not be sent to the user.
	loop, serverURL, cleanup := setupTestLoop(t, []ChatCompletionResponse{
		{
			ID: "1",
			Choices: []Choice{{
				Message: Message{
					Role:    "assistant",
					Content: "I'll query Prometheus to check.",
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
				Message:      Message{Role: "assistant", Content: "Here are the results."},
				FinishReason: "stop",
			}},
		},
	})
	defer cleanup()

	eventCh := make(chan SSEEvent, 32)
	req := LoopRequest{
		Messages:     []Message{{Role: "user", Content: "check prometheus"}},
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

	// The "thinking" content from iteration 1 must NOT appear.
	expected := []string{"run_plan", "step_start", "tool_call_start", "tool_call_result", "step_done", "final_report", "content", "done"}
	if len(types) != len(expected) {
		t.Fatalf("expected event types %v, got %v", expected, types)
	}
	for i := range expected {
		if types[i] != expected[i] {
			t.Errorf("event[%d]: expected %q, got %q", i, expected[i], types[i])
		}
	}

	// Verify only the final answer content is sent
	content := events[6].Data.(ContentEvent)
	if content.Content != "Here are the results." {
		t.Errorf("expected final answer, got %q", content.Content)
	}
}

func TestCompletionTokenBudget(t *testing.T) {
	tests := []struct {
		name     string
		total    int
		expected int
	}{
		{name: "default budget", total: 0, expected: defaultMaxCompletionTokens},
		{name: "small total clamps to half", total: 1000, expected: 500},
		{name: "medium total uses one eighth", total: 16000, expected: 2000},
		{name: "large total caps at default", total: 128000, expected: defaultMaxCompletionTokens},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := completionTokenBudget(tt.total); got != tt.expected {
				t.Fatalf("completionTokenBudget(%d) = %d, want %d", tt.total, got, tt.expected)
			}
		})
	}
}

func TestEnsureScopedGraphitiArgs(t *testing.T) {
	tool := mcp.Tool{
		Name: "graphiti_search_memory_facts",
		InputSchema: map[string]interface{}{
			"properties": map[string]interface{}{
				"group_ids": map[string]interface{}{"type": "array"},
				"query":     map[string]interface{}{"type": "string"},
			},
		},
	}

	args := map[string]interface{}{"query": "payments"}
	mcp.EnsureScopedGraphitiArgs(tool, args, "42")

	if got := args["group_ids"]; fmt.Sprint(got) != "[org_42]" {
		t.Fatalf("group_ids = %v, want %q", got, "[org_42]")
	}

	// Org-scoped group_ids must always be forced — even if the LLM supplied one.
	mcp.EnsureScopedGraphitiArgs(tool, args, "7")
	if got := args["group_ids"]; fmt.Sprint(got) != "[org_7]" {
		t.Fatalf("group_ids should be overwritten to current org, got %v", got)
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

func TestAgentLoop_NearLimitWarningInjected(t *testing.T) {
	// Every response requests a tool call so we exercise multiple iterations.
	toolCallResp := ChatCompletionResponse{
		ID: "loop",
		Choices: []Choice{{
			Message: Message{
				Role: "assistant",
				ToolCalls: []ToolCall{{
					ID: "tc", Type: "function",
					Function: FunctionCall{Name: "some_tool", Arguments: "{}"},
				}},
			},
			FinishReason: "tool_calls",
		}},
	}

	var mu sync.Mutex
	var requestBodies []string
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		requestBodies = append(requestBodies, string(body))
		mu.Unlock()
		respondAsStream(w, toolCallResp)
	}))
	defer llmServer.Close()

	llmClient := NewLLMClient(log.DefaultLogger, &http.Client{Timeout: llmTimeout})
	mcpProxy := mcp.NewProxy(context.Background(), log.DefaultLogger)
	loop := NewAgentLoop(llmClient, mcpProxy, log.DefaultLogger)

	eventCh := make(chan SSEEvent, 64)
	req := LoopRequest{
		Messages:      []Message{{Role: "user", Content: "loop forever"}},
		SystemPrompt:  "sys",
		MaxIterations: 3,
		GrafanaURL:    llmServer.URL,
		AuthToken:     "t",
		UserRole:      "Admin",
		OrgID:         "1",
	}
	go loop.Run(context.Background(), req, eventCh)
	collectEvents(eventCh)

	mu.Lock()
	defer mu.Unlock()
	if len(requestBodies) < 3 {
		t.Fatalf("expected 3 LLM requests (one per iteration), got %d", len(requestBodies))
	}
	// maxIter=3 ⇒ the warning lands on iteration 1 (maxIter-2). Not on iter 0 or 2.
	if !strings.Contains(requestBodies[1], "approaching the iteration limit") {
		t.Errorf("expected near-limit warning in iteration 1 body")
	}
	if strings.Contains(requestBodies[0], "approaching the iteration limit") {
		t.Errorf("did not expect warning in iteration 0")
	}
	if strings.Contains(requestBodies[2], "approaching the iteration limit") {
		t.Errorf("did not expect warning in iteration 2 (past)")
	}
}

func TestAgentLoop_ContextCancellation(t *testing.T) {
	// Slow server — context will be cancelled
	slowServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer slowServer.Close()

	llmClient := NewLLMClient(log.DefaultLogger, &http.Client{Timeout: llmTimeout})
	mcpProxy := mcp.NewProxy(context.Background(), log.DefaultLogger)
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
