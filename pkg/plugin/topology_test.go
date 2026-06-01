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

func TestFindGraphitiSearchFactsTool(t *testing.T) {
	tools := []mcp.Tool{
		{Name: "graphiti_add_memory"},
		{Name: "graphiti_search_memory_facts"},
	}
	if got := findGraphitiSearchFactsTool(tools); got != "graphiti_search_memory_facts" {
		t.Fatalf("tool = %q, want graphiti_search_memory_facts", got)
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
