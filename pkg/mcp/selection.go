package mcp

import "strings"

// IsToolEnabled reports whether a tool is enabled by per-server user selections.
// Tool names from external MCP servers are prefixed "{serverID}_". Tools without
// a known server prefix (built-in or embedded Grafana MCP) are always enabled.
func IsToolEnabled(toolName string, servers []ServerConfig) bool {
	serverID, _ := resolveServerPrefix(toolName, servers)
	if serverID == "" {
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

// resolveServerPrefix returns the ID of the configured server that owns
// toolName, and the tool name without that prefix. Server IDs may contain
// underscores, so the longest matching "id_" prefix wins — the same rule as
// Proxy.ServerIDForTool. An empty server ID means no configured server owns
// the name.
func resolveServerPrefix(toolName string, servers []ServerConfig) (serverID, unprefixed string) {
	best := ""
	for _, s := range servers {
		if len(s.ID) > len(best) && strings.HasPrefix(toolName, s.ID+"_") {
			best = s.ID
		}
	}
	if best == "" {
		return "", toolName
	}
	return best, toolName[len(best)+1:]
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

// EnsureScopedGraphitiArgs forces org-scoped Graphiti tools to use the current
// Grafana org group when the tool schema accepts group_id or group_ids.
func EnsureScopedGraphitiArgs(tool Tool, args map[string]interface{}, orgID string) {
	if orgID == "" || args == nil || !isGraphitiTool(tool.Name) {
		return
	}

	properties, ok := tool.InputSchema["properties"].(map[string]interface{})
	if !ok {
		return
	}

	groupID := "org_" + orgID

	// Always force org scope. LLM-supplied values are not trusted because they
	// could break multi-org data isolation.
	if properties["group_id"] != nil {
		args["group_id"] = groupID
	}
	if properties["group_ids"] != nil {
		args["group_ids"] = []string{groupID}
	}
}

func isGraphitiTool(name string) bool {
	if strings.HasPrefix(name, "graphiti_") || strings.Contains(name, "_graphiti_") {
		return true
	}

	for _, baseName := range graphitiBaseToolNames {
		if name == baseName || strings.HasSuffix(name, "_"+baseName) {
			return true
		}
	}
	return false
}

var graphitiBaseToolNames = []string{
	"add_memory",
	"search_memory_facts",
	"search_memory_nodes",
	"delete_entity_edge",
	"delete_episode",
	"clear_graph",
}
