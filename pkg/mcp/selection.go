package mcp

import "strings"

// IsToolEnabled reports whether a tool is enabled by per-server user selections.
// Tool names from external MCP servers are prefixed "{serverID}_". Tools without
// a known server prefix (built-in or embedded Grafana MCP) are always enabled.
func IsToolEnabled(toolName string, servers []ServerConfig) bool {
	serverID, _, ok := strings.Cut(toolName, "_")
	if !ok {
		return true
	}
	for _, s := range servers {
		if s.ID != serverID {
			continue
		}
		if !s.Enabled {
			return false
		}
		if sel, found := s.ToolSelections[toolName]; found {
			return sel
		}
		return true
	}
	return true
}

// FilterToolsBySelection returns tools allowed by the user's per-server selections.
func FilterToolsBySelection(tools []Tool, servers []ServerConfig) []Tool {
	if len(servers) == 0 {
		return tools
	}
	result := make([]Tool, 0, len(tools))
	for _, t := range tools {
		if IsToolEnabled(t.Name, servers) {
			result = append(result, t)
		}
	}
	return result
}
