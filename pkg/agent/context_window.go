package agent

import (
	"encoding/json"
	"strings"
)

const DefaultMaxTotalTokens = 128_000
const defaultRecentMessageCount = 15
const systemMessageBuffer = 1000
const maxToolResponseTokens = 8000
const aggressiveToolResponseTokens = 2000

// TruncationMarker is the prefix used to detect an existing truncation notice
// so repeated trims in the same run don't stack duplicates.
const TruncationMarker = "[NOTICE: Conversation history truncated."

// TruncationNotice is the synthetic system message injected after the main
// system prompt when TrimMessagesToTokenLimit drops messages from the front
// of the window, so the LLM knows prior context is gone and must re-query.
const TruncationNotice = TruncationMarker + " Earlier messages are no longer visible — re-query tools if you need prior data.]"

func EstimateTokens(text string) int {
	return (len(text) + 3) / 4
}

func estimateMessagesTokens(messages []Message, tools []OpenAITool) int {
	total := 0
	for _, m := range messages {
		total += EstimateTokens(m.Content)
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
		maxTokens = DefaultMaxTotalTokens
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
		// Orphaned tool results cause 400s from OpenAI without a preceding assistant+tool_calls.
		if nonSystem[i].Role == "tool" {
			continue
		}
		candidate := nonSystem[i:]
		test := assembleWithTruncationNotice(systemMsg, candidate, i > 0)
		if estimateMessagesTokens(test, tools) <= target {
			return test
		}
	}

	// Fallback: keep system prompt and only the last non-system message. This drops
	// everything in between, so always mark the history as truncated.
	tail := []Message{}
	if len(nonSystem) > 0 {
		tail = append(tail, nonSystem[len(nonSystem)-1])
	}
	return assembleWithTruncationNotice(systemMsg, tail, len(nonSystem) > 1)
}

// assembleWithTruncationNotice prepends the system prompt followed by a one-shot
// truncation notice (only when messages were dropped and none is already present)
// in front of the trimmed tail. Idempotent — if the tail already contains the
// marker, no duplicate is added.
func assembleWithTruncationNotice(system *Message, tail []Message, dropped bool) []Message {
	out := make([]Message, 0, len(tail)+2)
	if system != nil {
		out = append(out, *system)
	}
	if dropped && !hasTruncationNotice(tail) {
		out = append(out, Message{Role: "system", Content: TruncationNotice})
	}
	out = append(out, tail...)
	return out
}

func hasTruncationNotice(messages []Message) bool {
	for _, m := range messages {
		if m.Role == "system" && strings.Contains(m.Content, TruncationMarker) {
			return true
		}
	}
	return false
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
