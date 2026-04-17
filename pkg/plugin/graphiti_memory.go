package plugin

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"consensys-asko11y-app/pkg/agent"
	"consensys-asko11y-app/pkg/mcp"
)

const (
	graphitiMaxEpisodeChars = 12_000
	graphitiMaxMessageChars = 1_200
	graphitiMaxSessionTurns = 12
	graphitiDiscoverySample = 12
	graphitiTruncatedSuffix = " [...truncated]"
)

// graphitiWriteToolNames are hidden from LLM sessions. Regular chat and
// discovery use read/search tools only, while Go performs graph writes itself.
var graphitiWriteToolNames = []string{
	"graphiti_add_memory",
	"graphiti_delete_entity_edge",
	"graphiti_delete_episode",
	"graphiti_clear_graph",
}

func hasGraphitiMemoryTool(tools []mcp.Tool) bool {
	for _, t := range tools {
		if t.Name == "graphiti_add_memory" {
			return true
		}
	}
	return false
}

func collectDiscoverySynthesis(eventCh <-chan agent.SSEEvent, onEvent func(agent.SSEEvent)) (agent.SSEEvent, string) {
	var (
		lastEvent   agent.SSEEvent
		contentBuf  strings.Builder
		toolResults []agent.ToolCallResultEvent
	)

	for event := range eventCh {
		if onEvent != nil {
			onEvent(event)
		}
		lastEvent = event

		switch event.Type {
		case "content":
			contentEvent, ok := event.Data.(agent.ContentEvent)
			if !ok || strings.TrimSpace(contentEvent.Content) == "" {
				continue
			}
			contentBuf.WriteString(contentEvent.Content)
		case "tool_call_result":
			toolResult, ok := event.Data.(agent.ToolCallResultEvent)
			if ok && !toolResult.IsError {
				toolResults = append(toolResults, toolResult)
			}
		}
	}

	synthesis := trimGraphitiBody(contentBuf.String(), graphitiMaxEpisodeChars)
	if synthesis == "" {
		synthesis = synthesizeDiscoveryFromToolResults(toolResults)
	}

	return lastEvent, synthesis
}

func buildSessionMemoryBody(messages []ingestSessionMessage) (string, int) {
	start := 0
	if len(messages) > graphitiMaxSessionTurns {
		start = len(messages) - graphitiMaxSessionTurns
	}

	lines := make([]string, 0, len(messages[start:]))
	count := 0

	for _, msg := range messages[start:] {
		content := compactGraphitiLine(msg.Content, graphitiMaxMessageChars)
		if content == "" {
			continue
		}

		role := strings.ToUpper(strings.TrimSpace(msg.Role))
		if role == "" {
			role = "USER"
		}

		lines = append(lines, fmt.Sprintf("%s: %s", role, content))
		count++
	}

	return trimGraphitiBody(strings.Join(lines, "\n"), graphitiMaxEpisodeChars), count
}

func ingestGraphitiMemory(proxy *mcp.Proxy, orgID int64, name, body, source, sourceDescription string) error {
	body = trimGraphitiBody(body, graphitiMaxEpisodeChars)
	if body == "" {
		return nil
	}

	result, err := proxy.CallTool("graphiti_add_memory", map[string]interface{}{
		"name":               name,
		"group_id":           orgGroupID(orgID),
		"episode_body":       body,
		"source":             source,
		"source_description": sourceDescription,
	})
	if err != nil {
		return err
	}
	if result != nil && result.IsError {
		if text := callToolText(result); text != "" {
			return fmt.Errorf("graphiti_add_memory failed: %s", text)
		}
		return fmt.Errorf("graphiti_add_memory failed")
	}
	return nil
}

func compactGraphitiLine(text string, maxChars int) string {
	return trimGraphitiBody(strings.Join(strings.Fields(strings.TrimSpace(text)), " "), maxChars)
}

func trimGraphitiBody(text string, maxChars int) string {
	text = strings.TrimSpace(text)
	if text == "" || maxChars <= 0 {
		return text
	}

	runes := []rune(text)
	if len(runes) <= maxChars {
		return text
	}

	suffix := []rune(graphitiTruncatedSuffix)
	keep := maxChars - len(suffix)
	if keep <= 0 {
		return string(runes[:maxChars])
	}

	return strings.TrimSpace(string(runes[:keep])) + graphitiTruncatedSuffix
}

func callToolText(result *mcp.CallToolResult) string {
	if result == nil {
		return ""
	}

	parts := make([]string, 0, len(result.Content))
	for _, block := range result.Content {
		if block.Text != "" {
			parts = append(parts, block.Text)
		}
	}

	return strings.Join(parts, "\n")
}

type discoveryDatasource struct {
	Name      string `json:"name"`
	Type      string `json:"type"`
	IsDefault bool   `json:"isDefault"`
}

type discoveryDatasourceList struct {
	Datasources []discoveryDatasource `json:"datasources"`
}

func synthesizeDiscoveryFromToolResults(results []agent.ToolCallResultEvent) string {
	if len(results) == 0 {
		return ""
	}

	var (
		datasourceSummaries []string
		metricNames         []string
		labelNames          []string
	)

	for _, result := range results {
		switch result.Name {
		case "mcp-grafana_list_datasources":
			datasourceSummaries = append(datasourceSummaries, parseDiscoveryDatasources(result.Content)...)
		case "mcp-grafana_list_prometheus_metric_names":
			metricNames = append(metricNames, parseJSONStringArray(result.Content)...)
		case "mcp-grafana_list_prometheus_label_names":
			labelNames = append(labelNames, parseJSONStringArray(result.Content)...)
		}
	}

	datasourceSummaries = uniqueStrings(datasourceSummaries)
	metricNames = uniqueStrings(metricNames)
	labelNames = uniqueStrings(labelNames)

	lines := make([]string, 0, 6)
	if len(datasourceSummaries) > 0 {
		lines = append(lines, "Observed Grafana datasources: "+strings.Join(datasourceSummaries, ", ")+".")
	}
	if len(metricNames) > 0 {
		lines = append(lines, "Prometheus metric sample: "+strings.Join(metricNames[:min(len(metricNames), graphitiDiscoverySample)], ", ")+".")
	}
	if len(labelNames) > 0 {
		lines = append(lines, "Prometheus label sample: "+strings.Join(labelNames[:min(len(labelNames), graphitiDiscoverySample)], ", ")+".")
	}
	lines = append(lines, discoveryHintLines(datasourceSummaries, labelNames)...)

	return trimGraphitiBody(strings.Join(lines, "\n"), graphitiMaxEpisodeChars)
}

func parseDiscoveryDatasources(content string) []string {
	var payload discoveryDatasourceList
	if err := json.Unmarshal([]byte(content), &payload); err != nil {
		return nil
	}

	out := make([]string, 0, len(payload.Datasources))
	for _, ds := range payload.Datasources {
		name := compactGraphitiLine(ds.Name, 128)
		if name == "" {
			continue
		}

		typeName := compactGraphitiLine(ds.Type, 64)
		switch {
		case ds.IsDefault && typeName != "":
			out = append(out, fmt.Sprintf("%s (%s, default)", name, typeName))
		case ds.IsDefault:
			out = append(out, name+" (default)")
		case typeName != "":
			out = append(out, fmt.Sprintf("%s (%s)", name, typeName))
		default:
			out = append(out, name)
		}
	}

	return out
}

func parseJSONStringArray(content string) []string {
	var values []string
	if err := json.Unmarshal([]byte(content), &values); err != nil {
		return nil
	}

	out := make([]string, 0, len(values))
	for _, value := range values {
		compacted := compactGraphitiLine(value, 96)
		if compacted != "" {
			out = append(out, compacted)
		}
	}
	return out
}

func discoveryHintLines(datasources, labelNames []string) []string {
	var hints []string

	labelSet := make(map[string]struct{}, len(labelNames))
	for _, label := range labelNames {
		labelSet[strings.ToLower(label)] = struct{}{}
	}

	hasLabel := func(names ...string) bool {
		for _, name := range names {
			if _, ok := labelSet[strings.ToLower(name)]; ok {
				return true
			}
		}
		return false
	}

	if hasLabel("cluster", "cluster_name", "k8s_cluster_name") {
		hints = append(hints, "Kubernetes cluster telemetry is present.")
	}
	if hasLabel("namespace", "kubernetes_namespace", "exported_namespace") {
		hints = append(hints, "Namespace-level telemetry is present.")
	}
	if hasLabel("pod", "pod_name") {
		hints = append(hints, "Pod-level telemetry is present.")
	}
	if hasLabel("deployment", "deployment_name", "statefulset", "daemonset", "job", "cronjob") {
		hints = append(hints, "Workload telemetry includes deployments or scheduled jobs.")
	}
	if hasLabel("service", "service_name", "app", "app_kubernetes_io_name", "job", "instance") {
		hints = append(hints, "Service-level or instance-level telemetry is present.")
	}

	for _, ds := range datasources {
		lower := strings.ToLower(ds)
		switch {
		case strings.Contains(lower, "tempo"):
			hints = append(hints, "Distributed tracing is available through Tempo.")
		case strings.Contains(lower, "prometheus"):
			hints = append(hints, "Metrics are available through Prometheus.")
		}
	}

	return uniqueStrings(hints)
}

func uniqueStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}

	slices.Sort(out)
	return out
}
