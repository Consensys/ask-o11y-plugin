package agent

import (
	"consensys-asko11y-app/pkg/mcp"
)

func ConvertMCPToolsToOpenAI(tools []mcp.Tool) []OpenAITool {
	result := make([]OpenAITool, 0, len(tools))
	for _, t := range tools {
		result = append(result, OpenAITool{
			Type: "function",
			Function: OpenAIFunction{
				Name:        t.Name,
				Description: t.Description,
				Parameters:  t.InputSchema,
			},
		})
	}
	return result
}

// isMetaTool reports whether a tool name is an internal capability (skill
// loading, tool discovery) and not a data tool exposed by an MCP server.
// Meta-tools change run state, so they must never be served from the stall
// cache, never count as progress, and never become evidence.
func isMetaTool(name string) bool {
	return name == loadSkillToolName || name == searchToolsToolName
}
