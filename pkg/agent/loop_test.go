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
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"

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
		// Background eviction-summary calls (model "base") must not consume
		// the main response sequence — stub them.
		var parsed ChatCompletionRequest
		if body, err := io.ReadAll(r.Body); err == nil {
			if json.Unmarshal(body, &parsed) == nil && parsed.Model == "base" {
				respondAsStream(w, ChatCompletionResponse{
					ID:      "summary",
					Choices: []Choice{{Message: Message{Role: "assistant", Content: "summary"}, FinishReason: "stop"}},
				})
				return
			}
		}
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

	expectedTypes := []string{"final_report", "content", "done"}
	if len(events) != len(expectedTypes) {
		t.Fatalf("expected event types %v, got %+v", expectedTypes, events)
	}
	for i, expected := range expectedTypes {
		if events[i].Type != expected {
			t.Errorf("event[%d]: expected %q, got %q", i, expected, events[i].Type)
		}
	}

	content := events[1].Data.(ContentEvent)
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
	expectedTypes := []string{"final_report", "content", "done"}
	if len(events) != len(expectedTypes) {
		t.Fatalf("expected event types %v, got %+v", expectedTypes, events)
	}
	for i, expected := range expectedTypes {
		if events[i].Type != expected {
			t.Errorf("event[%d]: expected %q, got %q", i, expected, events[i].Type)
		}
	}
	if content := events[1].Data.(ContentEvent).Content; content != "base recovered" {
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

	expectedTypes := []string{"error"}
	if len(events) != len(expectedTypes) {
		t.Fatalf("expected event types %v, got %+v", expectedTypes, events)
	}
	for i, expected := range expectedTypes {
		if events[i].Type != expected {
			t.Errorf("event[%d]: expected %q, got %q", i, expected, events[i].Type)
		}
	}
	errEvent := events[0].Data.(ErrorEvent)
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

	expected := []string{"tool_call_start", "tool_call_result", "final_report", "content", "done"}
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
	expected := []string{"tool_call_start", "tool_call_result", "final_report", "content", "done"}
	if len(types) != len(expected) {
		t.Fatalf("expected event types %v, got %v", expected, types)
	}
	for i := range expected {
		if types[i] != expected[i] {
			t.Errorf("event[%d]: expected %q, got %q", i, expected[i], types[i])
		}
	}

	// Verify only the final answer content is sent
	content := events[3].Data.(ContentEvent)
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

func TestAgentLoop_TruncatedToolCall_CorrectiveRetryRecovers(t *testing.T) {
	// A tool call cut off mid-arguments (finish_reason=length) must not be
	// persisted. The loop drops it, injects a corrective nudge, and the model's
	// retry succeeds — the truncated arguments are never re-sent.
	const truncatedArgs = `{"folderUid": "feveb7u5f1kaoc", "message": "Duplicate of`

	var mu sync.Mutex
	var requestBodies []string
	callIdx := 0
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		requestBodies = append(requestBodies, string(body))
		idx := callIdx
		callIdx++
		mu.Unlock()

		if idx == 0 {
			respondAsStream(w, ChatCompletionResponse{
				ID: "trunc",
				Choices: []Choice{{
					Message: Message{
						Role: "assistant",
						ToolCalls: []ToolCall{{
							ID:       "tc_trunc",
							Type:     "function",
							Function: FunctionCall{Name: "update_dashboard", Arguments: truncatedArgs},
						}},
					},
					FinishReason: "length",
				}},
			})
			return
		}
		respondAsStream(w, ChatCompletionResponse{
			ID: "recovered",
			Choices: []Choice{{
				Message:      Message{Role: "assistant", Content: "recovered"},
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
		Messages:     []Message{{Role: "user", Content: "duplicate my dashboard"}},
		SystemPrompt: "sys",
		GrafanaURL:   llmServer.URL,
		AuthToken:    "test-token",
		UserRole:     "Admin",
		OrgID:        "1",
	}

	go loop.Run(context.Background(), req, eventCh)
	events := collectEvents(eventCh)

	mu.Lock()
	defer mu.Unlock()

	if len(requestBodies) != 2 {
		t.Fatalf("expected exactly 2 LLM calls (initial + corrective retry), got %d", len(requestBodies))
	}
	for i, body := range requestBodies {
		if strings.Contains(body, "Duplicate of") {
			t.Fatalf("request #%d re-sent truncated tool-call arguments (poisoned history): %s", i, body)
		}
	}
	if !strings.Contains(requestBodies[1], "cut off before its arguments were complete") {
		t.Errorf("expected corrective nudge in retry request, got: %s", requestBodies[1])
	}

	last := events[len(events)-1]
	if last.Type != "done" {
		t.Fatalf("expected run to recover with done, got %q (events: %+v)", last.Type, events)
	}
	var gotContent string
	for _, e := range events {
		if e.Type == "content" {
			gotContent = e.Data.(ContentEvent).Content
		}
	}
	if gotContent != "recovered" {
		t.Errorf("expected recovered content, got %q", gotContent)
	}
}

func TestAgentLoop_TruncatedToolCall_AbortsAfterRetryCap(t *testing.T) {
	// A model that keeps truncating its tool call must not spin: after the
	// bounded corrective retry it ends with a clean, retryable error and never
	// re-sends the malformed arguments.
	const truncatedArgs = `{"folderUid": "feveb7u5f1kaoc", "message": "Duplicate of`

	var mu sync.Mutex
	var callCount int
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		callCount++
		poisoned := strings.Contains(string(body), "Duplicate of")
		mu.Unlock()
		if poisoned {
			t.Errorf("request re-sent truncated tool-call arguments: %s", body)
		}
		respondAsStream(w, ChatCompletionResponse{
			ID: "trunc",
			Choices: []Choice{{
				Message: Message{
					Role: "assistant",
					ToolCalls: []ToolCall{{
						ID:       "tc_trunc",
						Type:     "function",
						Function: FunctionCall{Name: "update_dashboard", Arguments: truncatedArgs},
					}},
				},
				FinishReason: "length",
			}},
		})
	}))
	defer llmServer.Close()

	llmClient := NewLLMClient(log.DefaultLogger, &http.Client{Timeout: llmTimeout})
	mcpProxy := mcp.NewProxy(context.Background(), log.DefaultLogger)
	loop := NewAgentLoop(llmClient, mcpProxy, log.DefaultLogger)

	eventCh := make(chan SSEEvent, 32)
	req := LoopRequest{
		Messages:     []Message{{Role: "user", Content: "duplicate my dashboard"}},
		SystemPrompt: "sys",
		GrafanaURL:   llmServer.URL,
		AuthToken:    "test-token",
		UserRole:     "Admin",
		OrgID:        "1",
	}

	go loop.Run(context.Background(), req, eventCh)
	events := collectEvents(eventCh)

	mu.Lock()
	defer mu.Unlock()
	// initial call + maxTruncationRetries corrective retries.
	if callCount != maxTruncationRetries+1 {
		t.Fatalf("expected %d LLM calls, got %d", maxTruncationRetries+1, callCount)
	}

	last := events[len(events)-1]
	if last.Type != "error" {
		t.Fatalf("expected final event to be a clean error, got %q (events: %+v)", last.Type, events)
	}
	errEvent, ok := last.Data.(ErrorEvent)
	if !ok {
		t.Fatalf("expected ErrorEvent, got %T", last.Data)
	}
	if errEvent.Code != "llm_truncated_tool_call" || !errEvent.Retryable {
		t.Fatalf("unexpected error event: %+v", errEvent)
	}
}

func TestAgentLoop_TruncatedToolCall_KeepsValidDropsInvalid(t *testing.T) {
	// When a turn mixes a complete tool call with a truncated one, the valid call
	// is executed and the malformed one is dropped — never executed, never re-sent.
	const truncatedArgs = `{"folderUid": "fev", "message": "Duplicate of`

	var mu sync.Mutex
	var requestBodies []string
	callIdx := 0
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		requestBodies = append(requestBodies, string(body))
		idx := callIdx
		callIdx++
		mu.Unlock()

		if idx == 0 {
			respondAsStream(w, ChatCompletionResponse{
				ID: "mixed",
				Choices: []Choice{{
					Message: Message{
						Role: "assistant",
						ToolCalls: []ToolCall{
							{ID: "tc_ok", Type: "function", Function: FunctionCall{Name: "search_dashboards", Arguments: `{"query":"metrics"}`}},
							{ID: "tc_bad", Type: "function", Function: FunctionCall{Name: "update_dashboard", Arguments: truncatedArgs}},
						},
					},
					FinishReason: "length",
				}},
			})
			return
		}
		respondAsStream(w, ChatCompletionResponse{
			ID: "final",
			Choices: []Choice{{
				Message:      Message{Role: "assistant", Content: "done"},
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
		Messages:     []Message{{Role: "user", Content: "find and update"}},
		SystemPrompt: "sys",
		GrafanaURL:   llmServer.URL,
		AuthToken:    "test-token",
		UserRole:     "Admin",
		OrgID:        "1",
	}

	go loop.Run(context.Background(), req, eventCh)
	events := collectEvents(eventCh)

	mu.Lock()
	defer mu.Unlock()
	for i, body := range requestBodies {
		if strings.Contains(body, "Duplicate of") {
			t.Fatalf("request #%d re-sent dropped tool-call arguments: %s", i, body)
		}
	}

	var starts []ToolCallStartEvent
	for _, e := range events {
		if e.Type == "tool_call_start" {
			starts = append(starts, e.Data.(ToolCallStartEvent))
		}
	}
	if len(starts) != 1 {
		t.Fatalf("expected exactly 1 tool_call_start (valid call only), got %d: %+v", len(starts), starts)
	}
	if starts[0].ID != "tc_ok" {
		t.Errorf("expected the valid tool call tc_ok to execute, got %q", starts[0].ID)
	}
	if len(requestBodies) > 1 && strings.Contains(requestBodies[1], "cut off before its arguments were complete") {
		t.Errorf("did not expect corrective nudge when a valid tool call executed")
	}
}

func TestAgentLoop_TruncatedToolCall_NudgeIsOneShot(t *testing.T) {
	// The corrective nudge must steer only the retry request, not persist into
	// later turns after the model recovers.
	const truncatedArgs = `{"folderUid": "feveb7u5f1kaoc", "message": "Duplicate of`
	const nudgeMarker = "cut off before its arguments were complete"

	var mu sync.Mutex
	var requestBodies []string
	callIdx := 0
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		requestBodies = append(requestBodies, string(body))
		idx := callIdx
		callIdx++
		mu.Unlock()

		switch idx {
		case 0:
			respondAsStream(w, ChatCompletionResponse{
				ID: "trunc",
				Choices: []Choice{{
					Message: Message{
						Role: "assistant",
						ToolCalls: []ToolCall{{
							ID: "tc_trunc", Type: "function",
							Function: FunctionCall{Name: "update_dashboard", Arguments: truncatedArgs},
						}},
					},
					FinishReason: "length",
				}},
			})
		case 1:
			// Recovery: a complete, valid tool call.
			respondAsStream(w, ChatCompletionResponse{
				ID: "recover",
				Choices: []Choice{{
					Message: Message{
						Role: "assistant",
						ToolCalls: []ToolCall{{
							ID: "tc_ok", Type: "function",
							Function: FunctionCall{Name: "search_dashboards", Arguments: `{"query":"metrics"}`},
						}},
					},
					FinishReason: "tool_calls",
				}},
			})
		default:
			respondAsStream(w, ChatCompletionResponse{
				ID: "final",
				Choices: []Choice{{
					Message:      Message{Role: "assistant", Content: "done"},
					FinishReason: "stop",
				}},
			})
		}
	}))
	defer llmServer.Close()

	llmClient := NewLLMClient(log.DefaultLogger, &http.Client{Timeout: llmTimeout})
	mcpProxy := mcp.NewProxy(context.Background(), log.DefaultLogger)
	loop := NewAgentLoop(llmClient, mcpProxy, log.DefaultLogger)

	eventCh := make(chan SSEEvent, 32)
	req := LoopRequest{
		Messages:     []Message{{Role: "user", Content: "duplicate my dashboard"}},
		SystemPrompt: "sys",
		GrafanaURL:   llmServer.URL,
		AuthToken:    "test-token",
		UserRole:     "Admin",
		OrgID:        "1",
	}

	go loop.Run(context.Background(), req, eventCh)
	collectEvents(eventCh)

	mu.Lock()
	defer mu.Unlock()
	if len(requestBodies) != 3 {
		t.Fatalf("expected 3 LLM calls (truncated, recovery, final), got %d", len(requestBodies))
	}
	if !strings.Contains(requestBodies[1], nudgeMarker) {
		t.Errorf("retry request should carry the corrective nudge")
	}
	if strings.Contains(requestBodies[2], nudgeMarker) {
		t.Errorf("nudge must not persist into later turns after recovery: %s", requestBodies[2])
	}
}

func TestAgentLoop_TruncatedToolCall_LastIterationSurfacesCleanError(t *testing.T) {
	// A truncation on the final iteration has no room to retry; it must still end
	// with the clean llm_truncated_tool_call error, not the generic max-iterations
	// message.
	loop, serverURL, cleanup := setupTestLoop(t, []ChatCompletionResponse{
		{
			ID: "trunc",
			Choices: []Choice{{
				Message: Message{
					Role: "assistant",
					ToolCalls: []ToolCall{{
						ID: "tc_trunc", Type: "function",
						Function: FunctionCall{Name: "update_dashboard", Arguments: `{"uid": "feve`},
					}},
				},
				FinishReason: "length",
			}},
		},
	})
	defer cleanup()

	eventCh := make(chan SSEEvent, 32)
	req := LoopRequest{
		Messages:      []Message{{Role: "user", Content: "do it"}},
		SystemPrompt:  "sys",
		MaxIterations: 1,
		GrafanaURL:    serverURL,
		AuthToken:     "test-token",
		UserRole:      "Admin",
		OrgID:         "1",
	}

	go loop.Run(context.Background(), req, eventCh)
	events := collectEvents(eventCh)

	last := events[len(events)-1]
	if last.Type != "error" {
		t.Fatalf("expected error event, got %q (events: %+v)", last.Type, events)
	}
	errEvent, ok := last.Data.(ErrorEvent)
	if !ok {
		t.Fatalf("expected ErrorEvent, got %T", last.Data)
	}
	if errEvent.Code != "llm_truncated_tool_call" || !errEvent.Retryable {
		t.Fatalf("expected clean truncation error, got %+v", errEvent)
	}
	if strings.Contains(errEvent.Message, "maximum iterations") {
		t.Fatalf("should not surface generic max-iterations error: %s", errEvent.Message)
	}
}

func TestAgentLoop_AccumulatesUsageAndToolCallsIntoDoneEvent(t *testing.T) {
	// Two LLM calls: one with a tool call, one final text response. Each
	// carries its own token usage — the done event must report the sum across
	// both calls, plus a count of the one tool call actually executed.
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
			Usage: &Usage{PromptTokens: 100, CompletionTokens: 20, TotalTokens: 120},
		},
		{
			ID: "2",
			Choices: []Choice{{
				Message:      Message{Role: "assistant", Content: "Based on the error..."},
				FinishReason: "stop",
			}},
			Usage: &Usage{PromptTokens: 150, CompletionTokens: 30, TotalTokens: 180},
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

	last := events[len(events)-1]
	if last.Type != "done" {
		t.Fatalf("expected last event to be done, got %q", last.Type)
	}
	done, ok := last.Data.(DoneEvent)
	if !ok {
		t.Fatalf("expected DoneEvent, got %T", last.Data)
	}
	if done.PromptTokens != 250 || done.CompletionTokens != 50 || done.TotalTokens != 300 {
		t.Fatalf("unexpected token totals: %+v", done)
	}
	if done.ToolCallCount != 1 {
		t.Fatalf("expected ToolCallCount 1, got %d", done.ToolCallCount)
	}
	if done.TotalIterations != 2 {
		t.Fatalf("expected TotalIterations 2, got %d", done.TotalIterations)
	}
	baseUsage, ok := done.UsageByModel["base"]
	if !ok {
		t.Fatalf("expected UsageByModel base entry, got %+v", done.UsageByModel)
	}
	if baseUsage.PromptTokens != 250 || baseUsage.CompletionTokens != 50 || baseUsage.TotalTokens != 300 {
		t.Fatalf("unexpected base usage: %+v", baseUsage)
	}
}

func TestAgentLoop_FallbackAttributesUsageToBaseModel(t *testing.T) {
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
			Usage: &Usage{PromptTokens: 80, CompletionTokens: 20, TotalTokens: 100},
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

	last := events[len(events)-1]
	if last.Type != "done" {
		t.Fatalf("expected last event to be done, got %q", last.Type)
	}
	done, ok := last.Data.(DoneEvent)
	if !ok {
		t.Fatalf("expected DoneEvent, got %T", last.Data)
	}
	if _, hasLarge := done.UsageByModel["large"]; hasLarge {
		t.Fatalf("fallback tokens must not be attributed to large, got %+v", done.UsageByModel)
	}
	baseUsage, ok := done.UsageByModel["base"]
	if !ok {
		t.Fatalf("expected UsageByModel base entry, got %+v", done.UsageByModel)
	}
	if baseUsage.PromptTokens != 80 || baseUsage.CompletionTokens != 20 || baseUsage.TotalTokens != 100 {
		t.Fatalf("unexpected base usage: %+v", baseUsage)
	}
	if len(models) < 1 || models[len(models)-1] != "base" {
		t.Fatalf("expected final LLM call to use base, models = %v", models)
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

// TestAgentLoop_EvictsStaleToolResultsAcrossIterations runs enough tool-calling
// iterations to exceed DefaultKeepRecentToolResults and verifies the LLM requests sent
// in later iterations no longer carry the full content of the oldest tool
// results — the manual context-editing pass in the loop (evictStaleToolResults)
// must actually run each iteration, not just exist as a unit-tested function.
func TestAgentLoop_EvictsStaleToolResultsAcrossIterations(t *testing.T) {
	const iterations = DefaultKeepRecentToolResults + 4

	var mu sync.Mutex
	var requestBodies [][]byte
	var mainCallCount int
	var lastMainBody []byte

	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		requestBodies = append(requestBodies, body)
		mu.Unlock()

		var parsed ChatCompletionRequest
		json.Unmarshal(body, &parsed) //nolint:errcheck

		// Eviction summarization calls explicitly request the "base" model —
		// serve them a plain text summary without consuming a slot in the
		// main tool-calling iteration sequence below.
		if parsed.Model == "base" {
			respondAsStream(w, ChatCompletionResponse{
				ID:      "summary",
				Choices: []Choice{{Message: Message{Role: "assistant", Content: "summary"}, FinishReason: "stop"}},
			})
			return
		}

		mu.Lock()
		mainCallCount++
		call := mainCallCount
		// Background eviction summaries can still be in flight after the
		// run ends; the final-request assertions below must read the last
		// MAIN request, not whichever summary landed last.
		lastMainBody = body
		mu.Unlock()

		if call > iterations {
			respondAsStream(w, ChatCompletionResponse{
				ID:      "final",
				Choices: []Choice{{Message: Message{Role: "assistant", Content: "done"}, FinishReason: "stop"}},
			})
			return
		}
		respondAsStream(w, ChatCompletionResponse{
			ID: fmt.Sprintf("iter-%d", call),
			Choices: []Choice{{
				Message: Message{
					Role: "assistant",
					ToolCalls: []ToolCall{{
						ID:   fmt.Sprintf("tc_%d", call),
						Type: "function",
						Function: FunctionCall{
							Name: "fake_loki",
							// Distinct args per iteration: the repetition
							// guard replays byte-identical repeats instead
							// of executing them, and this test needs a fresh
							// tool result every iteration to exercise eviction.
							Arguments: fmt.Sprintf(`{"i":%d}`, call),
						},
					}},
				},
				FinishReason: "tool_calls",
			}},
		})
	}))
	defer llmServer.Close()

	llmClient := NewLLMClient(log.DefaultLogger, &http.Client{Timeout: llmTimeout})
	mcpProxy := mcp.NewProxy(context.Background(), log.DefaultLogger)
	loop := NewAgentLoop(llmClient, mcpProxy, log.DefaultLogger)

	// Successful tool executions: the stall guard clamps runs whose every
	// call errors, and this test needs a full run of distinct tool results.
	setupFakeMCP(t, loop, func(srv *mcpsdk.Server) {
		srv.AddTool(&mcpsdk.Tool{Name: "loki", InputSchema: map[string]any{"type": "object"}}, func(ctx context.Context, req *mcpsdk.CallToolRequest) (*mcpsdk.CallToolResult, error) {
			return sdkToolResult("log lines", false), nil
		})
	})

	eventCh := make(chan SSEEvent, 256)
	req := LoopRequest{
		Messages:      []Message{{Role: "user", Content: "investigate"}},
		SystemPrompt:  "sys",
		MaxIterations: iterations + 2,
		GrafanaURL:    llmServer.URL,
		AuthToken:     "test-token",
		UserRole:      "Admin",
		OrgID:         "1",
	}

	go loop.Run(context.Background(), req, eventCh)
	collectEvents(eventCh)

	mu.Lock()
	defer mu.Unlock()
	if len(requestBodies) < iterations+1 {
		t.Fatalf("expected at least %d LLM requests, got %d", iterations+1, len(requestBodies))
	}

	// The final MAIN request (after the last tool call) should carry evicted
	// placeholders for the oldest tool results, since more tool calls than
	// DefaultKeepRecentToolResults have accumulated in this run's history.
	last := lastMainBody
	if last == nil {
		t.Fatal("no main LLM request was recorded")
	}
	var lastReq ChatCompletionRequest
	if err := json.Unmarshal(last, &lastReq); err != nil {
		t.Fatalf("failed to unmarshal final LLM request: %v", err)
	}

	var evictedCount, fullCount int
	for _, m := range lastReq.Messages {
		if m.Role != "tool" {
			continue
		}
		if strings.HasPrefix(m.Content, EvictedToolResultMarker) {
			evictedCount++
		} else {
			fullCount++
		}
	}
	if evictedCount == 0 {
		t.Errorf("expected at least one evicted tool result in the final request, got none (fullCount=%d)", fullCount)
	}
	if fullCount > DefaultKeepRecentToolResults {
		t.Errorf("expected at most %d full tool results, got %d", DefaultKeepRecentToolResults, fullCount)
	}
}

// TestAgentLoop_CustomKeepRecentToolResults verifies the admin-configurable
// eviction threshold plumbed via LoopRequest.ContextLimits actually reaches
// the eviction pass — a low threshold must evict more aggressively than the
// default, with the loop still completing cleanly.
func TestAgentLoop_CustomKeepRecentToolResults(t *testing.T) {
	const keepRecent = 2
	const iterations = keepRecent + 4

	var mu sync.Mutex
	var requestBodies [][]byte
	var mainCallCount int
	var lastMainBody []byte

	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var parsed ChatCompletionRequest
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &parsed) //nolint:errcheck

		mu.Lock()
		requestBodies = append(requestBodies, body)
		mainCallCount++
		call := mainCallCount
		mu.Unlock()

		if parsed.Model == "base" {
			respondAsStream(w, ChatCompletionResponse{
				ID:      "summary",
				Choices: []Choice{{Message: Message{Role: "assistant", Content: "summary"}, FinishReason: "stop"}},
			})
			return
		}

		mu.Lock()
		// Background eviction summaries can still be in flight after the
		// run ends; the final-request assertion below must read the last
		// MAIN request, not whichever summary landed last.
		lastMainBody = body
		mu.Unlock()

		if call > iterations {
			respondAsStream(w, ChatCompletionResponse{
				ID:      "final",
				Choices: []Choice{{Message: Message{Role: "assistant", Content: "done"}, FinishReason: "stop"}},
			})
			return
		}
		respondAsStream(w, ChatCompletionResponse{
			ID: fmt.Sprintf("iter-%d", call),
			Choices: []Choice{{
				Message: Message{
					Role: "assistant",
					ToolCalls: []ToolCall{{
						ID:   fmt.Sprintf("tc_%d", call),
						Type: "function",
						Function: FunctionCall{
							Name: "fake_loki",
							// Distinct args per iteration so the repetition
							// guard executes every call — this test needs a
							// fresh tool result per iteration for eviction.
							Arguments: fmt.Sprintf(`{"i":%d}`, call),
						},
					}},
				},
				FinishReason: "tool_calls",
			}},
		})
	}))
	defer llmServer.Close()

	llmClient := NewLLMClient(log.DefaultLogger, &http.Client{Timeout: llmTimeout})
	mcpProxy := mcp.NewProxy(context.Background(), log.DefaultLogger)
	loop := NewAgentLoop(llmClient, mcpProxy, log.DefaultLogger)

	// Successful tool executions: the stall guard clamps runs whose every
	// call errors, and this test needs a full run of distinct tool results.
	setupFakeMCP(t, loop, func(srv *mcpsdk.Server) {
		srv.AddTool(&mcpsdk.Tool{Name: "loki", InputSchema: map[string]any{"type": "object"}}, func(ctx context.Context, req *mcpsdk.CallToolRequest) (*mcpsdk.CallToolResult, error) {
			return sdkToolResult("log lines", false), nil
		})
	})

	eventCh := make(chan SSEEvent, 256)
	req := LoopRequest{
		Messages:      []Message{{Role: "user", Content: "investigate"}},
		SystemPrompt:  "sys",
		MaxIterations: iterations + 2,
		ContextLimits: ContextLimits{KeepRecentToolResults: keepRecent},
		GrafanaURL:    llmServer.URL,
		AuthToken:     "test-token",
		UserRole:      "Admin",
		OrgID:         "1",
	}

	go loop.Run(context.Background(), req, eventCh)
	collectEvents(eventCh)

	mu.Lock()
	defer mu.Unlock()
	if mainCallCount < iterations+1 {
		t.Fatalf("expected at least %d main LLM calls, got %d", iterations+1, mainCallCount)
	}

	// The final MAIN request must honor the custom threshold: at most
	// keepRecent full tool results, the rest evicted to placeholders.
	last := lastMainBody
	if last == nil {
		t.Fatal("no main LLM request was recorded")
	}
	var lastReq ChatCompletionRequest
	if err := json.Unmarshal(last, &lastReq); err != nil {
		t.Fatalf("failed to unmarshal final LLM request: %v", err)
	}

	var evictedCount, fullCount int
	for _, m := range lastReq.Messages {
		if m.Role != "tool" {
			continue
		}
		if strings.HasPrefix(m.Content, EvictedToolResultMarker) {
			evictedCount++
		} else {
			fullCount++
		}
	}
	if evictedCount == 0 {
		t.Errorf("expected evicted tool results with keepRecent=%d, got none (fullCount=%d)", keepRecent, fullCount)
	}
	if fullCount > keepRecent {
		t.Errorf("expected at most %d full tool results with custom ContextLimits, got %d", keepRecent, fullCount)
	}
}

// --- Parallel tool execution tests ---

// setupFakeMCP registers a fake MCP server (backed by the official go-sdk)
// on the loop's proxy under server ID "fake". Tool names exposed to the loop
// are prefixed "fake_".
func setupFakeMCP(t *testing.T, loop *AgentLoop, register func(srv *mcpsdk.Server)) {
	t.Helper()
	srv := mcpsdk.NewServer(&mcpsdk.Implementation{Name: "fake", Version: "1.0.0"}, nil)
	register(srv)
	ts := httptest.NewServer(mcpsdk.NewStreamableHTTPHandler(func(*http.Request) *mcpsdk.Server { return srv }, nil))
	t.Cleanup(ts.Close)
	if err := loop.mcpProxy.UpdateConfig([]mcp.ServerConfig{{
		ID: "fake", Name: "fake", URL: ts.URL, Type: "streamable-http", Enabled: true,
	}}); err != nil {
		t.Fatalf("UpdateConfig: %v", err)
	}
}

func sdkToolResult(text string, isError bool) *mcpsdk.CallToolResult {
	return &mcpsdk.CallToolResult{
		IsError: isError,
		Content: []mcpsdk.Content{&mcpsdk.TextContent{Text: text}},
	}
}

// barrier is a simultaneous-presence barrier: proceed closes only when
// `party` handlers are waiting at the same time. A waiter that times out or
// is canceled leaves the party again, so serialized execution never lets a
// later call inherit an earlier call's arrival.
type barrier struct {
	mu      sync.Mutex
	party   int
	waiting int
	closed  bool
	proceed chan struct{}
}

func (b *barrier) arrive(giveUp time.Duration, ctx context.Context) bool {
	b.mu.Lock()
	b.waiting++
	if b.waiting >= b.party && !b.closed {
		b.closed = true
		close(b.proceed)
	}
	ch := b.proceed
	b.mu.Unlock()

	leave := func() {
		b.mu.Lock()
		b.waiting--
		b.mu.Unlock()
	}
	select {
	case <-ch:
		return true
	case <-time.After(giveUp):
		leave()
		return false
	case <-ctx.Done():
		leave()
		return false
	}
}

// barrierToolHandler returns a handler that only completes once `party`
// concurrent invocations have all arrived. A call that waits longer than
// giveUp returns an error result, so a serial executor (or a concurrency
// level below the party size) fails the batch.
func barrierToolHandler(party int, giveUp time.Duration) mcpsdk.ToolHandler {
	b := &barrier{party: party, proceed: make(chan struct{})}
	return func(ctx context.Context, req *mcpsdk.CallToolRequest) (*mcpsdk.CallToolResult, error) {
		if b.arrive(giveUp, ctx) {
			return sdkToolResult("barrier passed", false), nil
		}
		return sdkToolResult("barrier timeout", true), nil
	}
}

func toolCallBatchResponse(id string, calls []ToolCall) ChatCompletionResponse {
	return ChatCompletionResponse{
		ID: id,
		Choices: []Choice{{
			Message:      Message{Role: "assistant", ToolCalls: calls},
			FinishReason: "tool_calls",
		}},
	}
}

func textOnlyResponse(id, content string) ChatCompletionResponse {
	return ChatCompletionResponse{
		ID: id,
		Choices: []Choice{{
			Message:      Message{Role: "assistant", Content: content},
			FinishReason: "stop",
		}},
	}
}

func toolCall(id, name, args string) ToolCall {
	return ToolCall{ID: id, Type: "function", Function: FunctionCall{Name: name, Arguments: args}}
}

func boolPtrApproval() *bool { return &[]bool{true}[0] }

// TestAgentLoop_ParallelToolCallsRunConcurrently proves that a batch of
// read-only tool calls actually executes concurrently: each handler blocks
// until all three have arrived, which can only happen if the loop runs them
// in parallel. Sequential execution leaves every call at the timeout.
func TestAgentLoop_ParallelToolCallsRunConcurrently(t *testing.T) {
	handler := barrierToolHandler(3, 5*time.Second)

	loop, serverURL, cleanup := setupTestLoop(t, []ChatCompletionResponse{
		toolCallBatchResponse("1", []ToolCall{
			toolCall("tc_1", "fake_barrier", `{"i":1}`),
			toolCall("tc_2", "fake_barrier", `{"i":2}`),
			toolCall("tc_3", "fake_barrier", `{"i":3}`),
		}),
		textOnlyResponse("2", "all barriers passed"),
	})
	defer cleanup()
	setupFakeMCP(t, loop, func(srv *mcpsdk.Server) {
		srv.AddTool(&mcpsdk.Tool{Name: "barrier", InputSchema: map[string]any{"type": "object"}}, handler)
	})

	eventCh := make(chan SSEEvent, 32)
	req := LoopRequest{
		Messages:   []Message{{Role: "user", Content: "run the batch"}},
		GrafanaURL: serverURL,
		AuthToken:  "test-token",
		UserRole:   "Admin",
	}

	go loop.Run(context.Background(), req, eventCh)
	events := collectEvents(eventCh)

	results := toolResultEvents(t, events)
	if len(results) != 3 {
		t.Fatalf("expected 3 tool_call_result events, got %d", len(results))
	}
	for i, r := range results {
		if r.IsError {
			t.Errorf("result[%d] (%s) errored: %s — batch did not run concurrently", i, r.ID, r.Content)
		}
	}
}

// TestAgentLoop_ParallelToolCallsPreserveOrder proves results are surfaced in
// the original call order regardless of completion order: the call scheduled
// to finish last (n=1) must still produce the first tool_call_result event.
func TestAgentLoop_ParallelToolCallsPreserveOrder(t *testing.T) {
	loop, serverURL, cleanup := setupTestLoop(t, []ChatCompletionResponse{
		toolCallBatchResponse("1", []ToolCall{
			toolCall("tc_1", "fake_echo", `{"n":1}`),
			toolCall("tc_2", "fake_echo", `{"n":2}`),
			toolCall("tc_3", "fake_echo", `{"n":3}`),
		}),
		textOnlyResponse("2", "order checked"),
	})
	defer cleanup()
	setupFakeMCP(t, loop, func(srv *mcpsdk.Server) {
		srv.AddTool(&mcpsdk.Tool{Name: "echo", InputSchema: map[string]any{"type": "object"}}, func(ctx context.Context, req *mcpsdk.CallToolRequest) (*mcpsdk.CallToolResult, error) {
			var args struct {
				N int `json:"n"`
			}
			if err := json.Unmarshal(req.Params.Arguments, &args); err != nil {
				return sdkToolResult("bad args", true), nil
			}
			time.Sleep(time.Duration(300-100*(args.N-1)) * time.Millisecond)
			return sdkToolResult(fmt.Sprintf("result-%d", args.N), false), nil
		})
	})

	eventCh := make(chan SSEEvent, 32)
	req := LoopRequest{
		Messages:   []Message{{Role: "user", Content: "echo in order"}},
		GrafanaURL: serverURL,
		AuthToken:  "test-token",
		UserRole:   "Admin",
	}

	go loop.Run(context.Background(), req, eventCh)
	events := collectEvents(eventCh)

	results := toolResultEvents(t, events)
	want := []struct{ id, content string }{
		{"tc_1", "result-1"},
		{"tc_2", "result-2"},
		{"tc_3", "result-3"},
	}
	if len(results) != len(want) {
		t.Fatalf("expected %d tool_call_result events, got %d", len(want), len(results))
	}
	for i, w := range want {
		if results[i].ID != w.id || results[i].Content != w.content {
			t.Errorf("result[%d] = (%s, %q), want (%s, %q)", i, results[i].ID, results[i].Content, w.id, w.content)
		}
	}
}

// TestAgentLoop_ApprovalGatedBatchStaysSequential proves a batch containing
// an approval-gated tool falls back to sequential execution: the read-only
// barrier call runs to completion before the gated call is even attempted,
// and the gated call errors with approval_required (no registrar configured).
func TestAgentLoop_ApprovalGatedBatchStaysSequential(t *testing.T) {
	// Party of 2 but only one barrier call exists: the call can only complete
	// if it holds the executor alone while the gated call waits.
	handler := barrierToolHandler(2, 1*time.Second)

	loop, serverURL, cleanup := setupTestLoop(t, []ChatCompletionResponse{
		toolCallBatchResponse("1", []ToolCall{
			toolCall("tc_1", "fake_barrier", `{}`),
			toolCall("tc_2", "fake_blast", `{}`),
		}),
		textOnlyResponse("2", "handled"),
	})
	defer cleanup()

	mcpSrv := mcpsdk.NewServer(&mcpsdk.Implementation{Name: "fake", Version: "1.0.0"}, nil)
	mcpSrv.AddTool(&mcpsdk.Tool{Name: "barrier", InputSchema: map[string]any{"type": "object"}}, handler)
	// blast is a real registered tool so the proxy can resolve it; its handler
	// must never run — the approval gate intercepts before execution.
	mcpSrv.AddTool(&mcpsdk.Tool{Name: "blast", InputSchema: map[string]any{"type": "object"}}, func(ctx context.Context, req *mcpsdk.CallToolRequest) (*mcpsdk.CallToolResult, error) {
		return sdkToolResult("blast ran — approval gate bypassed", false), nil
	})
	mcpTS := httptest.NewServer(mcpsdk.NewStreamableHTTPHandler(func(*http.Request) *mcpsdk.Server { return mcpSrv }, nil))
	defer mcpTS.Close()

	riskCfg := mcp.ServerConfig{
		ID: "fake", Name: "fake", URL: mcpTS.URL, Type: "streamable-http", Enabled: true,
		RiskOverrides: map[string]mcp.ToolRiskOverride{
			"fake_blast": {RequiresApproval: boolPtrApproval(), Reason: "test write tool"},
		},
	}
	if err := loop.mcpProxy.UpdateConfig([]mcp.ServerConfig{riskCfg}); err != nil {
		t.Fatalf("UpdateConfig: %v", err)
	}

	eventCh := make(chan SSEEvent, 32)
	req := LoopRequest{
		Messages:       []Message{{Role: "user", Content: "mixed batch"}},
		GrafanaURL:     serverURL,
		AuthToken:      "test-token",
		UserRole:       "Admin",
		ApprovalPolicy: "always",
		MCPServers:     []mcp.ServerConfig{riskCfg},
	}

	go loop.Run(context.Background(), req, eventCh)
	events := collectEvents(eventCh)

	results := toolResultEvents(t, events)
	if len(results) != 2 {
		t.Fatalf("expected 2 tool_call_result events, got %d", len(results))
	}
	if results[0].ID != "tc_1" || !results[0].IsError || !strings.Contains(results[0].Content, "barrier timeout") {
		t.Errorf("barrier result = (%s, isError=%v, %q), want timed-out barrier", results[0].ID, results[0].IsError, results[0].Content)
	}
	if results[1].ID != "tc_2" || results[1].ErrorKind != "approval_required" {
		t.Errorf("blast result = (%s, isError=%v, errorKind=%q), want approval_required", results[1].ID, results[1].IsError, results[1].ErrorKind)
	}
}

// TestAgentLoop_MaxParallelOneSerializes proves MaxParallelToolCalls=1 caps
// concurrency: two barrier calls with a party of 2 can never both arrive, so
// both must time out.
func TestAgentLoop_MaxParallelOneSerializes(t *testing.T) {
	handler := barrierToolHandler(2, 1*time.Second)

	loop, serverURL, cleanup := setupTestLoop(t, []ChatCompletionResponse{
		toolCallBatchResponse("1", []ToolCall{
			toolCall("tc_1", "fake_barrier", `{"i":1}`),
			toolCall("tc_2", "fake_barrier", `{"i":2}`),
		}),
		textOnlyResponse("2", "serialized"),
	})
	defer cleanup()
	setupFakeMCP(t, loop, func(srv *mcpsdk.Server) {
		srv.AddTool(&mcpsdk.Tool{Name: "barrier", InputSchema: map[string]any{"type": "object"}}, handler)
	})

	eventCh := make(chan SSEEvent, 32)
	one := 1
	req := LoopRequest{
		Messages:             []Message{{Role: "user", Content: "serial batch"}},
		GrafanaURL:           serverURL,
		AuthToken:            "test-token",
		UserRole:             "Admin",
		MaxParallelToolCalls: one,
	}

	go loop.Run(context.Background(), req, eventCh)
	events := collectEvents(eventCh)

	results := toolResultEvents(t, events)
	if len(results) != 2 {
		t.Fatalf("expected 2 tool_call_result events, got %d", len(results))
	}
	for i, r := range results {
		if !r.IsError || !strings.Contains(r.Content, "barrier timeout") {
			t.Errorf("result[%d] = (isError=%v, %q), want barrier timeout (calls overlapped)", i, r.IsError, r.Content)
		}
	}
}

// TestBatchParallelizable unit-tests the parallel-execution gate: only
// multi-call batches of known, non-approval-gated, non-load_skill tools
// qualify.
func TestBatchParallelizable(t *testing.T) {
	llmClient := NewLLMClient(log.DefaultLogger, &http.Client{Timeout: llmTimeout})
	loop := NewAgentLoop(llmClient, mcp.NewProxy(context.Background(), log.DefaultLogger), log.DefaultLogger)

	barrierHandler := barrierToolHandler(2, 50*time.Millisecond)
	srv := mcpsdk.NewServer(&mcpsdk.Implementation{Name: "fake", Version: "1.0.0"}, nil)
	srv.AddTool(&mcpsdk.Tool{Name: "barrier", InputSchema: map[string]any{"type": "object"}}, barrierHandler)
	srv.AddTool(&mcpsdk.Tool{Name: "blast", InputSchema: map[string]any{"type": "object"}}, func(ctx context.Context, req *mcpsdk.CallToolRequest) (*mcpsdk.CallToolResult, error) {
		return sdkToolResult("blast ran — approval gate bypassed", false), nil
	})
	ts := httptest.NewServer(mcpsdk.NewStreamableHTTPHandler(func(*http.Request) *mcpsdk.Server { return srv }, nil))
	defer ts.Close()
	riskCfg := mcp.ServerConfig{
		ID: "fake", Name: "fake", URL: ts.URL, Type: "streamable-http", Enabled: true,
		RiskOverrides: map[string]mcp.ToolRiskOverride{
			"fake_blast": {RequiresApproval: boolPtrApproval(), Reason: "test write tool"},
		},
	}
	if err := loop.mcpProxy.UpdateConfig([]mcp.ServerConfig{riskCfg}); err != nil {
		t.Fatalf("UpdateConfig: %v", err)
	}
	// FindToolByName reads the per-client tool cache, which only
	// ListToolsWithContext populates — warm it the way a real run does.
	if _, err := loop.mcpProxy.ListToolsWithContext(context.Background()); err != nil {
		t.Fatalf("ListToolsWithContext: %v", err)
	}

	approvalAlways := LoopRequest{ApprovalPolicy: "always", MCPServers: []mcp.ServerConfig{riskCfg}}
	noPolicy := LoopRequest{MCPServers: []mcp.ServerConfig{riskCfg}}

	cases := []struct {
		name  string
		calls []ToolCall
		req   LoopRequest
		want  bool
	}{
		{
			name:  "single call never parallel",
			calls: []ToolCall{toolCall("tc_1", "fake_barrier", "{}")},
			req:   approvalAlways,
			want:  false,
		},
		{
			name: "load_skill blocks the batch",
			calls: []ToolCall{
				toolCall("tc_1", "fake_barrier", "{}"),
				toolCall("tc_2", "load_skill", `{"skill":"x"}`),
			},
			req:  approvalAlways,
			want: false,
		},
		{
			name: "unknown tool blocks the batch",
			calls: []ToolCall{
				toolCall("tc_1", "fake_barrier", "{}"),
				toolCall("tc_2", "fake_missing", "{}"),
			},
			req:  approvalAlways,
			want: false,
		},
		{
			name: "approval-gated tool blocks the batch",
			calls: []ToolCall{
				toolCall("tc_1", "fake_barrier", "{}"),
				toolCall("tc_2", "fake_blast", "{}"),
			},
			req:  approvalAlways,
			want: false,
		},
		{
			name: "plain read-only batch is parallelizable",
			calls: []ToolCall{
				toolCall("tc_1", "fake_barrier", "{}"),
				toolCall("tc_2", "fake_barrier", "{}"),
			},
			req:  approvalAlways,
			want: true,
		},
		{
			name: "no approval policy accepts any known batch",
			calls: []ToolCall{
				toolCall("tc_1", "fake_barrier", "{}"),
				toolCall("tc_2", "fake_blast", "{}"),
			},
			req:  noPolicy,
			want: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := loop.batchParallelizable(tc.calls, tc.req); got != tc.want {
				t.Errorf("batchParallelizable = %v, want %v", got, tc.want)
			}
		})
	}
}

// toolResultEvents extracts the tool_call_result payloads from an event list.
func toolResultEvents(t *testing.T, events []SSEEvent) []ToolCallResultEvent {
	t.Helper()
	var results []ToolCallResultEvent
	for _, e := range events {
		if e.Type == "tool_call_result" {
			results = append(results, e.Data.(ToolCallResultEvent))
		}
	}
	return results
}

// TestAgentLoop_ExactDuplicateCallReplaysCache proves the repetition guard:
// a byte-identical repeat of an earlier successful call is answered from the
// run's cache (no second MCP execution) with a directive telling the model
// it is a repeat.
func TestAgentLoop_ExactDuplicateCallReplaysCache(t *testing.T) {
	var mcpCalls atomic.Int32
	loop, serverURL, cleanup := setupTestLoop(t, []ChatCompletionResponse{
		toolCallBatchResponse("1", []ToolCall{
			toolCall("tc_1", "fake_echo", `{"n":1}`),
		}),
		toolCallBatchResponse("2", []ToolCall{
			toolCall("tc_2", "fake_echo", `{ "n" : 1 }`), // same call, different formatting and id
		}),
		textOnlyResponse("3", "done investigating"),
	})
	defer cleanup()
	setupFakeMCP(t, loop, func(srv *mcpsdk.Server) {
		srv.AddTool(&mcpsdk.Tool{Name: "echo", InputSchema: map[string]any{"type": "object"}}, func(ctx context.Context, req *mcpsdk.CallToolRequest) (*mcpsdk.CallToolResult, error) {
			mcpCalls.Add(1)
			return sdkToolResult("one", false), nil
		})
	})

	eventCh := make(chan SSEEvent, 32)
	req := LoopRequest{
		Messages:   []Message{{Role: "user", Content: "echo twice"}},
		GrafanaURL: serverURL,
		AuthToken:  "test-token",
		UserRole:   "Admin",
	}

	go loop.Run(context.Background(), req, eventCh)
	events := collectEvents(eventCh)

	if got := mcpCalls.Load(); got != 1 {
		t.Errorf("MCP handler executed %d times, want 1 (duplicate must be replayed)", got)
	}
	results := toolResultEvents(t, events)
	if len(results) != 2 {
		t.Fatalf("expected 2 tool_call_result events, got %d", len(results))
	}
	if results[1].ID != "tc_2" || results[1].IsError || !strings.Contains(results[1].Content, "identical call already executed at iteration 0") {
		t.Errorf("replayed result = (%s, isError=%v, %q), want cached content with duplicate directive", results[1].ID, results[1].IsError, results[1].Content)
	}
	for _, e := range events {
		if e.Type == "stall" {
			t.Errorf("single duplicate must not trigger the repetition nudge, got %+v", e.Data)
		}
	}
}

// TestAgentLoop_StallGuardNudgesThenForcesFinal proves the stalled-progress
// escalation: after stalledIterationThreshold consecutive no-progress
// iterations the model gets a stalled nudge; when it keeps failing, a second
// nudge forces a final answer by shortening the remaining budget.
func TestAgentLoop_StallGuardNudgesThenForcesFinal(t *testing.T) {
	// Identical arguments every time: failures are never cached, so these
	// are exact-signature repeats that only feed the no-progress streak —
	// a pure stalled-progress scenario, no repetition nudge.
	const args = `{"q":"boom"}`
	loop, serverURL, cleanup := setupTestLoop(t, []ChatCompletionResponse{
		toolCallBatchResponse("1", []ToolCall{toolCall("tc_1", "fake_fail", args)}),
		toolCallBatchResponse("2", []ToolCall{toolCall("tc_2", "fake_fail", args)}),
		toolCallBatchResponse("3", []ToolCall{toolCall("tc_3", "fake_fail", args)}),
		toolCallBatchResponse("4", []ToolCall{toolCall("tc_4", "fake_fail", args)}),
		toolCallBatchResponse("5", []ToolCall{toolCall("tc_5", "fake_fail", args)}),
		toolCallBatchResponse("6", []ToolCall{toolCall("tc_6", "fake_fail", args)}),
	})
	defer cleanup()
	setupFakeMCP(t, loop, func(srv *mcpsdk.Server) {
		srv.AddTool(&mcpsdk.Tool{Name: "fail", InputSchema: map[string]any{"type": "object"}}, func(ctx context.Context, req *mcpsdk.CallToolRequest) (*mcpsdk.CallToolResult, error) {
			return sdkToolResult("boom", true), nil
		})
	})

	eventCh := make(chan SSEEvent, 64)
	req := LoopRequest{
		Messages:      []Message{{Role: "user", Content: "keep failing"}},
		GrafanaURL:    serverURL,
		AuthToken:     "test-token",
		UserRole:      "Admin",
		MaxIterations: 50,
	}

	go loop.Run(context.Background(), req, eventCh)
	events := collectEvents(eventCh)

	var kinds []string
	for _, e := range events {
		if e.Type == "stall" {
			kinds = append(kinds, e.Data.(StallEvent).Kind)
		}
	}
	wantKinds := []string{StallKindStalled, StallKindForcedFinal}
	if len(kinds) != len(wantKinds) {
		t.Fatalf("stall event kinds = %v, want %v", kinds, wantKinds)
	}
	for i := range wantKinds {
		if kinds[i] != wantKinds[i] {
			t.Errorf("stall event[%d] kind = %s, want %s", i, kinds[i], wantKinds[i])
		}
	}

	// The forced-final nudge must have clamped the budget: the run aborts at
	// iteration 6 (the clamp point), not the configured 50.
	last := events[len(events)-1]
	if last.Type != "error" || !strings.Contains(last.Data.(ErrorEvent).Message, "maximum iterations (6)") {
		t.Errorf("final event = (%s, %+v), want max-iterations error clamped to 6", last.Type, last.Data)
	}
}

const rcaFinalContent = "Verdict: payment errors.\n\n```rca-report\n{\"hypotheses\":[{\"rank\":1,\"component\":\"payment\",\"faultType\":\"high error rate\",\"confidence\":\"high\",\"evidenceIds\":[\"tc_1\"],\"propagationPath\":[\"frontend\",\"checkout\",\"payment\"],\"firstSeen\":\"2026-09-25T10:05:00Z\"}],\"gaps\":[\"no trace data\"]}\n```"

const rcaTopology = "checkout -> payment (rps 12.34, err 10.0%)\nfrontend -> checkout (rps 30.00)\n"

// TestAgentLoop_RCAReportParsedValidatedAndStripped proves the structured
// final report: the fenced rca-report block feeds Hypotheses/Validation on
// the final_report event and is stripped from the user-visible content.
func TestAgentLoop_RCAReportParsedValidatedAndStripped(t *testing.T) {
	loop, serverURL, cleanup := setupTestLoop(t, []ChatCompletionResponse{
		toolCallBatchResponse("1", []ToolCall{toolCall("tc_1", "fake_echo", `{"n":1}`)}),
		textOnlyResponse("2", rcaFinalContent),
	})
	defer cleanup()
	setupFakeMCP(t, loop, func(srv *mcpsdk.Server) {
		srv.AddTool(&mcpsdk.Tool{Name: "echo", InputSchema: map[string]any{"type": "object"}}, func(ctx context.Context, req *mcpsdk.CallToolRequest) (*mcpsdk.CallToolResult, error) {
			return sdkToolResult("one", false), nil
		})
	})

	eventCh := make(chan SSEEvent, 32)
	req := LoopRequest{
		Messages:        []Message{{Role: "user", Content: "investigate"}},
		GrafanaURL:      serverURL,
		AuthToken:       "test-token",
		UserRole:        "Admin",
		ServiceTopology: rcaTopology,
	}

	go loop.Run(context.Background(), req, eventCh)
	events := collectEvents(eventCh)

	var final *FinalReportEvent
	var content string
	for _, e := range events {
		switch e.Type {
		case "final_report":
			f := e.Data.(FinalReportEvent)
			final = &f
		case "content":
			content = e.Data.(ContentEvent).Content
		}
	}
	if final == nil {
		t.Fatal("no final_report event")
	}
	if len(final.Hypotheses) != 1 || final.Hypotheses[0].Component != "payment" {
		t.Errorf("hypotheses = %+v, want the payment hypothesis", final.Hypotheses)
	}
	if final.Confidence != "high" {
		t.Errorf("confidence = %q, want high (from the rank-1 hypothesis)", final.Confidence)
	}
	if final.Validation == nil || !final.Validation.ok() {
		t.Errorf("validation = %+v, want all checks passing", final.Validation)
	}
	if !strings.Contains(final.Summary, "payment errors") {
		t.Errorf("summary = %q, want prose (not the JSON block)", final.Summary)
	}
	if strings.Contains(content, "rca-report") {
		t.Errorf("user-visible content still contains the block: %q", content)
	}
}

// TestAgentLoop_RCAReportRepairTurn proves the one repair iteration: a final
// answer whose rca-report cites bogus evidence gets a system nudge and the
// loop continues; the repaired answer's validation records Repaired.
func TestAgentLoop_RCAReportRepairTurn(t *testing.T) {
	bogus := strings.Replace(rcaFinalContent, `"evidenceIds":["tc_1"]`, `"evidenceIds":["tc_bogus"]`, 1)
	bogus = strings.Replace(bogus, `["frontend","checkout","payment"]`, `["frontend","moon"]`, 1)

	var requestBodies [][]byte
	var mu sync.Mutex
	loop, serverURL, cleanup := setupTestLoop(t, []ChatCompletionResponse{
		toolCallBatchResponse("1", []ToolCall{toolCall("tc_1", "fake_echo", `{"n":1}`)}),
		textOnlyResponse("2", bogus),
		textOnlyResponse("3", rcaFinalContent),
	})
	defer cleanup()
	// Wrap the LLM server to capture request bodies for the nudge assertion.
	loop.llmClient = recordingClient(t, &mu, &requestBodies, serverURL)
	setupFakeMCP(t, loop, func(srv *mcpsdk.Server) {
		srv.AddTool(&mcpsdk.Tool{Name: "echo", InputSchema: map[string]any{"type": "object"}}, func(ctx context.Context, req *mcpsdk.CallToolRequest) (*mcpsdk.CallToolResult, error) {
			return sdkToolResult("one", false), nil
		})
	})

	eventCh := make(chan SSEEvent, 32)
	req := LoopRequest{
		Messages:        []Message{{Role: "user", Content: "investigate"}},
		GrafanaURL:      serverURL,
		AuthToken:       "test-token",
		UserRole:        "Admin",
		ServiceTopology: rcaTopology,
	}

	go loop.Run(context.Background(), req, eventCh)
	events := collectEvents(eventCh)

	var final *FinalReportEvent
	for _, e := range events {
		if e.Type == "final_report" {
			f := e.Data.(FinalReportEvent)
			final = &f
		}
	}
	if final == nil {
		t.Fatal("no final_report event")
	}
	if final.Validation == nil || !final.Validation.Repaired {
		t.Errorf("validation = %+v, want Repaired=true after the repair turn", final.Validation)
	}
	if !final.Validation.ok() {
		t.Errorf("validation = %+v, want passing after repair", final.Validation)
	}

	// The repair nudge reached the model as a one-shot system message on the
	// last MAIN model request. Background eviction-summary calls (model
	// "base") also cross the transport; skip them.
	mu.Lock()
	defer mu.Unlock()
	var lastMainReq ChatCompletionRequest
	foundMain := false
	for _, body := range requestBodies {
		var parsed ChatCompletionRequest
		if err := json.Unmarshal(body, &parsed); err != nil {
			t.Fatalf("unmarshal request: %v", err)
		}
		if parsed.Model == "base" {
			continue
		}
		lastMainReq = parsed
		foundMain = true
	}
	if !foundMain {
		t.Fatalf("no main-model LLM requests captured, got %d bodies", len(requestBodies))
	}
	foundNudge := false
	for _, m := range lastMainReq.Messages {
		if m.Role == "user" && strings.Contains(m.Content, "failed validation") {
			foundNudge = true
		}
	}
	if last := lastMainReq.Messages[len(lastMainReq.Messages)-1]; last.Role == "assistant" {
		t.Errorf("repair request must not end on an assistant turn")
	}
	if !foundNudge {
		t.Errorf("repair nudge missing from the final LLM request: %+v", lastMainReq.Messages)
	}
}

// TestAgentLoop_RCAReportNoBudgetNoRepair proves the repair turn respects
// the iteration budget: with only one iteration left, the invalid report is
// emitted as-is with its warnings surfaced in Gaps.
func TestAgentLoop_RCAReportNoBudgetNoRepair(t *testing.T) {
	bogus := strings.Replace(rcaFinalContent, `"evidenceIds":["tc_1"]`, `"evidenceIds":["tc_bogus"]`, 1)
	loop, serverURL, cleanup := setupTestLoop(t, []ChatCompletionResponse{
		toolCallBatchResponse("1", []ToolCall{toolCall("tc_1", "fake_echo", `{"n":1}`)}),
		textOnlyResponse("2", bogus),
	})
	defer cleanup()
	setupFakeMCP(t, loop, func(srv *mcpsdk.Server) {
		srv.AddTool(&mcpsdk.Tool{Name: "echo", InputSchema: map[string]any{"type": "object"}}, func(ctx context.Context, req *mcpsdk.CallToolRequest) (*mcpsdk.CallToolResult, error) {
			return sdkToolResult("one", false), nil
		})
	})

	eventCh := make(chan SSEEvent, 32)
	req := LoopRequest{
		Messages:      []Message{{Role: "user", Content: "investigate"}},
		GrafanaURL:    serverURL,
		AuthToken:     "test-token",
		UserRole:      "Admin",
		MaxIterations: 2, // iter0: tool call; iter1: final — no budget for repair
	}

	go loop.Run(context.Background(), req, eventCh)
	events := collectEvents(eventCh)

	var final *FinalReportEvent
	for _, e := range events {
		if e.Type == "final_report" {
			f := e.Data.(FinalReportEvent)
			final = &f
		}
	}
	if final == nil {
		t.Fatal("no final_report event")
	}
	if final.Validation == nil || final.Validation.ok() {
		t.Errorf("validation = %+v, want failed checks", final.Validation)
	}
	if len(final.Gaps) == 0 {
		t.Error("expected validation warnings surfaced as gaps")
	}
}

// recordingClient wraps the LLM client with a transport that captures every
// request body before forwarding it to the real URL.
func recordingClient(t *testing.T, mu *sync.Mutex, bodies *[][]byte, serverURL string) *LLMClient {
	t.Helper()
	transport := recordingTransport{t: t, mu: mu, bodies: bodies, base: serverURL}
	return NewLLMClient(log.DefaultLogger, &http.Client{Timeout: llmTimeout, Transport: transport})
}

type recordingTransport struct {
	t      *testing.T
	mu     *sync.Mutex
	bodies *[][]byte
	base   string
}

func (rt recordingTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.String() == rt.base+"/api/plugins/grafana-llm-app/resources/openai/v1/chat/completions" && req.Body != nil {
		body, err := io.ReadAll(req.Body)
		if err != nil {
			return nil, err
		}
		req.Body = io.NopCloser(strings.NewReader(string(body)))
		rt.mu.Lock()
		*rt.bodies = append(*rt.bodies, body)
		rt.mu.Unlock()
	}
	return http.DefaultTransport.RoundTrip(req)
}

// A repaired answer that only re-emits the rca-report block keeps the prose
// of the first answer (production run showed an empty content event), and a
// tool name cited as evidence is accepted as grounded.
func TestAgentLoop_RCAReportRepairKeepsProseAndAcceptsToolName(t *testing.T) {
	bogus := strings.Replace(rcaFinalContent, `"evidenceIds":["tc_1"]`, `"evidenceIds":["tc_bogus"]`, 1)
	blockOnly := strings.Replace(rcaFinalContent, "Verdict: payment errors.\n\n", "", 1)
	blockOnly = strings.Replace(blockOnly, `"evidenceIds":["tc_1"]`, `"evidenceIds":["fake_echo"]`, 1)

	var requestBodies [][]byte
	var mu sync.Mutex
	loop, serverURL, cleanup := setupTestLoop(t, []ChatCompletionResponse{
		toolCallBatchResponse("1", []ToolCall{toolCall("tc_1", "fake_echo", `{"n":1}`)}),
		textOnlyResponse("2", bogus),
		textOnlyResponse("3", blockOnly),
	})
	defer cleanup()
	loop.llmClient = recordingClient(t, &mu, &requestBodies, serverURL)
	setupFakeMCP(t, loop, func(srv *mcpsdk.Server) {
		srv.AddTool(&mcpsdk.Tool{Name: "echo", InputSchema: map[string]any{"type": "object"}}, func(ctx context.Context, req *mcpsdk.CallToolRequest) (*mcpsdk.CallToolResult, error) {
			return sdkToolResult("one", false), nil
		})
	})

	eventCh := make(chan SSEEvent, 32)
	go loop.Run(context.Background(), LoopRequest{
		Messages:        []Message{{Role: "user", Content: "investigate"}},
		GrafanaURL:      serverURL,
		AuthToken:       "test-token",
		UserRole:        "Admin",
		ServiceTopology: rcaTopology,
	}, eventCh)
	events := collectEvents(eventCh)

	var final *FinalReportEvent
	content := ""
	for _, e := range events {
		switch e.Type {
		case "final_report":
			f := e.Data.(FinalReportEvent)
			final = &f
		case "content":
			content = e.Data.(ContentEvent).Content
		}
	}
	if final == nil || final.Validation == nil {
		t.Fatalf("final report = %+v", final)
	}
	if !final.Validation.Repaired || !final.Validation.EvidenceGrounded {
		t.Errorf("validation = %+v, want repaired and evidence grounded via tool name", final.Validation)
	}
	if content != "Verdict: payment errors." {
		t.Errorf("content = %q, want the first answer's prose", content)
	}

	// Successful tool results carry the evidence id header for the model.
	mu.Lock()
	defer mu.Unlock()
	foundHeader := false
	for _, body := range requestBodies {
		if strings.Contains(string(body), "[evidence id: e1]") {
			foundHeader = true
		}
	}
	if !foundHeader {
		t.Error("evidence id header missing from tool results sent to the model")
	}
}

func TestEnsureNonAssistantTail(t *testing.T) {
	sys := Message{Role: "system", Content: "base"}
	user := Message{Role: "user", Content: "q"}
	asst := Message{Role: "assistant", Content: "a"}
	tool := Message{Role: "tool", Content: "r", ToolCallID: "c1"}
	nudge := Message{Role: "system", Content: "fix report"}

	t.Run("tool tail unchanged", func(t *testing.T) {
		in := []Message{sys, user, tool, nudge}
		if got := ensureNonAssistantTail(in); len(got) != 4 || got[3].Role != "system" {
			t.Fatalf("unexpected rewrite: %+v", got)
		}
	})
	t.Run("assistant then nudge becomes user", func(t *testing.T) {
		in := []Message{sys, user, asst, nudge}
		got := ensureNonAssistantTail(in)
		if len(got) != 4 || got[3].Role != "user" || got[3].Content != "fix report" {
			t.Fatalf("got %+v", got)
		}
		if in[3].Role != "system" {
			t.Fatal("input mutated")
		}
		if got[0].Role != "system" {
			t.Fatal("leading system prompt must stay system")
		}
	})
	t.Run("bare assistant tail gets continue", func(t *testing.T) {
		got := ensureNonAssistantTail([]Message{sys, user, asst})
		if len(got) != 4 || got[3].Role != "user" || got[3].Content != continueUserTurn {
			t.Fatalf("got %+v", got)
		}
	})
}

// A final answer cut off by the completion budget (finish_reason=length) is
// re-requested once with a larger budget instead of being shown half-written.
func TestAgentLoop_TruncatedFinalAnswerRetriedWithLargerBudget(t *testing.T) {
	truncated := textOnlyResponse("1", "### Verdict\nBenign: the threshold is sta")
	truncated.Choices[0].FinishReason = "length"

	var mu sync.Mutex
	var budgets []int
	var callIdx atomic.Int32
	responses := []ChatCompletionResponse{truncated, textOnlyResponse("2", "### Verdict\nBenign: the threshold is stale.")}
	llm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var parsed ChatCompletionRequest
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &parsed)
		mu.Lock()
		budgets = append(budgets, parsed.MaxCompletionTokens)
		mu.Unlock()
		idx := int(callIdx.Add(1)) - 1
		if idx >= len(responses) {
			idx = len(responses) - 1
		}
		respondAsStream(w, responses[idx])
	}))
	defer llm.Close()

	llmClient := NewLLMClient(log.DefaultLogger, &http.Client{Timeout: llmTimeout})
	loop := NewAgentLoop(llmClient, mcp.NewProxy(context.Background(), log.DefaultLogger), log.DefaultLogger)
	eventCh := make(chan SSEEvent, 32)
	go loop.Run(context.Background(), LoopRequest{
		Messages:   []Message{{Role: "user", Content: "investigate"}},
		GrafanaURL: llm.URL,
		AuthToken:  "test-token",
		UserRole:   "Admin",
	}, eventCh)
	events := collectEvents(eventCh)

	var contents []string
	for _, e := range events {
		if e.Type == "content" {
			contents = append(contents, e.Data.(ContentEvent).Content)
		}
	}
	if len(contents) != 1 || !strings.HasSuffix(contents[0], "stale.") {
		t.Fatalf("expected only the complete retried answer, got %q", contents)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(budgets) != 2 || budgets[1] != finalAnswerCompletionTokens || budgets[0] >= budgets[1] {
		t.Fatalf("expected retry with boosted budget, got %v", budgets)
	}
}

func TestAgentLoop_EmptyFinalAnswerNudgedOnceThenFallback(t *testing.T) {
	for _, tc := range []struct {
		name      string
		responses []ChatCompletionResponse
		want      string
		wantCalls int32
	}{
		{"recovers", []ChatCompletionResponse{textOnlyResponse("1", ""), textOnlyResponse("2", "### Verdict\nBenign.")}, "### Verdict\nBenign.", 2},
		{"fallback", []ChatCompletionResponse{textOnlyResponse("1", ""), textOnlyResponse("2", "")}, emptyFinalFallback, 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var callIdx atomic.Int32
			var sawNudge atomic.Bool
			llm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				body, _ := io.ReadAll(r.Body)
				if strings.Contains(string(body), "previous reply was empty") {
					sawNudge.Store(true)
				}
				idx := int(callIdx.Add(1)) - 1
				if idx >= len(tc.responses) {
					idx = len(tc.responses) - 1
				}
				respondAsStream(w, tc.responses[idx])
			}))
			defer llm.Close()

			loop := NewAgentLoop(NewLLMClient(log.DefaultLogger, &http.Client{Timeout: llmTimeout}),
				mcp.NewProxy(context.Background(), log.DefaultLogger), log.DefaultLogger)
			eventCh := make(chan SSEEvent, 32)
			go loop.Run(context.Background(), LoopRequest{
				Messages:   []Message{{Role: "user", Content: "investigate"}},
				GrafanaURL: llm.URL,
				AuthToken:  "test-token",
				UserRole:   "Admin",
			}, eventCh)
			var contents []string
			finalReports := 0
			for _, e := range collectEvents(eventCh) {
				switch e.Type {
				case "content":
					contents = append(contents, e.Data.(ContentEvent).Content)
				case "final_report":
					finalReports++
				}
			}
			if len(contents) != 1 || contents[0] != tc.want || finalReports != 1 {
				t.Fatalf("contents=%q finalReports=%d", contents, finalReports)
			}
			if callIdx.Load() != tc.wantCalls || !sawNudge.Load() {
				t.Fatalf("calls=%d sawNudge=%v", callIdx.Load(), sawNudge.Load())
			}
		})
	}
}
