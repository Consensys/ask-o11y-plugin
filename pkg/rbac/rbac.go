package rbac

import "consensys-asko11y-app/pkg/mcp"

func IsReadOnlyTool(tool mcp.Tool) bool {
	if tool.Annotations == nil || tool.Annotations.ReadOnlyHint == nil {
		return false
	}
	return *tool.Annotations.ReadOnlyHint
}

func CanAccessTool(role string, tool mcp.Tool) bool {
	if role == "Admin" || role == "Editor" {
		return true
	}
	return IsReadOnlyTool(tool)
}

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
