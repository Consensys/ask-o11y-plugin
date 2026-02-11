package rbac

import "consensys-asko11y-app/pkg/mcp"

// IsReadOnlyTool returns true if the tool's annotations mark it as read-only.
func IsReadOnlyTool(tool mcp.Tool) bool {
	if tool.Annotations == nil || tool.Annotations.ReadOnlyHint == nil {
		return false
	}
	return *tool.Annotations.ReadOnlyHint
}

// CanAccessTool checks if a role can access a tool based on its annotations.
func CanAccessTool(role string, tool mcp.Tool) bool {
	if role == "Admin" || role == "Editor" {
		return true
	}
	return IsReadOnlyTool(tool)
}

// FilterToolsByRole filters a tool list based on user role using annotations.
func FilterToolsByRole(tools []mcp.Tool, role string) []mcp.Tool {
	if role == "Admin" || role == "Editor" {
		return tools
	}
	filtered := make([]mcp.Tool, 0, len(tools))
	for _, t := range tools {
		if CanAccessTool(role, t) {
			filtered = append(filtered, t)
		}
	}
	return filtered
}
