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
