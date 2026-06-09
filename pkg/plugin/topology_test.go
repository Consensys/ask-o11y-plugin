package plugin

import (
	"consensys-asko11y-app/pkg/mcp"
	"testing"
)

func TestParseGraphitiTopologyExtractsServiceEdges(t *testing.T) {
	body := `[
		{"fact":"checkout calls payments"},
		{"source_node_name":"payments","target_node_name":"ledger"},
		{"fact":"grafana calls tempo"}
	]`

	topology := parseGraphitiTopology(body)

	if len(topology.Nodes) != 3 {
		t.Fatalf("nodes = %+v, want 3 business services", topology.Nodes)
	}
	if len(topology.Edges) != 2 {
		t.Fatalf("edges = %+v, want 2 business edges", topology.Edges)
	}

	edgeIDs := map[string]bool{}
	for _, edge := range topology.Edges {
		edgeIDs[edge.ID] = true
	}
	if !edgeIDs["checkout->payments"] || !edgeIDs["payments->ledger"] {
		t.Fatalf("missing expected edges: %+v", topology.Edges)
	}
}

func TestLimitTopologyResponseTrimsNodesAndEdges(t *testing.T) {
	response := AgentTopologyResponse{
		Enabled: true,
		Source:  "graphiti",
		Nodes: []TopologyNode{
			{ID: "api", Label: "api", Type: "service"},
			{ID: "checkout", Label: "checkout", Type: "service"},
			{ID: "payments", Label: "payments", Type: "service"},
		},
		Edges: []TopologyEdge{
			{ID: "api->checkout", Source: "api", Target: "checkout", Label: "calls"},
			{ID: "checkout->payments", Source: "checkout", Target: "payments", Label: "calls"},
			{ID: "api->payments", Source: "api", Target: "payments", Label: "calls"},
		},
	}

	limited := limitTopologyResponse(response, 2, 1)

	if len(limited.Nodes) != 2 {
		t.Fatalf("nodes = %+v, want 2", limited.Nodes)
	}
	if len(limited.Edges) != 1 {
		t.Fatalf("edges = %+v, want 1", limited.Edges)
	}
	if limited.Edges[0].Source != "api" || limited.Edges[0].Target != "checkout" {
		t.Fatalf("edge = %+v, want retained edge between kept nodes", limited.Edges[0])
	}
	if len(limited.Warnings) != 2 {
		t.Fatalf("warnings = %+v, want node and edge truncation warnings", limited.Warnings)
	}
}

func TestLimitTopologyResponseUsesDefaultLimitsForInvalidValues(t *testing.T) {
	response := AgentTopologyResponse{
		Enabled: true,
		Source:  "graphiti",
		Nodes: []TopologyNode{
			{ID: "api", Label: "api", Type: "service"},
			{ID: "checkout", Label: "checkout", Type: "service"},
		},
		Edges: []TopologyEdge{
			{ID: "api->checkout", Source: "api", Target: "checkout", Label: "calls"},
		},
	}

	limited := limitTopologyResponse(response, 0, -1)

	if len(limited.Nodes) != 2 {
		t.Fatalf("nodes = %+v, want defaults to keep both nodes", limited.Nodes)
	}
	if len(limited.Edges) != 1 {
		t.Fatalf("edges = %+v, want defaults to keep edge", limited.Edges)
	}
	if len(limited.Warnings) != 0 {
		t.Fatalf("warnings = %+v, want none", limited.Warnings)
	}
}

func TestParseGraphitiTopologyExtractsSearchMemoryFacts(t *testing.T) {
	body := `{
		"message": "Facts retrieved successfully",
		"facts": [
			{"name":"CALLS","fact":"checkout service calls cart service via gRPC"},
			{"name":"CALLS","fact":"frontend calls flagd service via gRPC for feature flag evaluation"},
			{"name":"PUBLISHES_TO","fact":"checkout service publishes fraud detection events to kafka message queue"},
			{"name":"DEPLOYED_IN","fact":"checkout service is deployed in otel-demo namespace"},
			{"name":"RUNS_ON","fact":"checkout service runs on o11y-dev-us cluster"}
		]
	}`

	topology := parseGraphitiTopology(body)

	edgeIDs := map[string]bool{}
	for _, edge := range topology.Edges {
		edgeIDs[edge.ID] = true
	}

	for _, edgeID := range []string{
		"checkout->cart",
		"frontend->flagd",
		"checkout->kafka",
		"checkout->otel-demo",
		"checkout->o11y-dev-us",
	} {
		if !edgeIDs[edgeID] {
			t.Fatalf("missing edge %q in %+v", edgeID, topology.Edges)
		}
	}
	if edgeIDs["service->cart"] {
		t.Fatalf("parsed generic service node from service fact: %+v", topology.Edges)
	}
}

func TestParseGraphitiTopologyResolvesProductionUUIDFacts(t *testing.T) {
	factBody := `{
		"message": "Facts retrieved successfully",
		"facts": [
			{
				"name": "DEPLOYED_IN",
				"fact": "bridge-api service is deployed in the bridge namespace",
				"source_node_uuid": "service-bridge",
				"target_node_uuid": "namespace-bridge"
			},
			{
				"name": "RUNS_ON",
				"fact": "bridge-api service runs on mmcx-prd cluster",
				"source_node_uuid": "service-bridge",
				"target_node_uuid": "cluster-prd"
			},
			{
				"name": "EMITS_SIGNAL",
				"fact": "bridge-api service emits trace signals to Tempo",
				"source_node_uuid": "service-bridge",
				"target_node_uuid": "infra-tempo"
			}
		]
	}`
	nodeBody := `{
		"message": "Nodes retrieved successfully",
		"nodes": [
			{"uuid": "service-bridge", "name": "bridge-api", "labels": ["Entity", "Service"]},
			{"uuid": "namespace-bridge", "name": "bridge", "labels": ["Entity", "Namespace"]},
			{"uuid": "cluster-prd", "name": "mmcx-prd", "labels": ["Entity", "KubeCluster"]},
			{"uuid": "infra-tempo", "name": "Tempo", "labels": ["Entity", "Service"]}
		]
	}`

	topology := parseGraphitiTopologyWithNodes(factBody, nodeBody)

	if len(topology.Nodes) != 3 {
		t.Fatalf("nodes = %+v, want bridge-api, bridge namespace, and mmcx-prd cluster", topology.Nodes)
	}

	edgeIDs := map[string]TopologyEdge{}
	for _, edge := range topology.Edges {
		edgeIDs[edge.ID] = edge
	}
	if edgeIDs["bridge-api->bridge"].Label != "deployed in" {
		t.Fatalf("missing bridge-api deployment edge in %+v", topology.Edges)
	}
	if edgeIDs["bridge-api->mmcx-prd"].Label != "runs on" {
		t.Fatalf("missing bridge-api cluster edge in %+v", topology.Edges)
	}
	if _, ok := edgeIDs["bridge-api->tempo"]; ok {
		t.Fatalf("infra edge to Tempo should be filtered: %+v", topology.Edges)
	}
}

func TestParseGraphitiTopologyBodiesResolvesCenteredFacts(t *testing.T) {
	nodeBody := `{
		"nodes": [
			{"uuid": "service-auth", "name": "auth-service", "labels": ["Entity", "Service"]},
			{"uuid": "service-api", "name": "api-service", "labels": ["Entity", "Service"]},
			{"uuid": "queue-events", "name": "events", "labels": ["Entity", "Queue"]}
		]
	}`
	firstFactBody := `{
		"facts": [
			{"name":"CALLS","source_node_uuid":"service-auth","target_node_uuid":"service-api","fact":"auth-service calls api-service"}
		]
	}`
	centeredFactBody := `{
		"facts": [
			{"name":"PUBLISHES_TO","source_node_uuid":"service-api","target_node_uuid":"queue-events","fact":"api-service publishes events to events queue"}
		]
	}`

	topology := parseGraphitiTopologyBodies([]string{firstFactBody, centeredFactBody}, []string{nodeBody})

	if len(topology.Nodes) != 3 {
		t.Fatalf("nodes = %+v, want typed service and queue nodes", topology.Nodes)
	}
	edgeIDs := map[string]string{}
	for _, edge := range topology.Edges {
		edgeIDs[edge.ID] = edge.Label
	}
	if edgeIDs["auth-service->api-service"] != "calls" {
		t.Fatalf("missing centered service edge in %+v", topology.Edges)
	}
	if edgeIDs["api-service->events"] != "publishes to" {
		t.Fatalf("missing centered queue edge in %+v", topology.Edges)
	}
}

func TestParseGraphitiTopologyHandlesHyphenatedServiceFacts(t *testing.T) {
	body := `{
		"facts": [
			{"name":"EMITS_SIGNAL","fact":"auth-service emits metric signals to custom-metric-store"},
			{"name":"DEPLOYED_IN","fact":"auth-service is deployed in auth namespace"}
		]
	}`

	topology := parseGraphitiTopology(body)

	edgeIDs := map[string]bool{}
	nodeIDs := map[string]bool{}
	nodeTypes := map[string]string{}
	for _, edge := range topology.Edges {
		edgeIDs[edge.ID] = true
	}
	for _, node := range topology.Nodes {
		nodeIDs[node.ID] = true
		nodeTypes[node.ID] = node.Type
	}

	if !edgeIDs["auth-service->custom-metric-store"] {
		t.Fatalf("missing emits edge in %+v", topology.Edges)
	}
	if !edgeIDs["auth-service->auth"] {
		t.Fatalf("missing deployment edge in %+v", topology.Edges)
	}
	if nodeIDs["emits"] {
		t.Fatalf("parsed hyphenated service suffix as generic emits node: %+v", topology.Nodes)
	}
	if nodeTypes["auth"] != "namespace" {
		t.Fatalf("auth node type = %q, want namespace", nodeTypes["auth"])
	}
}

func TestLimitTopologyResponseKeepsTypedEdgesWithinLimits(t *testing.T) {
	response := AgentTopologyResponse{
		Enabled: true,
		Source:  "graphiti",
		Nodes: []TopologyNode{
			{ID: "auth-service", Label: "auth-service", Type: "service"},
			{ID: "auth", Label: "auth", Type: "namespace"},
			{ID: "mmcx-prd", Label: "mmcx-prd", Type: "cluster"},
		},
		Edges: []TopologyEdge{
			{ID: "auth-service->auth", Source: "auth-service", Target: "auth", Label: "deployed in"},
			{ID: "auth-service->mmcx-prd", Source: "auth-service", Target: "mmcx-prd", Label: "runs on"},
		},
	}

	limited := limitTopologyResponse(response, 3, 2)

	if len(limited.Nodes) != 3 {
		t.Fatalf("nodes = %+v, want 3", limited.Nodes)
	}
	if len(limited.Edges) != 2 {
		t.Fatalf("edges = %+v, want 2", limited.Edges)
	}
}

func TestFindGraphitiSearchFactsTool(t *testing.T) {
	tools := []mcp.Tool{
		{Name: "graphiti_add_memory"},
		{Name: "graphiti_search_memory_facts"},
	}
	if got := findGraphitiSearchFactsTool(tools); got != "graphiti_search_memory_facts" {
		t.Fatalf("tool = %q, want graphiti_search_memory_facts", got)
	}
}

func TestFindGraphitiSearchNodesTool(t *testing.T) {
	tools := []mcp.Tool{
		{Name: "graphiti_search_nodes"},
	}
	if got := findGraphitiSearchNodesTool(tools); got != "graphiti_search_nodes" {
		t.Fatalf("tool = %q, want graphiti_search_nodes", got)
	}
}

func TestGraphitiSearchFactsArgsUsesPluralScopeWhenAvailable(t *testing.T) {
	tools := []mcp.Tool{
		{
			Name: "graphiti_search_memory_facts",
			InputSchema: map[string]interface{}{
				"properties": map[string]interface{}{
					"group_ids": map[string]interface{}{"type": "array"},
					"max_facts": map[string]interface{}{"type": "integer"},
					"query":     map[string]interface{}{"type": "string"},
				},
			},
		},
	}

	args := graphitiSearchFactsArgs(tools, "graphiti_search_memory_facts", 6, "topology", 200)

	groupIDs, ok := args["group_ids"].([]string)
	if !ok || len(groupIDs) != 1 || groupIDs[0] != "org_6" {
		t.Fatalf("group_ids = %#v, want [org_6]", args["group_ids"])
	}
	if got := args["group_id"]; got != nil {
		t.Fatalf("group_id = %v, want nil", got)
	}
	if got := args["max_facts"]; got != 200 {
		t.Fatalf("max_facts = %v, want 200", got)
	}
}

func TestGraphitiSearchFactsForNodeArgsUsesCenterNodeWhenAvailable(t *testing.T) {
	tools := []mcp.Tool{
		{
			Name: "graphiti_search_memory_facts",
			InputSchema: map[string]interface{}{
				"properties": map[string]interface{}{
					"group_ids":        map[string]interface{}{"type": "array"},
					"max_facts":        map[string]interface{}{"type": "integer"},
					"center_node_uuid": map[string]interface{}{"type": "string"},
				},
			},
		},
	}

	args := graphitiSearchFactsForNodeArgs(tools, "graphiti_search_memory_facts", 24, "topology", 1000, "service-auth")

	if got := args["center_node_uuid"]; got != "service-auth" {
		t.Fatalf("center_node_uuid = %v, want service-auth", got)
	}
	if !graphitiSearchFactsSupportsCenterNode(tools, "graphiti_search_memory_facts") {
		t.Fatal("expected center_node_uuid support")
	}
}

func TestGraphitiSearchNodesArgsUsesTypedNodeFilters(t *testing.T) {
	tools := []mcp.Tool{
		{
			Name: "graphiti_search_nodes",
			InputSchema: map[string]interface{}{
				"properties": map[string]interface{}{
					"group_ids":    map[string]interface{}{"type": "array"},
					"max_nodes":    map[string]interface{}{"type": "integer"},
					"query":        map[string]interface{}{"type": "string"},
					"entity_types": map[string]interface{}{"type": "array"},
				},
			},
		},
	}

	args := graphitiSearchNodesArgs(tools, "graphiti_search_nodes", 24, "service", 500, []string{"Service"})

	groupIDs, ok := args["group_ids"].([]string)
	if !ok || len(groupIDs) != 1 || groupIDs[0] != "org_24" {
		t.Fatalf("group_ids = %#v, want [org_24]", args["group_ids"])
	}
	if got := args["max_nodes"]; got != 500 {
		t.Fatalf("max_nodes = %v, want 500", got)
	}
	entityTypes, ok := args["entity_types"].([]string)
	if !ok || len(entityTypes) != 1 || entityTypes[0] != "Service" {
		t.Fatalf("entity_types = %#v, want [Service]", args["entity_types"])
	}
}

func TestTopologyCenterNodesPrioritizesBusinessServicesAndFiltersInfra(t *testing.T) {
	nodes := []graphitiTopologyNode{
		{UUID: "cluster-prd", Name: "mmcx-prd", Type: "cluster"},
		{UUID: "tempo", Name: "Tempo", Type: "service"},
		{UUID: "service-auth", Name: "auth-service", Type: "service"},
		{UUID: "queue-events", Name: "events", Type: "queue"},
		{UUID: "", Name: "nameless-service", Type: "service"},
	}

	centerNodes := topologyCenterNodes(nodes, 3)

	if len(centerNodes) != 3 {
		t.Fatalf("center nodes = %+v, want 3 business nodes", centerNodes)
	}
	if centerNodes[0].UUID != "service-auth" {
		t.Fatalf("first center node = %+v, want auth-service service first", centerNodes[0])
	}
	for _, node := range centerNodes {
		if node.UUID == "tempo" || node.UUID == "" {
			t.Fatalf("center node should filter infra and missing UUID entries: %+v", centerNodes)
		}
	}
}

func TestTopologyCenteredFactLimitScalesWithRequestedEdges(t *testing.T) {
	if got := topologyCenteredFactLimit(200, 100); got != 25 {
		t.Fatalf("default dense fact limit = %d, want 25", got)
	}
	if got := topologyCenteredFactLimit(1000, 5); got != 100 {
		t.Fatalf("large sparse fact limit = %d, want capped 100", got)
	}
	if got := topologyCenteredFactLimit(200, 0); got != 200 {
		t.Fatalf("empty center fact limit = %d, want requested edge limit", got)
	}
}
