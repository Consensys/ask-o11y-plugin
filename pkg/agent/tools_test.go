package agent

import (
	"consensys-asko11y-app/pkg/mcp"
	"testing"
)

func TestConvertMCPToolsToOpenAI(t *testing.T) {
	mcpTools := []mcp.Tool{
		{
			Name:        "mcp-grafana_query_prometheus",
			Description: "Query Prometheus metrics",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"query": map[string]interface{}{"type": "string"},
				},
				"required": []interface{}{"query"},
			},
		},
		{
			Name:        "mcp-grafana_get_dashboard_by_uid",
			Description: "Get a dashboard by UID",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"uid": map[string]interface{}{"type": "string"},
				},
			},
		},
	}

	result := ConvertMCPToolsToOpenAI(mcpTools)

	if len(result) != 2 {
		t.Fatalf("expected 2 tools, got %d", len(result))
	}

	if result[0].Type != "function" {
		t.Errorf("expected type 'function', got %q", result[0].Type)
	}
	if result[0].Function.Name != "mcp-grafana_query_prometheus" {
		t.Errorf("expected name 'mcp-grafana_query_prometheus', got %q", result[0].Function.Name)
	}
	if result[0].Function.Description != "Query Prometheus metrics" {
		t.Errorf("unexpected description: %q", result[0].Function.Description)
	}
	if result[0].Function.Parameters == nil {
		t.Error("expected parameters, got nil")
	}
}

func TestConvertMCPToolsToOpenAI_Empty(t *testing.T) {
	result := ConvertMCPToolsToOpenAI([]mcp.Tool{})
	if len(result) != 0 {
		t.Fatalf("expected 0 tools, got %d", len(result))
	}
}
