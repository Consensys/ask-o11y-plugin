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
	"testing"

	"consensys-asko11y-app/pkg/mcp"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// TestAgentLoop_LoadSkillAndRunStarted covers the skills plumbing in the
// loop: run_started is emitted first (carrying active-skill metadata), the
// load_skill tool is advertised to the LLM, internal dispatch bypasses the
// MCP proxy and approvals, and loaded instructions are appended to the
// conversation as a tool result without an evidence event.
func TestAgentLoop_LoadSkillAndRunStarted(t *testing.T) {
	var mu sync.Mutex
	var firstCallTools []OpenAITool
	var secondCallMessages []Message
	callIdx := 0

	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req ChatCompletionRequest
		if err := json.Unmarshal(body, &req); err != nil {
			t.Errorf("failed to decode LLM request: %v", err)
		}
		mu.Lock()
		callIdx++
		if callIdx == 1 {
			firstCallTools = req.Tools
			respondAsStream(w, ChatCompletionResponse{
				ID: "1",
				Choices: []Choice{{
					Message: Message{
						Role: "assistant",
						ToolCalls: []ToolCall{{
							ID:   "call-1",
							Type: "function",
							Function: FunctionCall{
								Name:      loadSkillToolName,
								Arguments: `{"skill":"writing-promql-and-logql","file":"references/logql.md"}`,
							},
						}},
					},
					FinishReason: "tool_calls",
				}},
			})
		} else {
			secondCallMessages = req.Messages
			respondAsStream(w, ChatCompletionResponse{
				ID: "2",
				Choices: []Choice{{
					Message:      Message{Role: "assistant", Content: "Here is the LogQL guide."},
					FinishReason: "stop",
				}},
			})
		}
		mu.Unlock()
	}))
	defer llmServer.Close()

	loop := &AgentLoop{
		llmClient: NewLLMClient(log.DefaultLogger, llmServer.Client()),
		mcpProxy:  mcp.NewProxy(context.Background(), log.DefaultLogger),
		logger:    log.DefaultLogger,
	}

	eventCh := make(chan SSEEvent, 32)
	req := LoopRequest{
		Messages:     []Message{{Role: "user", Content: "how do I write logql"}},
		SystemPrompt: "You are helpful.",
		GrafanaURL:   llmServer.URL,
		AuthToken:    "test-token",
		UserRole:     "Admin",
		OrgID:        "1",
		RunID:        "run-42",
		SessionID:    "sess-7",
		ActiveSkillsEvent: []RunStartedSkill{
			{Name: "investigating-alerts", Description: "Investigates firing alerts."},
		},
		AvailableSkills: []SkillSpec{
			{Name: "writing-promql-and-logql", Description: "Writes PromQL and LogQL."},
		},
		LoadSkill: func(ctx context.Context, skill, file string) (string, error) {
			if skill != "writing-promql-and-logql" {
				return "", fmt.Errorf("unexpected skill %q", skill)
			}
			if file != "references/logql.md" {
				return "", fmt.Errorf("unexpected file %q", file)
			}
			return "LOGQL REFERENCE CONTENT", nil
		},
	}

	go loop.Run(context.Background(), req, eventCh)
	events := collectEvents(eventCh)

	if len(events) == 0 || events[0].Type != "run_started" {
		t.Fatalf("run_started must be the first event, got: %v", eventTypes(events))
	}
	started, ok := events[0].Data.(RunStartedEvent)
	if !ok {
		t.Fatalf("run_started data type: %T", events[0].Data)
	}
	if started.RunID != "run-42" || started.SessionID != "sess-7" {
		t.Errorf("run_started ids: %+v", started)
	}
	if len(started.Skills) != 1 || started.Skills[0].Name != "investigating-alerts" {
		t.Errorf("run_started skills: %+v", started.Skills)
	}

	var result ToolCallResultEvent
	sawResult := false
	for _, e := range events {
		if e.Type == "evidence" {
			t.Error("load_skill must not emit evidence events")
		}
		if e.Type == "tool_call_result" {
			sawResult = true
			result = e.Data.(ToolCallResultEvent)
		}
	}
	if !sawResult {
		t.Fatalf("expected a tool_call_result event, got: %v", eventTypes(events))
	}
	if result.IsError || result.Content != "LOGQL REFERENCE CONTENT" {
		t.Errorf("load_skill result: isError=%v content=%.40s", result.IsError, result.Content)
	}

	mu.Lock()
	defer mu.Unlock()
	foundLoadSkill := false
	for _, tool := range firstCallTools {
		if tool.Function.Name == loadSkillToolName {
			foundLoadSkill = true
			if !strings.Contains(tool.Function.Description, "writing-promql-and-logql") {
				t.Errorf("load_skill description must name the catalog: %s", tool.Function.Description)
			}
		}
	}
	if !foundLoadSkill {
		t.Fatal("load_skill tool was not advertised to the LLM")
	}

	hasToolResult := false
	for _, m := range secondCallMessages {
		if m.Role == "tool" && m.ToolCallID == "call-1" && strings.Contains(m.Content, "LOGQL REFERENCE CONTENT") {
			hasToolResult = true
		}
	}
	if !hasToolResult {
		t.Fatalf("loaded skill content not appended to the conversation: %+v", secondCallMessages)
	}
}

func TestAgentLoop_LoadSkillErrorSurfacesAsToolError(t *testing.T) {
	responses := []ChatCompletionResponse{
		{
			ID: "1",
			Choices: []Choice{{
				Message: Message{
					Role: "assistant",
					ToolCalls: []ToolCall{{
						ID:   "call-1",
						Type: "function",
						Function: FunctionCall{
							Name:      loadSkillToolName,
							Arguments: `{"skill":"missing-skill"}`,
						},
					}},
				},
				FinishReason: "tool_calls",
			}},
		},
		{
			ID: "2",
			Choices: []Choice{{
				Message:      Message{Role: "assistant", Content: "That skill does not exist."},
				FinishReason: "stop",
			}},
		},
	}

	loop, serverURL, cleanup := setupTestLoop(t, responses)
	defer cleanup()

	eventCh := make(chan SSEEvent, 32)
	req := LoopRequest{
		Messages:     []Message{{Role: "user", Content: "load a skill"}},
		SystemPrompt: "You are helpful.",
		GrafanaURL:   serverURL,
		AuthToken:    "token",
		UserRole:     "Admin",
		OrgID:        "1",
		AvailableSkills: []SkillSpec{
			{Name: "some-skill", Description: "Does things."},
		},
		LoadSkill: func(ctx context.Context, skill, file string) (string, error) {
			return "", fmt.Errorf("unknown skill: %s", skill)
		},
	}

	go loop.Run(context.Background(), req, eventCh)
	events := collectEvents(eventCh)

	for _, e := range events {
		if e.Type == "tool_call_result" {
			result := e.Data.(ToolCallResultEvent)
			if !result.IsError || !strings.Contains(result.Content, "unknown skill") {
				t.Errorf("expected error result, got: %+v", result)
			}
			return
		}
	}
	t.Fatalf("no tool_call_result event: %v", eventTypes(events))
}

func eventTypes(events []SSEEvent) []string {
	types := make([]string, 0, len(events))
	for _, e := range events {
		types = append(types, e.Type)
	}
	return types
}
