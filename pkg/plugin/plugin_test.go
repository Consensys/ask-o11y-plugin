package plugin

import (
	"consensys-asko11y-app/pkg/agent"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestBuiltInMCPBaseURL(t *testing.T) {
	// Save and restore env vars
	origOverride := os.Getenv("GF_PLUGIN_ASKO11Y_BUILTIN_MCP_BASE_URL")
	origPort := os.Getenv("GF_SERVER_HTTP_PORT")
	defer func() {
		os.Setenv("GF_PLUGIN_ASKO11Y_BUILTIN_MCP_BASE_URL", origOverride)
		os.Setenv("GF_SERVER_HTTP_PORT", origPort)
	}()

	t.Run("default returns localhost:3000", func(t *testing.T) {
		os.Unsetenv("GF_PLUGIN_ASKO11Y_BUILTIN_MCP_BASE_URL")
		os.Unsetenv("GF_SERVER_HTTP_PORT")
		got := builtInMCPBaseURL()
		if got != "http://localhost:3000" {
			t.Errorf("builtInMCPBaseURL() = %q, want %q", got, "http://localhost:3000")
		}
	})

	t.Run("respects GF_SERVER_HTTP_PORT", func(t *testing.T) {
		os.Unsetenv("GF_PLUGIN_ASKO11Y_BUILTIN_MCP_BASE_URL")
		os.Setenv("GF_SERVER_HTTP_PORT", "8080")
		got := builtInMCPBaseURL()
		if got != "http://localhost:8080" {
			t.Errorf("builtInMCPBaseURL() = %q, want %q", got, "http://localhost:8080")
		}
	})

	t.Run("override takes precedence", func(t *testing.T) {
		os.Setenv("GF_PLUGIN_ASKO11Y_BUILTIN_MCP_BASE_URL", "http://grafana.svc:3000")
		os.Setenv("GF_SERVER_HTTP_PORT", "8080")
		got := builtInMCPBaseURL()
		if got != "http://grafana.svc:3000" {
			t.Errorf("builtInMCPBaseURL() = %q, want %q", got, "http://grafana.svc:3000")
		}
	})

	t.Run("override strips trailing slash", func(t *testing.T) {
		os.Setenv("GF_PLUGIN_ASKO11Y_BUILTIN_MCP_BASE_URL", "http://grafana.svc:3000/")
		got := builtInMCPBaseURL()
		if got != "http://grafana.svc:3000" {
			t.Errorf("builtInMCPBaseURL() = %q, want %q", got, "http://grafana.svc:3000")
		}
	})
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
