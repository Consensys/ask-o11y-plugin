package mcp

import "testing"

func TestIsToolEnabled(t *testing.T) {
	servers := []ServerConfig{
		{
			ID:      "srv1",
			Enabled: true,
			ToolSelections: map[string]bool{
				"srv1_allowed":  true,
				"srv1_disabled": false,
			},
		},
		{ID: "srv2", Enabled: false},
		{ID: "srv3", Enabled: true},
	}

	cases := []struct {
		name string
		tool string
		want bool
	}{
		{"unprefixed tool always enabled", "list_datasources", true},
		{"unknown server prefix is allowed", "unknown_tool", true},
		{"explicit selection true", "srv1_allowed", true},
		{"explicit selection false", "srv1_disabled", false},
		{"no selection on known server defaults true", "srv1_other", true},
		{"disabled server blocks tool", "srv2_anything", false},
		{"server with empty selections allows all", "srv3_anything", true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsToolEnabled(tc.tool, servers); got != tc.want {
				t.Errorf("IsToolEnabled(%q) = %v, want %v", tc.tool, got, tc.want)
			}
		})
	}
}

func TestFilterToolsBySelection(t *testing.T) {
	servers := []ServerConfig{
		{
			ID:             "srv1",
			Enabled:        true,
			ToolSelections: map[string]bool{"srv1_a": true, "srv1_b": false},
		},
	}
	tools := []Tool{
		{Name: "srv1_a"},
		{Name: "srv1_b"},
		{Name: "srv1_c"},
		{Name: "builtin"},
	}

	got := FilterToolsBySelection(tools, servers)
	if len(got) != 3 {
		t.Fatalf("expected 3 tools, got %d: %+v", len(got), got)
	}
	for _, tool := range got {
		if tool.Name == "srv1_b" {
			t.Errorf("srv1_b should have been filtered out")
		}
	}
}

func TestFilterToolsBySelection_NoServers(t *testing.T) {
	tools := []Tool{{Name: "a"}, {Name: "b"}}
	got := FilterToolsBySelection(tools, nil)
	if len(got) != 2 {
		t.Errorf("expected pass-through with no servers, got %d", len(got))
	}
}

func TestEnsureScopedGraphitiArgs(t *testing.T) {
	toolSchema := map[string]interface{}{
		"properties": map[string]interface{}{
			"group_id": map[string]interface{}{"type": "string"},
			"query":    map[string]interface{}{"type": "string"},
		},
	}

	tests := []struct {
		name     string
		toolName string
		orgID    string
		args     map[string]interface{}
		want     interface{}
	}{
		{
			name:     "unprefixed graphiti tool",
			toolName: "graphiti_search_memory_facts",
			orgID:    "42",
			args:     map[string]interface{}{"query": "payments"},
			want:     "org_42",
		},
		{
			name:     "server-prefixed graphiti tool name",
			toolName: "kg_graphiti_search_memory_facts",
			orgID:    "7",
			args:     map[string]interface{}{"query": "checkout", "group_id": "wrong"},
			want:     "org_7",
		},
		{
			name:     "server-prefixed graphiti base tool name",
			toolName: "kg_search_memory_facts",
			orgID:    "9",
			args:     map[string]interface{}{"query": "checkout"},
			want:     "org_9",
		},
		{
			name:     "non-graphiti tool with group_id",
			toolName: "other_search",
			orgID:    "7",
			args:     map[string]interface{}{"query": "checkout"},
			want:     nil,
		},
		{
			name:     "missing org id",
			toolName: "graphiti_search_memory_facts",
			orgID:    "",
			args:     map[string]interface{}{"query": "payments"},
			want:     nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tool := Tool{Name: tt.toolName, InputSchema: toolSchema}
			EnsureScopedGraphitiArgs(tool, tt.args, tt.orgID)

			if got := tt.args["group_id"]; got != tt.want {
				t.Fatalf("group_id = %v, want %v", got, tt.want)
			}
		})
	}
}
