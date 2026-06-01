package plugin

import (
	"consensys-asko11y-app/pkg/mcp"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

type TopologyNode struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Type  string `json:"type"`
}

type TopologyEdge struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Target string `json:"target"`
	Label  string `json:"label,omitempty"`
}

type AgentTopologyResponse struct {
	Enabled      bool           `json:"enabled"`
	Source       string         `json:"source"`
	Nodes        []TopologyNode `json:"nodes"`
	Edges        []TopologyEdge `json:"edges"`
	RawFactCount int            `json:"rawFactCount,omitempty"`
	Warnings     []string       `json:"warnings,omitempty"`
}

const (
	defaultTopologyMaxNodes = 100
	defaultTopologyMaxEdges = 200
	hardTopologyMaxNodes    = 500
	hardTopologyMaxEdges    = 1000
)

type topologyBuilder struct {
	nodes map[string]TopologyNode
	edges map[string]TopologyEdge
}

var (
	arrowEdgeRe         = regexp.MustCompile(`(?i)\b([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\s*(?:->|-->)\s*([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\b`)
	serviceActionEdgeRe = regexp.MustCompile(`(?i)\b([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\s+(?:service|app|application|job|workload)\s+(?:calls|uses|queries|depends on|connects to|talks to|sends to)\s+([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\b`)
	callsEdgeRe         = regexp.MustCompile(`(?i)\b([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\s+(?:calls|uses|queries|depends on|connects to|talks to|sends to|forwards requests to)\s+([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\b`)
	calledByRe          = regexp.MustCompile(`(?i)\b([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\s+(?:is called by|receives from|is used by)\s+([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\b`)
	deployedInRe        = regexp.MustCompile(`(?i)\b([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\s+(?:service|app|application|job|workload)\s+is deployed in\s+([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\s+namespace\b`)
	runsOnRe            = regexp.MustCompile(`(?i)\b([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\s+(?:service|app|application|job|workload)\s+runs on\s+([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\s+cluster\b`)
	publishesToQueueRe  = regexp.MustCompile(`(?i)\b([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\s+(?:service|app|application|job|workload)\s+publishes .* to\s+([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\s+(?:message queue|queue)\b`)
	consumesFromQueueRe = regexp.MustCompile(`(?i)\b([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\s+(?:service|app|application|job|workload)\s+consumes .* from\s+([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\s+(?:message queue|queue)\b`)
	serviceRe           = regexp.MustCompile(`(?i)\b(?:service|app|application|job|workload)\s+["']?([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})["']?`)
)

var topologyInfraNames = map[string]struct{}{
	"alloy":           {},
	"alertmanager":    {},
	"grafana":         {},
	"ingress-nginx":   {},
	"kube-prometheus": {},
	"loki":            {},
	"mimir":           {},
	"node-exporter":   {},
	"otel-collector":  {},
	"prometheus":      {},
	"pushgateway":     {},
	"tempo":           {},
}

var topologyNoiseNames = map[string]struct{}{
	"calls":     {},
	"deployed":  {},
	"is":        {},
	"publishes": {},
	"for":       {},
	"from":      {},
	"runs":      {},
	"service":   {},
	"to":        {},
	"via":       {},
}

func parseGraphitiTopology(body string) AgentTopologyResponse {
	facts := extractTopologyFacts(body)
	builder := topologyBuilder{
		nodes: make(map[string]TopologyNode),
		edges: make(map[string]TopologyEdge),
	}

	for _, fact := range facts {
		builder.ingestFact(fact)
	}

	nodes := make([]TopologyNode, 0, len(builder.nodes))
	for _, node := range builder.nodes {
		nodes = append(nodes, node)
	}
	sort.Slice(nodes, func(i, j int) bool {
		return nodes[i].Label < nodes[j].Label
	})

	edges := make([]TopologyEdge, 0, len(builder.edges))
	for _, edge := range builder.edges {
		edges = append(edges, edge)
	}
	sort.Slice(edges, func(i, j int) bool {
		return edges[i].ID < edges[j].ID
	})

	return AgentTopologyResponse{
		Enabled:      true,
		Source:       "graphiti",
		Nodes:        nodes,
		Edges:        edges,
		RawFactCount: len(facts),
	}
}

func sanitizeTopologyLimit(value, fallback, hardMax int) int {
	if value <= 0 {
		return fallback
	}
	if value > hardMax {
		return hardMax
	}
	return value
}

func limitTopologyResponse(response AgentTopologyResponse, maxNodes, maxEdges int) AgentTopologyResponse {
	maxNodes = sanitizeTopologyLimit(maxNodes, defaultTopologyMaxNodes, hardTopologyMaxNodes)
	maxEdges = sanitizeTopologyLimit(maxEdges, defaultTopologyMaxEdges, hardTopologyMaxEdges)

	originalNodeCount := len(response.Nodes)
	originalEdgeCount := len(response.Edges)

	if originalNodeCount > maxNodes {
		response.Nodes = response.Nodes[:maxNodes]
		response.Warnings = append(response.Warnings, fmt.Sprintf("Service graph truncated to %d nodes from %d.", maxNodes, originalNodeCount))
	}

	allowedNodes := make(map[string]struct{}, len(response.Nodes))
	for _, node := range response.Nodes {
		allowedNodes[node.ID] = struct{}{}
	}

	filteredEdges := make([]TopologyEdge, 0, len(response.Edges))
	for _, edge := range response.Edges {
		if _, ok := allowedNodes[edge.Source]; !ok {
			continue
		}
		if _, ok := allowedNodes[edge.Target]; !ok {
			continue
		}
		filteredEdges = append(filteredEdges, edge)
	}
	response.Edges = filteredEdges

	if len(response.Edges) > maxEdges {
		response.Edges = response.Edges[:maxEdges]
	}
	if originalEdgeCount > len(response.Edges) {
		response.Warnings = append(response.Warnings, fmt.Sprintf("Service graph truncated to %d edges from %d.", len(response.Edges), originalEdgeCount))
	}

	if response.Nodes == nil {
		response.Nodes = []TopologyNode{}
	}
	if response.Edges == nil {
		response.Edges = []TopologyEdge{}
	}

	return response
}

func extractTopologyFacts(body string) []string {
	body = strings.TrimSpace(body)
	if body == "" {
		return nil
	}

	var payload interface{}
	if err := json.Unmarshal([]byte(body), &payload); err == nil {
		var facts []string
		walkTopologyPayload(payload, &facts)
		if len(facts) > 0 {
			return uniqueStrings(facts)
		}
	}

	lines := strings.FieldsFunc(body, func(r rune) bool {
		return r == '\n' || r == '\r'
	})
	facts := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			facts = append(facts, line)
		}
	}
	return uniqueStrings(facts)
}

func walkTopologyPayload(value interface{}, facts *[]string) {
	switch v := value.(type) {
	case []interface{}:
		for _, item := range v {
			walkTopologyPayload(item, facts)
		}
	case map[string]interface{}:
		if source, sourceOK := stringField(v, "source_node_name", "source", "from"); sourceOK {
			if target, targetOK := stringField(v, "target_node_name", "target", "to"); targetOK {
				*facts = append(*facts, fmt.Sprintf("%s -> %s", source, target))
			}
		}
		for _, key := range []string{"fact", "name", "summary", "content", "text", "episode_body"} {
			if text, ok := v[key].(string); ok && strings.TrimSpace(text) != "" {
				*facts = append(*facts, text)
			}
		}
		for _, item := range v {
			walkTopologyPayload(item, facts)
		}
	}
}

func stringField(m map[string]interface{}, keys ...string) (string, bool) {
	for _, key := range keys {
		if value, ok := m[key].(string); ok && strings.TrimSpace(value) != "" {
			return value, true
		}
	}
	return "", false
}

func (b *topologyBuilder) ingestFact(fact string) {
	matchedStructuredFact := false
	for _, match := range arrowEdgeRe.FindAllStringSubmatch(fact, -1) {
		b.addEdge(match[1], match[2], "depends")
		matchedStructuredFact = true
	}
	for _, match := range serviceActionEdgeRe.FindAllStringSubmatch(fact, -1) {
		b.addEdge(match[1], match[2], "calls")
		matchedStructuredFact = true
	}
	for _, match := range deployedInRe.FindAllStringSubmatch(fact, -1) {
		b.addEdge(match[1], match[2], "deployed in")
		matchedStructuredFact = true
	}
	for _, match := range runsOnRe.FindAllStringSubmatch(fact, -1) {
		b.addEdge(match[1], match[2], "runs on")
		matchedStructuredFact = true
	}
	for _, match := range publishesToQueueRe.FindAllStringSubmatch(fact, -1) {
		b.addEdge(match[1], match[2], "publishes to")
		matchedStructuredFact = true
	}
	for _, match := range consumesFromQueueRe.FindAllStringSubmatch(fact, -1) {
		b.addEdge(match[2], match[1], "consumed by")
		matchedStructuredFact = true
	}

	if !matchedStructuredFact {
		for _, match := range callsEdgeRe.FindAllStringSubmatch(fact, -1) {
			b.addEdge(match[1], match[2], "calls")
		}
		for _, match := range calledByRe.FindAllStringSubmatch(fact, -1) {
			b.addEdge(match[2], match[1], "calls")
		}
	}
	for _, match := range serviceRe.FindAllStringSubmatch(fact, -1) {
		b.addNode(match[1])
	}
}

func (b *topologyBuilder) addEdge(source, target, label string) {
	sourceNode, ok := b.addNode(source)
	if !ok {
		return
	}
	targetNode, ok := b.addNode(target)
	if !ok || sourceNode.ID == targetNode.ID {
		return
	}
	id := sourceNode.ID + "->" + targetNode.ID
	if _, exists := b.edges[id]; exists {
		return
	}
	b.edges[id] = TopologyEdge{
		ID:     id,
		Source: sourceNode.ID,
		Target: targetNode.ID,
		Label:  label,
	}
}

func (b *topologyBuilder) addNode(raw string) (TopologyNode, bool) {
	label := cleanTopologyName(raw)
	if label == "" || isTopologyInfra(label) || isTopologyNoise(label) {
		return TopologyNode{}, false
	}
	id := topologyNodeID(label)
	if node, exists := b.nodes[id]; exists {
		return node, true
	}
	node := TopologyNode{ID: id, Label: label, Type: "service"}
	b.nodes[id] = node
	return node, true
}

func cleanTopologyName(raw string) string {
	name := strings.TrimSpace(raw)
	name = strings.Trim(name, `"'.,;:()[]{}<>`)
	name = strings.TrimPrefix(name, "service/")
	name = strings.TrimPrefix(name, "svc/")
	if len(name) > 80 {
		name = name[:80]
	}
	if strings.Count(name, "/") > 2 {
		return ""
	}
	return name
}

func topologyNodeID(label string) string {
	id := strings.ToLower(label)
	id = strings.ReplaceAll(id, " ", "-")
	replacer := strings.NewReplacer("/", "-", ":", "-", "_", "-", ".", "-")
	id = replacer.Replace(id)
	id = strings.Trim(id, "-")
	return id
}

func isTopologyInfra(label string) bool {
	normalized := strings.ToLower(strings.TrimSpace(label))
	normalized = strings.TrimPrefix(normalized, "service/")
	normalized = strings.TrimPrefix(normalized, "svc/")
	_, found := topologyInfraNames[normalized]
	return found
}

func isTopologyNoise(label string) bool {
	_, found := topologyNoiseNames[strings.ToLower(strings.TrimSpace(label))]
	return found
}

func graphitiToolBody(result *mcp.CallToolResult) string {
	text := callToolText(result)
	if text != "" {
		return text
	}
	if result != nil && result.StructuredContent != nil {
		if data, err := json.Marshal(result.StructuredContent); err == nil {
			return string(data)
		}
	}
	return ""
}

func findGraphitiSearchFactsTool(tools []mcp.Tool) string {
	candidates := []string{
		"graphiti_search_memory_facts",
		"graphiti_graphiti_search_memory_facts",
	}
	for _, candidate := range candidates {
		for _, tool := range tools {
			if tool.Name == candidate {
				return tool.Name
			}
		}
	}
	for _, tool := range tools {
		if strings.HasSuffix(tool.Name, "_search_memory_facts") {
			return tool.Name
		}
	}
	return ""
}

func graphitiSearchFactsArgs(tools []mcp.Tool, toolName string, orgID int64, query string, maxFacts int) map[string]interface{} {
	args := map[string]interface{}{
		"query": query,
	}
	properties := graphitiToolProperties(tools, toolName)
	groupID := orgGroupID(orgID)

	if properties["group_ids"] != nil {
		args["group_ids"] = []string{groupID}
	} else {
		args["group_id"] = groupID
	}
	if properties["max_facts"] != nil && maxFacts > 0 {
		args["max_facts"] = maxFacts
	}

	return args
}

func graphitiToolProperties(tools []mcp.Tool, toolName string) map[string]interface{} {
	for _, tool := range tools {
		if tool.Name != toolName {
			continue
		}
		properties, _ := tool.InputSchema["properties"].(map[string]interface{})
		if properties != nil {
			return properties
		}
	}
	return map[string]interface{}{}
}
