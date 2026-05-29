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

func TestFindGraphitiSearchFactsTool(t *testing.T) {
	tools := []mcp.Tool{
		{Name: "graphiti_add_memory"},
		{Name: "graphiti_search_memory_facts"},
	}
	if got := findGraphitiSearchFactsTool(tools); got != "graphiti_search_memory_facts" {
		t.Fatalf("tool = %q, want graphiti_search_memory_facts", got)
	}
}
