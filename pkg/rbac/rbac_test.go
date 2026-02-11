package rbac

import (
	"consensys-asko11y-app/pkg/mcp"
	"testing"
)

func readOnlyTool(name string) mcp.Tool {
	return mcp.Tool{
		Name:        name,
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}
}

func writeTool(name string) mcp.Tool {
	return mcp.Tool{
		Name:        name,
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: false},
	}
}

func unannotatedTool(name string) mcp.Tool {
	return mcp.Tool{Name: name}
}

func TestIsReadOnlyTool(t *testing.T) {
	tests := []struct {
		name string
		tool mcp.Tool
		want bool
	}{
		{"annotated read-only", readOnlyTool("get_dashboard"), true},
		{"annotated writable", writeTool("create_dashboard"), false},
		{"nil annotations", unannotatedTool("some_tool"), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsReadOnlyTool(tt.tool); got != tt.want {
				t.Errorf("IsReadOnlyTool(%s) = %v, want %v", tt.tool.Name, got, tt.want)
			}
		})
	}
}

func TestCanAccessTool(t *testing.T) {
	ro := readOnlyTool("get_dashboard")
	wr := writeTool("create_dashboard")
	un := unannotatedTool("unknown_tool")

	tests := []struct {
		name string
		role string
		tool mcp.Tool
		want bool
	}{
		{"admin read-only", "Admin", ro, true},
		{"admin writable", "Admin", wr, true},
		{"admin unannotated", "Admin", un, true},
		{"editor read-only", "Editor", ro, true},
		{"editor writable", "Editor", wr, true},
		{"editor unannotated", "Editor", un, true},
		{"viewer read-only", "Viewer", ro, true},
		{"viewer writable", "Viewer", wr, false},
		{"viewer unannotated", "Viewer", un, false},
		{"unknown role writable", "Unknown", wr, false},
		{"unknown role read-only", "Unknown", ro, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := CanAccessTool(tt.role, tt.tool); got != tt.want {
				t.Errorf("CanAccessTool(%s, %s) = %v, want %v", tt.role, tt.tool.Name, got, tt.want)
			}
		})
	}
}

func TestFilterToolsByRole(t *testing.T) {
	tools := []mcp.Tool{
		readOnlyTool("get_dashboard"),
		writeTool("create_dashboard"),
		readOnlyTool("list_datasources"),
		writeTool("delete_dashboard"),
		unannotatedTool("unknown_tool"),
	}

	t.Run("admin gets all", func(t *testing.T) {
		filtered := FilterToolsByRole(tools, "Admin")
		if len(filtered) != 5 {
			t.Errorf("Admin got %d tools, want 5", len(filtered))
		}
	})

	t.Run("editor gets all", func(t *testing.T) {
		filtered := FilterToolsByRole(tools, "Editor")
		if len(filtered) != 5 {
			t.Errorf("Editor got %d tools, want 5", len(filtered))
		}
	})

	t.Run("viewer gets read-only only", func(t *testing.T) {
		filtered := FilterToolsByRole(tools, "Viewer")
		if len(filtered) != 2 {
			t.Errorf("Viewer got %d tools, want 2", len(filtered))
		}
		for _, tool := range filtered {
			if !IsReadOnlyTool(tool) {
				t.Errorf("Viewer got non-read-only tool: %s", tool.Name)
			}
		}
	})

	t.Run("empty list", func(t *testing.T) {
		filtered := FilterToolsByRole([]mcp.Tool{}, "Viewer")
		if len(filtered) != 0 {
			t.Errorf("Expected empty, got %d", len(filtered))
		}
	})
}
