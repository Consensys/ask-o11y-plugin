package plugin

import (
	"strings"
	"testing"

	"consensys-asko11y-app/pkg/agent"
)

func TestBuildSessionMemoryBody_UsesRecentTurnsAndCompactsContent(t *testing.T) {
	messages := []ingestSessionMessage{
		{Role: "user", Content: "older turn"},
	}
	for i := 0; i < graphitiMaxSessionTurns+2; i++ {
		messages = append(messages, ingestSessionMessage{
			Role:    "assistant",
			Content: "line one\nline two",
		})
	}

	body, count := buildSessionMemoryBody(messages)
	if count != graphitiMaxSessionTurns {
		t.Fatalf("count = %d, want %d", count, graphitiMaxSessionTurns)
	}
	if strings.Contains(body, "older turn") {
		t.Fatalf("body should only include recent turns, got %q", body)
	}
	if strings.Contains(body, "\nline two") {
		t.Fatalf("body should compact per-message whitespace, got %q", body)
	}
}

func TestTrimGraphitiBody_TruncatesLongBodies(t *testing.T) {
	input := strings.Repeat("a", graphitiMaxEpisodeChars+100)
	output := trimGraphitiBody(input, graphitiMaxEpisodeChars)

	if len([]rune(output)) > graphitiMaxEpisodeChars {
		t.Fatalf("len(output) = %d, want <= %d", len([]rune(output)), graphitiMaxEpisodeChars)
	}
	if !strings.HasSuffix(output, graphitiTruncatedSuffix) {
		t.Fatalf("expected truncated suffix, got %q", output[len(output)-32:])
	}
}

func TestCollectDiscoverySynthesis_ConcatenatesContentOnly(t *testing.T) {
	eventCh := make(chan agent.SSEEvent, 4)
	eventCh <- agent.SSEEvent{Type: "tool_call_start"}
	eventCh <- agent.SSEEvent{Type: "content", Data: agent.ContentEvent{Content: "part one\n"}}
	eventCh <- agent.SSEEvent{Type: "content", Data: agent.ContentEvent{Content: "part two"}}
	eventCh <- agent.SSEEvent{Type: "done"}
	close(eventCh)

	lastEvent, synthesis := collectDiscoverySynthesis(eventCh, nil)
	if lastEvent.Type != "done" {
		t.Fatalf("lastEvent.Type = %q, want done", lastEvent.Type)
	}
	if synthesis != "part one\npart two" {
		t.Fatalf("synthesis = %q, want %q", synthesis, "part one\npart two")
	}
}

func TestCollectDiscoverySynthesis_FallsBackToToolResults(t *testing.T) {
	eventCh := make(chan agent.SSEEvent, 4)
	eventCh <- agent.SSEEvent{
		Type: "tool_call_result",
		Data: agent.ToolCallResultEvent{
			Name: "mcp-grafana_list_datasources",
			Content: `{"datasources":[` +
				`{"name":"Prometheus","type":"prometheus","isDefault":true},` +
				`{"name":"Tempo","type":"tempo","isDefault":false}` +
				`]}`,
		},
	}
	eventCh <- agent.SSEEvent{
		Type: "tool_call_result",
		Data: agent.ToolCallResultEvent{
			Name:    "mcp-grafana_list_prometheus_label_names",
			Content: `["cluster","namespace","pod","deployment","service"]`,
		},
	}
	eventCh <- agent.SSEEvent{
		Type: "tool_call_result",
		Data: agent.ToolCallResultEvent{
			Name:    "mcp-grafana_list_prometheus_metric_names",
			Content: `["up","container_cpu_usage_seconds_total"]`,
		},
	}
	eventCh <- agent.SSEEvent{Type: "done"}
	close(eventCh)

	_, synthesis := collectDiscoverySynthesis(eventCh, nil)

	for _, want := range []string{
		"Prometheus (prometheus, default)",
		"Tempo (tempo)",
		"Kubernetes cluster telemetry is present.",
		"Namespace-level telemetry is present.",
		"Pod-level telemetry is present.",
		"Service-level or instance-level telemetry is present.",
	} {
		if !strings.Contains(synthesis, want) {
			t.Fatalf("synthesis = %q, want substring %q", synthesis, want)
		}
	}
}
