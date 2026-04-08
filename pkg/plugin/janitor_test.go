package plugin

import (
	"encoding/json"
	"testing"

	"consensys-asko11y-app/pkg/graphiti"
	"consensys-asko11y-app/pkg/mcp"
)

func TestIsDiscoveryTool(t *testing.T) {
	tests := []struct {
		name     string
		tool     mcp.Tool
		expected bool
	}{
		{
			name: "no required field",
			tool: mcp.Tool{
				Name:        "list_dashboards",
				InputSchema: map[string]interface{}{},
			},
			expected: true,
		},
		{
			name: "nil required field",
			tool: mcp.Tool{
				Name:        "list_datasources",
				InputSchema: map[string]interface{}{"required": nil},
			},
			expected: true,
		},
		{
			name: "empty required list ([]interface{})",
			tool: mcp.Tool{
				Name:        "list_alerts",
				InputSchema: map[string]interface{}{"required": []interface{}{}},
			},
			expected: true,
		},
		{
			name: "empty required list ([]string)",
			tool: mcp.Tool{
				Name:        "list_folders",
				InputSchema: map[string]interface{}{"required": []string{}},
			},
			expected: true,
		},
		{
			name: "has required parameters",
			tool: mcp.Tool{
				Name:        "query_prometheus",
				InputSchema: map[string]interface{}{"required": []interface{}{"query"}},
			},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isDiscoveryTool(tt.tool)
			if got != tt.expected {
				t.Errorf("isDiscoveryTool(%q) = %v, want %v", tt.tool.Name, got, tt.expected)
			}
		})
	}
}

func TestSplitToolOutput_SingleItem(t *testing.T) {
	body := `{"title": "API Gateway", "uid": "abc123"}`
	eps := splitToolOutput(body, "srv", "get_dashboard", "2024-01-01T00:00:00Z")

	if len(eps) != 1 {
		t.Fatalf("expected 1 episode, got %d", len(eps))
	}
	if eps[0].Source != "json" {
		t.Errorf("expected source 'json', got %q", eps[0].Source)
	}
	if eps[0].ReferenceTime != "2024-01-01T00:00:00Z" {
		t.Errorf("expected reference_time '2024-01-01T00:00:00Z', got %q", eps[0].ReferenceTime)
	}
	if eps[0].EntityTypes == nil {
		t.Error("expected entity types to be set")
	}
}

func TestSplitToolOutput_JSONArray(t *testing.T) {
	body := `[
		{"title": "API Gateway", "uid": "abc"},
		{"title": "Auth Service", "uid": "def"},
		{"title": "Payment Service", "uid": "ghi"}
	]`
	eps := splitToolOutput(body, "grafana", "list_dashboards", "2024-01-01T00:00:00Z")

	if len(eps) != 3 {
		t.Fatalf("expected 3 episodes, got %d", len(eps))
	}
	// Verify each episode has correct metadata
	for i, ep := range eps {
		if ep.Source != "json" {
			t.Errorf("episode[%d]: expected source 'json', got %q", i, ep.Source)
		}
		if ep.ReferenceTime != "2024-01-01T00:00:00Z" {
			t.Errorf("episode[%d]: expected reference_time set", i)
		}
		if ep.EntityTypes == nil {
			t.Errorf("episode[%d]: expected entity types", i)
		}
	}
	// Check that names include the dashboard titles
	if eps[0].Name != "discovery:grafana:list_dashboards:api-gateway" {
		t.Errorf("expected name to contain 'api-gateway', got %q", eps[0].Name)
	}
}

func TestSplitToolOutput_WrappedJSONObject(t *testing.T) {
	body := `{
		"dashboards": [
			{"title": "DB Monitoring", "uid": "db1"},
			{"title": "Cache Layer", "uid": "cache1"}
		],
		"count": 2
	}`
	eps := splitToolOutput(body, "grafana", "search_dashboards", "2024-01-01T00:00:00Z")

	if len(eps) != 2 {
		t.Fatalf("expected 2 episodes (split from dashboards field), got %d", len(eps))
	}
}

func TestSplitToolOutput_PlainText(t *testing.T) {
	body := "The API gateway is connected to the auth service via gRPC on port 50051."
	eps := splitToolOutput(body, "grafana", "describe_topology", "2024-01-01T00:00:00Z")

	if len(eps) != 1 {
		t.Fatalf("expected 1 episode for plain text, got %d", len(eps))
	}
	if eps[0].Source != "text" {
		t.Errorf("expected source 'text', got %q", eps[0].Source)
	}
}

func TestSplitToolOutput_SingleElementArray(t *testing.T) {
	// Single-element arrays should NOT be split
	body := `[{"title": "Only Dashboard"}]`
	eps := splitToolOutput(body, "grafana", "list_dashboards", "2024-01-01T00:00:00Z")

	// A single-element array stays as one episode (not split)
	if len(eps) != 1 {
		t.Fatalf("expected 1 episode for single-element array, got %d", len(eps))
	}
}

func TestExtractItemName(t *testing.T) {
	tests := []struct {
		name     string
		json     string
		index    int
		expected string
	}{
		{"title field", `{"title": "API Gateway"}`, 0, "api-gateway"},
		{"name field", `{"name": "auth-service"}`, 0, "auth-service"},
		{"uid field", `{"uid": "abc123"}`, 0, "abc123"},
		{"id field", `{"id": "12345"}`, 0, "12345"},
		{"no name fields", `{"foo": "bar"}`, 5, "item_5"},
		{"invalid json", `not json`, 3, "item_3"},
		{"title with special chars", `{"title": "My Dashboard (v2)!"}`, 0, "my-dashboard-v2"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractItemName(json.RawMessage(tt.json), tt.index)
			if got != tt.expected {
				t.Errorf("extractItemName(%q, %d) = %q, want %q", tt.json, tt.index, got, tt.expected)
			}
		})
	}
}

func TestSanitizeEpisodeName(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"API Gateway", "api-gateway"},
		{"my_service-123", "my_service-123"},
		{"Hello World!!!", "hello-world"},
		{"---test---", "test"},
		{"UPPERCASE", "uppercase"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := sanitizeEpisodeName(tt.input)
			if got != tt.expected {
				t.Errorf("sanitizeEpisodeName(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestHashContent(t *testing.T) {
	h1 := hashContent("hello world")
	h2 := hashContent("hello world")
	h3 := hashContent("different content")

	if h1 != h2 {
		t.Error("same content should produce same hash")
	}
	if h1 == h3 {
		t.Error("different content should produce different hash")
	}
}

func TestObservabilityEntityTypes(t *testing.T) {
	types := graphiti.ObservabilityEntityTypes()

	expected := []string{
		"Service", "Database", "Queue", "Infrastructure",
		"Namespace", "Dashboard", "Alert", "Datasource", "Team",
	}

	for _, name := range expected {
		desc, ok := types[name]
		if !ok {
			t.Errorf("missing entity type %q", name)
			continue
		}
		if desc == "" {
			t.Errorf("entity type %q has empty description", name)
		}
	}
}
