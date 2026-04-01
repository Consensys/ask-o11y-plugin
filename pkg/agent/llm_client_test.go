package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func writeSSEChunks(w http.ResponseWriter, chunks ...string) {
	w.Header().Set("Content-Type", "text/event-stream")
	for _, c := range chunks {
		fmt.Fprintf(w, "data: %s\n\n", c)
	}
	fmt.Fprintf(w, "data: [DONE]\n\n")
}

func TestLLMClient_ChatCompletion(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("expected auth header, got %q", r.Header.Get("Authorization"))
		}
		// SA token auth must NOT set X-Grafana-Org-Id — the SA token is
		// Org-1-scoped, so pairing it with another org causes a 401.
		if r.Header.Get("X-Grafana-Org-Id") != "" {
			t.Errorf("expected no org header with SA token auth, got %q", r.Header.Get("X-Grafana-Org-Id"))
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("expected content-type json, got %q", r.Header.Get("Content-Type"))
		}

		var req ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("failed to decode request: %v", err)
		}
		if req.Model != "large" {
			t.Errorf("expected model 'large', got %q", req.Model)
		}
		if !req.Stream {
			t.Errorf("expected stream=true in request")
		}
		if len(req.Messages) != 1 {
			t.Errorf("expected 1 message, got %d", len(req.Messages))
		}

		writeSSEChunks(w,
			`{"id":"test-id","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}`,
			`{"id":"test-id","choices":[{"index":0,"delta":{"content":"Hello from the LLM!"},"finish_reason":null}]}`,
			`{"id":"test-id","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
		)
	}))
	defer server.Close()

	client := NewLLMClient(log.DefaultLogger, &http.Client{Timeout: llmTimeout})

	resp, err := client.ChatCompletion(context.Background(), ChatCompletionRequest{
		Messages: []Message{{Role: "user", Content: "hi"}},
	}, server.URL, "test-token", "42")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Choices[0].Message.Content != "Hello from the LLM!" {
		t.Errorf("unexpected content: %q", resp.Choices[0].Message.Content)
	}
}

func TestLLMClient_ChatCompletion_FallbackToToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Cookie") != "" {
			t.Errorf("expected no cookie header, got %q", r.Header.Get("Cookie"))
		}
		if r.Header.Get("Authorization") != "Bearer sa-token" {
			t.Errorf("expected SA token auth, got %q", r.Header.Get("Authorization"))
		}
		if r.Header.Get("X-Grafana-Org-Id") != "" {
			t.Errorf("expected no org header with SA token fallback, got %q", r.Header.Get("X-Grafana-Org-Id"))
		}

		writeSSEChunks(w,
			`{"id":"test-id","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}`,
			`{"id":"test-id","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
		)
	}))
	defer server.Close()

	client := NewLLMClient(log.DefaultLogger, &http.Client{Timeout: llmTimeout})
	resp, err := client.ChatCompletion(context.Background(), ChatCompletionRequest{
		Messages: []Message{{Role: "user", Content: "hi"}},
	}, server.URL, "sa-token", "1")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Choices[0].Message.Content != "ok" {
		t.Errorf("unexpected content: %q", resp.Choices[0].Message.Content)
	}
}

func TestLLMClient_ChatCompletion_Error(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("internal error"))
	}))
	defer server.Close()

	client := NewLLMClient(log.DefaultLogger, &http.Client{Timeout: llmTimeout})
	_, err := client.ChatCompletion(context.Background(), ChatCompletionRequest{
		Messages: []Message{{Role: "user", Content: "hi"}},
	}, server.URL, "", "1")

	if err == nil {
		t.Fatal("expected error for 500 response")
	}
}

func TestLLMClient_ChatCompletion_ContextCancelled(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer server.Close()

	client := NewLLMClient(log.DefaultLogger, &http.Client{Timeout: llmTimeout})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := client.ChatCompletion(ctx, ChatCompletionRequest{
		Messages: []Message{{Role: "user", Content: "hi"}},
	}, server.URL, "", "1")

	if err == nil {
		t.Fatal("expected error for cancelled context")
	}
}

func TestLLMClient_ChatCompletion_ToolCall(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("failed to decode request: %v", err)
		}
		if !req.Stream {
			t.Errorf("expected stream=true in request")
		}

		writeSSEChunks(w,
			`{"id":"tc-id","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"search","arguments":""}}]},"finish_reason":null}]}`,
			`{"id":"tc-id","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"q\":"}}]},"finish_reason":null}]}`,
			`{"id":"tc-id","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"foo\"}"}}]},"finish_reason":null}]}`,
			`{"id":"tc-id","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`,
		)
	}))
	defer server.Close()

	client := NewLLMClient(log.DefaultLogger, &http.Client{Timeout: llmTimeout})
	resp, err := client.ChatCompletion(context.Background(), ChatCompletionRequest{
		Messages: []Message{{Role: "user", Content: "search for foo"}},
	}, server.URL, "token", "1")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(resp.Choices[0].Message.ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(resp.Choices[0].Message.ToolCalls))
	}
	tc := resp.Choices[0].Message.ToolCalls[0]
	if tc.ID != "call_abc" {
		t.Errorf("unexpected tool call ID: %q", tc.ID)
	}
	if tc.Function.Name != "search" {
		t.Errorf("unexpected tool name: %q", tc.Function.Name)
	}
	if tc.Function.Arguments != `{"q":"foo"}` {
		t.Errorf("unexpected tool arguments: %q", tc.Function.Arguments)
	}
	if resp.Choices[0].FinishReason != "tool_calls" {
		t.Errorf("unexpected finish reason: %q", resp.Choices[0].FinishReason)
	}
}

func TestLLMClient_ChatCompletion_MalformedChunk(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "data: {not valid json}\n\n")
	}))
	defer server.Close()

	client := NewLLMClient(log.DefaultLogger, &http.Client{Timeout: llmTimeout})
	_, err := client.ChatCompletion(context.Background(), ChatCompletionRequest{
		Messages: []Message{{Role: "user", Content: "hi"}},
	}, server.URL, "token", "1")

	if err == nil {
		t.Fatal("expected error for malformed SSE chunk")
	}
}

func TestLLMClient_ChatCompletion_ErrorBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		fmt.Fprintf(w, `{"error":"rate limit exceeded"}`)
	}))
	defer server.Close()

	client := NewLLMClient(log.DefaultLogger, &http.Client{Timeout: llmTimeout})
	_, err := client.ChatCompletion(context.Background(), ChatCompletionRequest{
		Messages: []Message{{Role: "user", Content: "hi"}},
	}, server.URL, "token", "1")

	if err == nil {
		t.Fatal("expected error for 429 response")
	}
}
