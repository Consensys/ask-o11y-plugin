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
	tests := []struct {
		name       string
		toolName   string
		orgID      string
		schema     map[string]interface{}
		args       map[string]interface{}
		wantID     interface{}
		wantIDs    interface{}
		wantAbsent bool
	}{
		{
			name:     "unprefixed graphiti tool",
			toolName: "graphiti_search_memory_facts",
			orgID:    "42",
			schema:   map[string]interface{}{"group_id": map[string]interface{}{"type": "string"}},
			args:     map[string]interface{}{"query": "payments"},
			wantID:   "org_42",
		},
		{
			name:     "server-prefixed graphiti tool name",
			toolName: "kg_graphiti_search_memory_facts",
			orgID:    "7",
			schema:   map[string]interface{}{"group_id": map[string]interface{}{"type": "string"}},
			args:     map[string]interface{}{"query": "checkout", "group_id": "wrong"},
			wantID:   "org_7",
		},
		{
			name:     "server-prefixed graphiti base tool name",
			toolName: "kg_search_memory_facts",
			orgID:    "9",
			schema:   map[string]interface{}{"group_id": map[string]interface{}{"type": "string"}},
			args:     map[string]interface{}{"query": "checkout"},
			wantID:   "org_9",
		},
		{
			name:     "plural graphiti group ids schema",
			toolName: "graphiti_search_memory_facts",
			orgID:    "6",
			schema:   map[string]interface{}{"group_ids": map[string]interface{}{"type": "array"}},
			args:     map[string]interface{}{"query": "topology", "group_ids": []string{"wrong"}},
			wantIDs:  []string{"org_6"},
		},
		{
			name:       "non-graphiti tool with group_id",
			toolName:   "other_search",
			orgID:      "7",
			schema:     map[string]interface{}{"group_id": map[string]interface{}{"type": "string"}},
			args:       map[string]interface{}{"query": "checkout"},
			wantAbsent: true,
		},
		{
			name:       "missing org id",
			toolName:   "graphiti_search_memory_facts",
			orgID:      "",
			schema:     map[string]interface{}{"group_id": map[string]interface{}{"type": "string"}},
			args:       map[string]interface{}{"query": "payments"},
			wantAbsent: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			toolSchema := map[string]interface{}{"properties": tt.schema}
			tool := Tool{Name: tt.toolName, InputSchema: toolSchema}
			EnsureScopedGraphitiArgs(tool, tt.args, tt.orgID)

			if tt.wantAbsent {
				if got := tt.args["group_id"]; got != nil {
					t.Fatalf("group_id = %v, want nil", got)
				}
				if got := tt.args["group_ids"]; got != nil {
					t.Fatalf("group_ids = %v, want nil", got)
				}
				return
			}
			if tt.wantID != nil && tt.args["group_id"] != tt.wantID {
				t.Fatalf("group_id = %v, want %v", tt.args["group_id"], tt.wantID)
			}
			if tt.wantIDs != nil {
				got, ok := tt.args["group_ids"].([]string)
				if !ok {
					t.Fatalf("group_ids = %T(%v), want []string", tt.args["group_ids"], tt.args["group_ids"])
				}
				want := tt.wantIDs.([]string)
				if len(got) != len(want) || got[0] != want[0] {
					t.Fatalf("group_ids = %v, want %v", got, want)
				}
			}
		})
	}
}
