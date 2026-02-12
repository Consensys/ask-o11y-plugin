package agent

import (
	"encoding/json"
	"strings"
)

const defaultMaxTotalTokens = 100_000
const defaultRecentMessageCount = 15
const systemMessageBuffer = 1000
const maxToolResponseTokens = 8000
const aggressiveToolResponseTokens = 2000

func EstimateTokens(text string) int {
	return (len(text) + 3) / 4
}

func estimateMessagesTokens(messages []Message, tools []OpenAITool) int {
	total := 0
	for _, m := range messages {
		total += EstimateTokens(m.Content) + EstimateTokens(m.ReasoningContent)
		if m.ToolCallID != "" {
			total += 10
		}
		for _, tc := range m.ToolCalls {
			total += EstimateTokens(tc.Function.Arguments) + EstimateTokens(tc.Function.Name) + 10
		}
	}
	for _, t := range tools {
		b, _ := json.Marshal(t)
		total += EstimateTokens(string(b))
	}
	return total
}

func BuildContextWindow(systemPrompt string, allMessages []Message, summary string, recentCount int) []Message {
	if recentCount <= 0 {
		recentCount = defaultRecentMessageCount
	}

	ctx := make([]Message, 0, recentCount+3)
	ctx = append(ctx, Message{Role: "system", Content: systemPrompt})

	if summary != "" && len(allMessages) > recentCount {
		ctx = append(ctx, Message{
			Role:    "system",
			Content: "[Previous conversation summary: " + summary + "]",
		})
	}

	start := 0
	if len(allMessages) > recentCount {
		start = len(allMessages) - recentCount
	}
	ctx = append(ctx, allMessages[start:]...)

	return sanitizeMessages(ctx)
}

// sanitizeMessages drops empty assistant messages that appear when a user stops
// generation before any content streams back (OpenAI rejects these with 400).
func sanitizeMessages(messages []Message) []Message {
	out := make([]Message, 0, len(messages))
	for _, m := range messages {
		if m.Role == "assistant" && strings.TrimSpace(m.Content) == "" && len(m.ToolCalls) == 0 {
			continue
		}
		out = append(out, m)
	}
	return out
}

func TrimMessagesToTokenLimit(messages []Message, tools []OpenAITool, maxTokens int) []Message {
	if maxTokens <= 0 {
		maxTokens = defaultMaxTotalTokens
	}

	if estimateMessagesTokens(messages, tools) <= maxTokens {
		return messages
	}

	trimmed := trimToolResponses(messages, maxToolResponseTokens)
	if estimateMessagesTokens(trimmed, tools) <= maxTokens {
		return trimmed
	}

	trimmed = trimToolResponses(trimmed, aggressiveToolResponseTokens)
	if estimateMessagesTokens(trimmed, tools) <= maxTokens {
		return trimmed
	}

	var systemMsg *Message
	nonSystem := trimmed
	if len(trimmed) > 0 && trimmed[0].Role == "system" {
		systemMsg = &trimmed[0]
		nonSystem = trimmed[1:]
	}

	target := maxTokens - systemMessageBuffer

	for i := 0; i < len(nonSystem); i++ {
		// Skip into the middle of a tool-call group to avoid orphaned tool results.
		// A "tool" message without its preceding assistant+tool_calls is invalid.
		if nonSystem[i].Role == "tool" {
			continue
		}
		candidate := nonSystem[i:]
		var test []Message
		if systemMsg != nil {
			test = append([]Message{*systemMsg}, candidate...)
		} else {
			test = candidate
		}
		if estimateMessagesTokens(test, tools) <= target {
			return test
		}
	}

	var result []Message
	if systemMsg != nil {
		result = append(result, *systemMsg)
	}
	if len(nonSystem) > 0 {
		result = append(result, nonSystem[len(nonSystem)-1])
	}
	return result
}

func trimToolResponses(messages []Message, maxTokens int) []Message {
	out := make([]Message, len(messages))
	for i, m := range messages {
		if m.Role == "tool" && EstimateTokens(m.Content) > maxTokens {
			maxChars := maxTokens * 4
			if maxChars > len(m.Content) {
				maxChars = len(m.Content)
			}
			m.Content = m.Content[:maxChars] + "\n[...truncated]"
		}
		out[i] = m
	}
	return out
}
