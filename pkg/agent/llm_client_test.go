package agent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestLLMClient_ChatCompletion(t *testing.T) {
	wantResponse := ChatCompletionResponse{
		ID: "test-id",
		Choices: []Choice{
			{
				Index: 0,
				Message: Message{
					Role:    "assistant",
					Content: "Hello from the LLM!",
				},
				FinishReason: "stop",
			},
		},
	}

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

		// Verify request body
		var req ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("failed to decode request: %v", err)
		}
		if req.Model != "large" {
			t.Errorf("expected model 'large', got %q", req.Model)
		}
		if len(req.Messages) != 1 {
			t.Errorf("expected 1 message, got %d", len(req.Messages))
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(wantResponse)
	}))
	defer server.Close()

	client := NewLLMClient(log.DefaultLogger)

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
	wantResponse := ChatCompletionResponse{
		ID: "test-id",
		Choices: []Choice{{
			Message:      Message{Role: "assistant", Content: "ok"},
			FinishReason: "stop",
		}},
	}

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

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(wantResponse)
	}))
	defer server.Close()

	client := NewLLMClient(log.DefaultLogger)
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

	client := NewLLMClient(log.DefaultLogger)
	_, err := client.ChatCompletion(context.Background(), ChatCompletionRequest{
		Messages: []Message{{Role: "user", Content: "hi"}},
	}, server.URL, "", "1")

	if err == nil {
		t.Fatal("expected error for 500 response")
	}
}

func TestLLMClient_ChatCompletion_NoChoices(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(ChatCompletionResponse{ID: "test", Choices: []Choice{}})
	}))
	defer server.Close()

	client := NewLLMClient(log.DefaultLogger)
	_, err := client.ChatCompletion(context.Background(), ChatCompletionRequest{
		Messages: []Message{{Role: "user", Content: "hi"}},
	}, server.URL, "", "1")

	if err == nil {
		t.Fatal("expected error for empty choices")
	}
}

func TestLLMClient_ChatCompletion_ContextCancelled(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Slow response — but context will be cancelled
		<-r.Context().Done()
	}))
	defer server.Close()

	client := NewLLMClient(log.DefaultLogger)
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	_, err := client.ChatCompletion(ctx, ChatCompletionRequest{
		Messages: []Message{{Role: "user", Content: "hi"}},
	}, server.URL, "", "1")

	if err == nil {
		t.Fatal("expected error for cancelled context")
	}
}
