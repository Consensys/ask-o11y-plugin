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
	// maxTopologyCenterFactLookups caps how many per-node centered fact
	// queries a single topology refresh may issue. This is independent of the
	// display node limit (maxNodes) to avoid a sequential MCP call storm that
	// would exceed gateway timeouts.
	maxTopologyCenterFactLookups = 12
)

type topologyBuilder struct {
	nodes       map[string]TopologyNode
	edges       map[string]TopologyEdge
	uuidToNode  map[string]TopologyNode
	rawFactSeen map[string]struct{}
}

type graphitiTopologyFact struct {
	Name           string
	Fact           string
	SourceNodeUUID string
	TargetNodeUUID string
	SourceNodeName string
	TargetNodeName string
}

type graphitiTopologyNode struct {
	UUID   string
	Name   string
	Labels []string
	Type   string
}

var (
	arrowEdgeRe         = regexp.MustCompile(`(?i)\b([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\s*(?:->|-->)\s*([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\b`)
	serviceActionEdgeRe = regexp.MustCompile(`(?i)\b([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\s+(?:service|app|application|job|workload)\s+(?:calls|uses|queries|depends on|connects to|talks to|sends to)\s+([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\b`)
	callsEdgeRe         = regexp.MustCompile(`(?i)\b([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\s+(?:calls|uses|queries|depends on|connects to|talks to|sends to|forwards requests to)\s+([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\b`)
	calledByRe          = regexp.MustCompile(`(?i)\b([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\s+(?:is called by|receives from|is used by)\s+([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\b`)
	deployedInRe        = regexp.MustCompile(`(?i)\b([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\s+(?:(?:service|app|application|job|workload)\s+)?is deployed in\s+([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\s+namespace\b`)
	runsOnRe            = regexp.MustCompile(`(?i)\b([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\s+(?:(?:service|app|application|job|workload)\s+)?runs on\s+([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\s+cluster\b`)
	emitsSignalRe       = regexp.MustCompile(`(?i)\b([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\s+(?:(?:service|app|application|job|workload)\s+)?emits\s+(?:metric|metrics|trace|traces|log|logs|signal|signals)?\s*signals?\s+to\s+([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\b`)
	publishesToQueueRe  = regexp.MustCompile(`(?i)\b([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\s+(?:service|app|application|job|workload)\s+publishes .* to\s+([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\s+(?:message queue|queue)\b`)
	consumesFromQueueRe = regexp.MustCompile(`(?i)\b([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\s+(?:service|app|application|job|workload)\s+consumes .* from\s+([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})\s+(?:message queue|queue)\b`)
	serviceRe           = regexp.MustCompile(`(?i)(?:^|[^A-Za-z0-9_-])(?:service|app|application|job|workload)\s+["']?([A-Za-z0-9][A-Za-z0-9_.:/-]{1,80})["']?`)
)

var topologyInfraNames = map[string]struct{}{
	"alloy":              {},
	"alertmanager":       {},
	"grafana":            {},
	"ingress-nginx":      {},
	"kube-prometheus":    {},
	"kube-state-metrics": {},
	"loki":               {},
	"mimir":              {},
	"node-exporter":      {},
	"otel-collector":     {},
	"prometheus":         {},
	"pushgateway":        {},
	"tempo":              {},
}

var topologyNoiseNames = map[string]struct{}{
	"calls":     {},
	"deployed":  {},
	"emits":     {},
	"for":       {},
	"from":      {},
	"is":        {},
	"publishes": {},
	"runs":      {},
	"service":   {},
	"to":        {},
	"via":       {},
}

func parseGraphitiTopology(body string) AgentTopologyResponse {
	return parseGraphitiTopologyWithNodes(body)
}

func parseGraphitiTopologyWithNodes(factBody string, nodeBodies ...string) AgentTopologyResponse {
	return parseGraphitiTopologyBodies([]string{factBody}, nodeBodies)
}

func parseGraphitiTopologyBodies(factBodies []string, nodeBodies []string) AgentTopologyResponse {
	var facts []graphitiTopologyFact
	var nodes []graphitiTopologyNode
	for _, factBody := range factBodies {
		facts = append(facts, extractGraphitiTopologyFacts(factBody)...)
		nodes = append(nodes, extractGraphitiTopologyNodes(factBody)...)
	}
	for _, nodeBody := range nodeBodies {
		nodes = append(nodes, extractGraphitiTopologyNodes(nodeBody)...)
	}
	facts = uniqueTopologyFacts(facts)
	nodes = uniqueTopologyNodes(nodes)

	builder := topologyBuilder{
		nodes:       make(map[string]TopologyNode),
		edges:       make(map[string]TopologyEdge),
		uuidToNode:  make(map[string]TopologyNode),
		rawFactSeen: make(map[string]struct{}),
	}

	for _, node := range nodes {
		builder.addResolvedNode(node)
	}
	for _, fact := range facts {
		builder.ingestGraphitiFact(fact)
	}

	responseNodes := make([]TopologyNode, 0, len(builder.nodes))
	for _, node := range builder.nodes {
		responseNodes = append(responseNodes, node)
	}
	sort.Slice(responseNodes, func(i, j int) bool {
		return responseNodes[i].Label < responseNodes[j].Label
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
		Nodes:        responseNodes,
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

func extractGraphitiTopologyFacts(body string) []graphitiTopologyFact {
	body = strings.TrimSpace(body)
	if body == "" {
		return nil
	}

	var payload interface{}
	if err := json.Unmarshal([]byte(body), &payload); err == nil {
		var facts []graphitiTopologyFact
		walkGraphitiFactPayload(payload, &facts)
		if len(facts) > 0 {
			return uniqueTopologyFacts(facts)
		}
	}

	lines := strings.FieldsFunc(body, func(r rune) bool {
		return r == '\n' || r == '\r'
	})
	textFacts := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			textFacts = append(textFacts, line)
		}
	}
	unique := uniqueStrings(textFacts)
	facts := make([]graphitiTopologyFact, 0, len(unique))
	for _, fact := range unique {
		facts = append(facts, graphitiTopologyFact{Fact: fact})
	}
	return facts
}

func walkGraphitiFactPayload(value interface{}, facts *[]graphitiTopologyFact) {
	switch v := value.(type) {
	case []interface{}:
		for _, item := range v {
			walkGraphitiFactPayload(item, facts)
		}
	case map[string]interface{}:
		if nestedFacts, ok := v["facts"]; ok {
			walkGraphitiFactPayload(nestedFacts, facts)
		}
		if looksLikeGraphitiFact(v) {
			fact, _ := stringField(v, "fact", "text", "content", "summary", "episode_body")
			name, _ := stringField(v, "name", "relationship", "label")
			sourceUUID, _ := stringField(v, "source_node_uuid", "source_uuid")
			targetUUID, _ := stringField(v, "target_node_uuid", "target_uuid")
			sourceName, _ := stringField(v, "source_node_name", "source", "from")
			targetName, _ := stringField(v, "target_node_name", "target", "to")
			*facts = append(*facts, graphitiTopologyFact{
				Name:           name,
				Fact:           fact,
				SourceNodeUUID: sourceUUID,
				TargetNodeUUID: targetUUID,
				SourceNodeName: sourceName,
				TargetNodeName: targetName,
			})
			return
		}
		for _, item := range v {
			walkGraphitiFactPayload(item, facts)
		}
	}
}

func looksLikeGraphitiFact(v map[string]interface{}) bool {
	for _, key := range []string{"fact", "source_node_uuid", "target_node_uuid", "source_node_name", "target_node_name"} {
		if _, ok := v[key].(string); ok {
			return true
		}
	}
	return false
}

func extractGraphitiTopologyNodes(body string) []graphitiTopologyNode {
	body = strings.TrimSpace(body)
	if body == "" {
		return nil
	}
	var payload interface{}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		return nil
	}
	var nodes []graphitiTopologyNode
	walkGraphitiNodePayload(payload, &nodes)
	return uniqueTopologyNodes(nodes)
}

func walkGraphitiNodePayload(value interface{}, nodes *[]graphitiTopologyNode) {
	switch v := value.(type) {
	case []interface{}:
		for _, item := range v {
			walkGraphitiNodePayload(item, nodes)
		}
	case map[string]interface{}:
		if nestedNodes, ok := v["nodes"]; ok {
			walkGraphitiNodePayload(nestedNodes, nodes)
		}
		uuid, uuidOK := stringField(v, "uuid", "id")
		name, nameOK := stringField(v, "name", "label", "title")
		labels := stringSliceField(v, "labels")
		if uuidOK && nameOK {
			if nodeType, ok := topologyTypeFromLabels(labels); ok {
				*nodes = append(*nodes, graphitiTopologyNode{
					UUID:   uuid,
					Name:   name,
					Labels: labels,
					Type:   nodeType,
				})
				return
			}
		}
		for _, item := range v {
			walkGraphitiNodePayload(item, nodes)
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

func stringSliceField(m map[string]interface{}, key string) []string {
	raw, ok := m[key]
	if !ok {
		return nil
	}
	switch v := raw.(type) {
	case []string:
		return v
	case []interface{}:
		values := make([]string, 0, len(v))
		for _, item := range v {
			if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
				values = append(values, text)
			}
		}
		return values
	case string:
		if strings.TrimSpace(v) == "" {
			return nil
		}
		return []string{v}
	default:
		return nil
	}
}

func topologyTypeFromLabels(labels []string) (string, bool) {
	for _, label := range labels {
		switch strings.ToLower(strings.TrimSpace(label)) {
		case "service":
			return "service", true
		case "namespace":
			return "namespace", true
		case "kubecluster":
			return "cluster", true
		case "database":
			return "database", true
		case "queue":
			return "queue", true
		}
	}
	return "", false
}

func (b *topologyBuilder) ingestGraphitiFact(fact graphitiTopologyFact) {
	if fact.SourceNodeName != "" && fact.TargetNodeName != "" {
		if b.addEdge(fact.SourceNodeName, fact.TargetNodeName, relationLabel(fact.Name, "depends")) {
			return
		}
	}

	if fact.SourceNodeUUID != "" && fact.TargetNodeUUID != "" {
		sourceNode, sourceOK := b.uuidToNode[fact.SourceNodeUUID]
		targetNode, targetOK := b.uuidToNode[fact.TargetNodeUUID]
		if sourceOK && targetOK && b.addEdgeFromNodes(sourceNode, targetNode, relationLabel(fact.Name, "relates to")) {
			return
		}
	}

	if fact.Fact != "" {
		b.ingestFact(fact.Fact)
	}
}

func (b *topologyBuilder) ingestFact(fact string) {
	fact = strings.TrimSpace(fact)
	if fact == "" {
		return
	}
	if _, seen := b.rawFactSeen[fact]; seen {
		return
	}
	b.rawFactSeen[fact] = struct{}{}

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
		b.addEdgeWithTypes(match[1], "service", match[2], "namespace", "deployed in")
		matchedStructuredFact = true
	}
	for _, match := range runsOnRe.FindAllStringSubmatch(fact, -1) {
		b.addEdgeWithTypes(match[1], "service", match[2], "cluster", "runs on")
		matchedStructuredFact = true
	}
	for _, match := range emitsSignalRe.FindAllStringSubmatch(fact, -1) {
		b.addEdgeWithTypes(match[1], "service", match[2], "service", "emits signal")
		matchedStructuredFact = true
	}
	for _, match := range publishesToQueueRe.FindAllStringSubmatch(fact, -1) {
		b.addEdgeWithTypes(match[1], "service", match[2], "queue", "publishes to")
		matchedStructuredFact = true
	}
	for _, match := range consumesFromQueueRe.FindAllStringSubmatch(fact, -1) {
		b.addEdgeWithTypes(match[2], "queue", match[1], "service", "consumed by")
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

func (b *topologyBuilder) addEdge(source, target, label string) bool {
	return b.addEdgeWithTypes(source, "service", target, "service", label)
}

func (b *topologyBuilder) addEdgeWithTypes(source, sourceType, target, targetType, label string) bool {
	sourceNode, ok := b.addNodeWithType(source, sourceType)
	if !ok {
		return false
	}
	targetNode, ok := b.addNodeWithType(target, targetType)
	if !ok {
		return false
	}
	return b.addEdgeFromNodes(sourceNode, targetNode, label)
}

func (b *topologyBuilder) addEdgeFromNodes(sourceNode, targetNode TopologyNode, label string) bool {
	if sourceNode.ID == "" || targetNode.ID == "" || sourceNode.ID == targetNode.ID {
		return false
	}
	b.nodes[sourceNode.ID] = sourceNode
	b.nodes[targetNode.ID] = targetNode

	id := sourceNode.ID + "->" + targetNode.ID
	if _, exists := b.edges[id]; exists {
		return false
	}
	b.edges[id] = TopologyEdge{
		ID:     id,
		Source: sourceNode.ID,
		Target: targetNode.ID,
		Label:  label,
	}
	return true
}

func (b *topologyBuilder) addNode(raw string) (TopologyNode, bool) {
	return b.addNodeWithType(raw, "service")
}

func (b *topologyBuilder) addNodeWithType(raw, nodeType string) (TopologyNode, bool) {
	label := cleanTopologyName(raw)
	if label == "" || isTopologyInfra(label) || isTopologyNoise(label) {
		return TopologyNode{}, false
	}
	id := topologyNodeID(label)
	if node, exists := b.nodes[id]; exists {
		return node, true
	}
	if nodeType == "" {
		nodeType = "service"
	}
	node := TopologyNode{ID: id, Label: label, Type: nodeType}
	b.nodes[id] = node
	return node, true
}

func (b *topologyBuilder) addResolvedNode(node graphitiTopologyNode) (TopologyNode, bool) {
	topologyNode, ok := b.addNodeWithType(node.Name, node.Type)
	if !ok {
		return TopologyNode{}, false
	}
	if node.UUID != "" {
		b.uuidToNode[node.UUID] = topologyNode
	}
	return topologyNode, true
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

func findGraphitiSearchNodesTool(tools []mcp.Tool) string {
	candidates := []string{
		"graphiti_search_nodes",
		"graphiti_search_memory_nodes",
		"graphiti_graphiti_search_nodes",
		"graphiti_graphiti_search_memory_nodes",
	}
	for _, candidate := range candidates {
		for _, tool := range tools {
			if tool.Name == candidate {
				return tool.Name
			}
		}
	}
	for _, tool := range tools {
		if strings.HasSuffix(tool.Name, "_search_nodes") || strings.HasSuffix(tool.Name, "_search_memory_nodes") {
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

func graphitiSearchFactsForNodeArgs(tools []mcp.Tool, toolName string, orgID int64, query string, maxFacts int, centerNodeUUID string) map[string]interface{} {
	args := graphitiSearchFactsArgs(tools, toolName, orgID, query, maxFacts)
	if _, ok := graphitiToolProperties(tools, toolName)["center_node_uuid"]; ok && strings.TrimSpace(centerNodeUUID) != "" {
		args["center_node_uuid"] = centerNodeUUID
	}
	return args
}

func graphitiSearchFactsSupportsCenterNode(tools []mcp.Tool, toolName string) bool {
	_, ok := graphitiToolProperties(tools, toolName)["center_node_uuid"]
	return ok
}

func graphitiSearchNodesArgs(tools []mcp.Tool, toolName string, orgID int64, query string, maxNodes int, entityTypes []string) map[string]interface{} {
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
	if properties["max_nodes"] != nil && maxNodes > 0 {
		args["max_nodes"] = maxNodes
	}
	if properties["entity_types"] != nil && len(entityTypes) > 0 {
		args["entity_types"] = entityTypes
	}

	return args
}

func graphitiTopologyNodeQueries() []struct {
	query       string
	entityTypes []string
} {
	return []struct {
		query       string
		entityTypes []string
	}{
		{query: "service application workload microservice api worker job", entityTypes: []string{"Service"}},
		{query: "namespace kubernetes deployment topology", entityTypes: []string{"Namespace"}},
		{query: "cluster kubernetes eks topology", entityTypes: []string{"KubeCluster"}},
		{query: "database datastore postgres redis mysql elasticsearch", entityTypes: []string{"Database"}},
		{query: "queue messaging kafka rabbitmq nats sqs", entityTypes: []string{"Queue"}},
	}
}

func graphitiTopologyFactQuery() string {
	return "service topology dependencies deployment signals upstream downstream database queue cluster namespace"
}

func topologyCenterNodes(nodes []graphitiTopologyNode, maxNodes int) []graphitiTopologyNode {
	nodes = uniqueTopologyNodes(nodes)
	sort.SliceStable(nodes, func(i, j int) bool {
		leftPriority := topologyCenterNodePriority(nodes[i].Type)
		rightPriority := topologyCenterNodePriority(nodes[j].Type)
		if leftPriority != rightPriority {
			return leftPriority < rightPriority
		}
		return nodes[i].Name < nodes[j].Name
	})

	limit := sanitizeTopologyLimit(maxNodes, defaultTopologyMaxNodes, hardTopologyMaxNodes)
	result := make([]graphitiTopologyNode, 0, min(len(nodes), limit))
	for _, node := range nodes {
		if len(result) >= limit {
			break
		}
		if strings.TrimSpace(node.UUID) == "" {
			continue
		}
		label := cleanTopologyName(node.Name)
		if label == "" || isTopologyInfra(label) || isTopologyNoise(label) {
			continue
		}
		result = append(result, node)
	}
	return result
}

func topologyCenteredFactLimit(maxEdges, centerNodeCount int) int {
	maxEdges = sanitizeTopologyLimit(maxEdges, defaultTopologyMaxEdges, hardTopologyMaxEdges)
	if centerNodeCount <= 0 {
		return maxEdges
	}
	limit := (maxEdges / centerNodeCount) + 10
	if limit < 25 {
		return 25
	}
	if limit > 100 {
		return 100
	}
	return limit
}

func topologyCenterNodePriority(nodeType string) int {
	switch nodeType {
	case "service":
		return 0
	case "database", "queue":
		return 1
	case "namespace":
		return 2
	case "cluster":
		return 3
	default:
		return 4
	}
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

func uniqueTopologyFacts(facts []graphitiTopologyFact) []graphitiTopologyFact {
	seen := make(map[string]struct{}, len(facts))
	result := make([]graphitiTopologyFact, 0, len(facts))
	for _, fact := range facts {
		key := strings.Join([]string{
			fact.Name,
			fact.Fact,
			fact.SourceNodeUUID,
			fact.TargetNodeUUID,
			fact.SourceNodeName,
			fact.TargetNodeName,
		}, "\x00")
		if strings.Trim(key, "\x00") == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, fact)
	}
	return result
}

func uniqueTopologyNodes(nodes []graphitiTopologyNode) []graphitiTopologyNode {
	seen := make(map[string]struct{}, len(nodes))
	result := make([]graphitiTopologyNode, 0, len(nodes))
	for _, node := range nodes {
		key := node.UUID
		if key == "" {
			key = strings.ToLower(node.Name)
		}
		if strings.TrimSpace(key) == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, node)
	}
	return result
}

func relationLabel(name, fallback string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return fallback
	}
	name = strings.ToLower(strings.ReplaceAll(name, "_", " "))
	return strings.Join(strings.Fields(name), " ")
}
