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
