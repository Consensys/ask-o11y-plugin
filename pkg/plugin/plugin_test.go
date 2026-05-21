package plugin

import (
	"consensys-asko11y-app/pkg/agent"
	"consensys-asko11y-app/pkg/mcp"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func newAgentRunTestPlugin(t *testing.T) *Plugin {
	t.Helper()

	logger := log.DefaultLogger
	proxy := mcp.NewProxy(context.Background(), logger)
	llmClient := agent.NewLLMClient(logger, http.DefaultClient)
	promptRegistry, err := NewPromptRegistry(PluginSettings{})
	if err != nil {
		t.Fatalf("NewPromptRegistry failed: %v", err)
	}

	return &Plugin{
		logger:         logger,
		mcpProxy:       proxy,
		agentLoop:      agent.NewAgentLoop(llmClient, proxy, logger),
		runStore:       NewRunStore(logger),
		sessionStore:   NewSessionStore(logger),
		promptRegistry: promptRegistry,
		settings: PluginSettings{
			MaxTotalTokens:     agent.DefaultMaxTotalTokens,
			RecentMessageCount: 10,
		},
		runCancels: make(map[string]context.CancelFunc),
		dsCache:    make(map[string]dsCacheEntry),
	}
}

func newAgentRunRequest(t *testing.T, grafanaURL, targetURL, body string) *http.Request {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, targetURL, strings.NewReader(body))
	req.Header.Set("X-Grafana-Org-Id", "2")
	req.Header.Set("X-Grafana-User-Id", "7")
	req.Header.Set("X-Grafana-User-Role", "Admin")
	cfg := backend.NewGrafanaCfg(map[string]string{
		"GF_APP_URL":                  grafanaURL,
		"GF_PLUGIN_APP_CLIENT_SECRET": "test-token",
	})
	return req.WithContext(backend.WithGrafanaConfig(req.Context(), cfg))
}

func newAgentRunLLMServer(t *testing.T) (*httptest.Server, <-chan agent.ChatCompletionRequest) {
	t.Helper()

	received := make(chan agent.ChatCompletionRequest, 4)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/plugins/grafana-llm-app/resources/openai/v1/chat/completions" {
			t.Errorf("unexpected LLM path %q", r.URL.Path)
		}
		var req agent.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Errorf("failed to decode LLM request: %v", err)
		}
		received <- req

		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"id\":\"run\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"ok\"},\"finish_reason\":null}]}\n\n")
		fmt.Fprint(w, "data: {\"id\":\"run\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))

	return server, received
}

func receiveAgentRunLLMRequest(t *testing.T, ch <-chan agent.ChatCompletionRequest) agent.ChatCompletionRequest {
	t.Helper()
	select {
	case req := <-ch:
		return req
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for LLM request")
		return agent.ChatCompletionRequest{}
	}
}

func TestBuiltInMCPBaseURL(t *testing.T) {
	t.Run("default returns localhost:3000", func(t *testing.T) {
		got := builtInMCPBaseURL(PluginSettings{})
		if got != "http://localhost:3000" {
			t.Errorf("builtInMCPBaseURL() = %q, want %q", got, "http://localhost:3000")
		}
	})

	t.Run("respects setting", func(t *testing.T) {
		got := builtInMCPBaseURL(PluginSettings{BuiltInMCPBaseURL: "http://grafana.svc:3000"})
		if got != "http://grafana.svc:3000" {
			t.Errorf("builtInMCPBaseURL() = %q, want %q", got, "http://grafana.svc:3000")
		}
	})

	t.Run("strips trailing slash", func(t *testing.T) {
		got := builtInMCPBaseURL(PluginSettings{BuiltInMCPBaseURL: "http://grafana.svc:3000/"})
		if got != "http://grafana.svc:3000" {
			t.Errorf("builtInMCPBaseURL() = %q, want %q", got, "http://grafana.svc:3000")
		}
	})
}

func TestResolveGrafanaURL(t *testing.T) {
	t.Run("uses AppURL from GrafanaCfg when available", func(t *testing.T) {
		cfg := backend.NewGrafanaCfg(map[string]string{
			"GF_APP_URL": "https://mystack.grafana.net/",
		})
		url, source := resolveGrafanaURL(PluginSettings{}, cfg)
		if url != "https://mystack.grafana.net" {
			t.Errorf("url = %q, want %q", url, "https://mystack.grafana.net")
		}
		if source != "GrafanaConfig.AppURL" {
			t.Errorf("source = %q, want %q", source, "GrafanaConfig.AppURL")
		}
	})

	t.Run("falls back to builtInMCPBaseURL when AppURL is empty", func(t *testing.T) {
		cfg := backend.NewGrafanaCfg(map[string]string{})
		url, source := resolveGrafanaURL(PluginSettings{BuiltInMCPBaseURL: "http://grafana.svc:3000"}, cfg)
		if url != "http://grafana.svc:3000" {
			t.Errorf("url = %q, want %q", url, "http://grafana.svc:3000")
		}
		if source != "config-fallback" {
			t.Errorf("source = %q, want %q", source, "config-fallback")
		}
	})

	t.Run("falls back to localhost when cfg is nil", func(t *testing.T) {
		url, source := resolveGrafanaURL(PluginSettings{}, nil)
		if url != "http://localhost:3000" {
			t.Errorf("url = %q, want %q", url, "http://localhost:3000")
		}
		if source != "config-fallback" {
			t.Errorf("source = %q, want %q", source, "config-fallback")
		}
	})

	t.Run("AppURL takes precedence over builtInMCPBaseURL setting", func(t *testing.T) {
		cfg := backend.NewGrafanaCfg(map[string]string{
			"GF_APP_URL": "https://cloud.grafana.net",
		})
		url, _ := resolveGrafanaURL(PluginSettings{BuiltInMCPBaseURL: "http://localhost:3000"}, cfg)
		if url != "https://cloud.grafana.net" {
			t.Errorf("url = %q, want %q", url, "https://cloud.grafana.net")
		}
	})
}

func TestHandleAgentRunRejectsInvalidModel(t *testing.T) {
	p := &Plugin{logger: log.DefaultLogger}
	req := httptest.NewRequest(http.MethodPost, "/api/agent/run?model=opus", strings.NewReader(`{"message":"hello"}`))
	rec := httptest.NewRecorder()

	p.handleAgentRun(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestHandleAgentRunPersistsNewSessionModel(t *testing.T) {
	llmServer, received := newAgentRunLLMServer(t)
	defer llmServer.Close()

	p := newAgentRunTestPlugin(t)
	req := newAgentRunRequest(t, llmServer.URL, "/api/agent/run?model=base", `{"message":"hello","type":"chat"}`)
	rec := httptest.NewRecorder()

	p.handleAgentRun(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var body struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	session, err := p.sessionStore.GetSession(body.SessionID, 7, 2)
	if err != nil {
		t.Fatalf("GetSession failed: %v", err)
	}
	if session.Model != "base" {
		t.Fatalf("expected session model base, got %q", session.Model)
	}
	if got := receiveAgentRunLLMRequest(t, received); got.Model != "base" {
		t.Fatalf("expected LLM model base, got %q", got.Model)
	}
}

func TestHandleAgentRunUsesStoredSessionModelWhenQueryOmitted(t *testing.T) {
	llmServer, received := newAgentRunLLMServer(t)
	defer llmServer.Close()

	p := newAgentRunTestPlugin(t)
	session, err := p.sessionStore.CreateSession(7, 2, "existing", []SessionMessage{{Role: "user", Content: "previous"}})
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}
	model := "large"
	if err := p.sessionStore.UpdateSession(session.ID, 7, 2, SessionUpdate{Model: &model}); err != nil {
		t.Fatalf("UpdateSession failed: %v", err)
	}

	req := newAgentRunRequest(t, llmServer.URL, "/api/agent/run", fmt.Sprintf(`{"message":"follow up","sessionId":%q}`, session.ID))
	rec := httptest.NewRecorder()

	p.handleAgentRun(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if got := receiveAgentRunLLMRequest(t, received); got.Model != "large" {
		t.Fatalf("expected LLM model large, got %q", got.Model)
	}
}

func TestHandleAgentRunRejectsConflictingSessionModel(t *testing.T) {
	p := newAgentRunTestPlugin(t)
	session, err := p.sessionStore.CreateSession(7, 2, "existing", []SessionMessage{{Role: "user", Content: "previous"}})
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}
	model := "base"
	if err := p.sessionStore.UpdateSession(session.ID, 7, 2, SessionUpdate{Model: &model}); err != nil {
		t.Fatalf("UpdateSession failed: %v", err)
	}

	req := newAgentRunRequest(t, "http://grafana.test", "/api/agent/run?model=large", fmt.Sprintf(`{"message":"follow up","sessionId":%q}`, session.ID))
	rec := httptest.NewRecorder()

	p.handleAgentRun(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestReconstructAssistantMessage(t *testing.T) {
	t.Run("merges tool_call_start and tool_call_result by ID", func(t *testing.T) {
		events := []agent.SSEEvent{
			{Type: "tool_call_start", Data: agent.ToolCallStartEvent{ID: "tc1", Name: "query_prometheus", Arguments: `{"expr":"up"}`}},
			{Type: "tool_call_result", Data: agent.ToolCallResultEvent{ID: "tc1", Name: "query_prometheus", Content: "result data"}},
			{Type: "content", Data: agent.ContentEvent{Content: "Here are the results."}},
		}

		msg := reconstructAssistantMessage(events)

		if msg.Content != "Here are the results." {
			t.Errorf("content = %q, want %q", msg.Content, "Here are the results.")
		}

		var toolCalls []map[string]interface{}
		if err := json.Unmarshal(msg.ToolCalls, &toolCalls); err != nil {
			t.Fatalf("failed to unmarshal toolCalls: %v", err)
		}

		if len(toolCalls) != 1 {
			t.Fatalf("expected 1 tool call, got %d", len(toolCalls))
		}

		tc := toolCalls[0]
		if tc["name"] != "query_prometheus" {
			t.Errorf("name = %v, want %q", tc["name"], "query_prometheus")
		}
		if tc["running"] != false {
			t.Errorf("running = %v, want false", tc["running"])
		}
		if tc["arguments"] != `{"expr":"up"}` {
			t.Errorf("arguments = %v, want %q", tc["arguments"], `{"expr":"up"}`)
		}
		resp, ok := tc["response"].(map[string]interface{})
		if !ok {
			t.Fatalf("response missing or not a map")
		}
		contentArr, ok := resp["content"].([]interface{})
		if !ok || len(contentArr) == 0 {
			t.Fatalf("response.content missing")
		}
		block, ok := contentArr[0].(map[string]interface{})
		if !ok || block["text"] != "result data" {
			t.Errorf("response content text = %v, want %q", block["text"], "result data")
		}
	})

	t.Run("multiple tool calls maintain order", func(t *testing.T) {
		events := []agent.SSEEvent{
			{Type: "tool_call_start", Data: agent.ToolCallStartEvent{ID: "a", Name: "tool_a", Arguments: "{}"}},
			{Type: "tool_call_start", Data: agent.ToolCallStartEvent{ID: "b", Name: "tool_b", Arguments: "{}"}},
			{Type: "tool_call_result", Data: agent.ToolCallResultEvent{ID: "b", Name: "tool_b", Content: "b result"}},
			{Type: "tool_call_result", Data: agent.ToolCallResultEvent{ID: "a", Name: "tool_a", Content: "a result"}},
		}

		msg := reconstructAssistantMessage(events)
		var toolCalls []map[string]interface{}
		if err := json.Unmarshal(msg.ToolCalls, &toolCalls); err != nil {
			t.Fatalf("failed to unmarshal toolCalls: %v", err)
		}

		if len(toolCalls) != 2 {
			t.Fatalf("expected 2 tool calls, got %d", len(toolCalls))
		}
		if toolCalls[0]["name"] != "tool_a" {
			t.Errorf("first tool = %v, want tool_a", toolCalls[0]["name"])
		}
		if toolCalls[1]["name"] != "tool_b" {
			t.Errorf("second tool = %v, want tool_b", toolCalls[1]["name"])
		}
	})

	t.Run("error tool call result", func(t *testing.T) {
		events := []agent.SSEEvent{
			{Type: "tool_call_start", Data: agent.ToolCallStartEvent{ID: "e1", Name: "bad_tool", Arguments: "{}"}},
			{Type: "tool_call_result", Data: agent.ToolCallResultEvent{ID: "e1", Name: "bad_tool", Content: "something failed", IsError: true}},
		}

		msg := reconstructAssistantMessage(events)
		var toolCalls []map[string]interface{}
		if err := json.Unmarshal(msg.ToolCalls, &toolCalls); err != nil {
			t.Fatalf("failed to unmarshal toolCalls: %v", err)
		}

		if len(toolCalls) != 1 {
			t.Fatalf("expected 1 tool call, got %d", len(toolCalls))
		}
		if toolCalls[0]["error"] != "something failed" {
			t.Errorf("error = %v, want %q", toolCalls[0]["error"], "something failed")
		}
		if toolCalls[0]["response"] != nil {
			t.Errorf("response should be nil for error tool call")
		}
	})
}

func TestHandlePromptDefaults(t *testing.T) {
	p := &Plugin{logger: log.DefaultLogger}

	t.Run("GET returns all three defaults", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/prompt-defaults", nil)
		rec := httptest.NewRecorder()
		p.handlePromptDefaults(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
		}

		var body map[string]string
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}

		for _, key := range []string{"defaultSystemPrompt", "investigationPrompt", "performancePrompt"} {
			if body[key] == "" {
				t.Errorf("key %q is empty", key)
			}
		}

		if body["defaultSystemPrompt"] != DefaultSystemPrompt {
			t.Error("defaultSystemPrompt does not match Go constant")
		}
		if body["investigationPrompt"] != DefaultInvestigationPrompt {
			t.Error("investigationPrompt does not match Go constant")
		}
		if body["performancePrompt"] != DefaultPerformancePrompt {
			t.Error("performancePrompt does not match Go constant")
		}
	})

	t.Run("POST returns 405", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/prompt-defaults", nil)
		rec := httptest.NewRecorder()
		p.handlePromptDefaults(rec, req)

		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
		}
	})
}
