package agent

import (
	"encoding/json"
	"fmt"
	"strings"
)

// DefaultMaxTotalTokens was 128,000 until a production cost audit (Aug 2026)
// found the agent loop resending near-max-context on almost every iteration —
// with no prompt caching on the OpenAI-compat LLM transport, each iteration
// billed the full window from scratch. Halved to shrink that per-iteration
// cost; admins can still raise it via PluginSettings.MaxTotalTokens.
const DefaultMaxTotalTokens = 64_000
const defaultRecentMessageCount = 15
const systemMessageBuffer = 1000
const maxToolResponseTokens = 8000
const aggressiveToolResponseTokens = 2000

// highVolumeToolResponseTokens and aggressiveHighVolumeToolResponseTokens cap
// tool results from raw-data query tools (Loki/Prometheus/Tempo/Pyroscope/
// dashboard JSON) tighter than other tools — these dominate context growth
// and are usually redundant once the LLM has already summarized them once.
const highVolumeToolResponseTokens = 3000
const aggressiveHighVolumeToolResponseTokens = 800

// keepRecentToolResults bounds how many of the most recent tool results stay
// in full in the resent context; older ones are replaced by a short
// placeholder via evictStaleToolResults. This is the manual equivalent of
// Anthropic's context-editing (clear_tool_uses) strategy, needed because the
// OpenAI-compat LLM transport has no server-side caching or context editing.
const keepRecentToolResults = 8

// TruncationMarker is the prefix used to detect an existing truncation notice
// so repeated trims in the same run don't stack duplicates.
const TruncationMarker = "[NOTICE: Conversation history truncated."

// TruncationNotice is the synthetic system message injected after the main
// system prompt when TrimMessagesToTokenLimit drops messages from the front
// of the window, so the LLM knows prior context is gone and must re-query.
const TruncationNotice = TruncationMarker + " Earlier messages are no longer visible — re-query tools if you need prior data.]"

// EvictedToolResultMarker prefixes a stale tool result's replacement content
// so repeated eviction passes over the same message are idempotent.
const EvictedToolResultMarker = "[NOTICE: Tool result evicted to save context."

// highVolumeToolNamePatterns match tool names whose results tend to be large,
// raw query output (log lines, metric samples, trace spans, dashboard JSON)
// rather than a short summary. Matched case-insensitively as a substring.
var highVolumeToolNamePatterns = []string{
	"query", "logs", "loki", "prometheus", "tempo", "trace", "pyroscope", "dashboard",
}

func isHighVolumeTool(toolName string) bool {
	lower := strings.ToLower(toolName)
	for _, p := range highVolumeToolNamePatterns {
		if strings.Contains(lower, p) {
			return true
		}
	}
	return false
}

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

	toolNames := toolNamesByCallID(messages)

	trimmed := trimToolResponses(messages, maxToolResponseTokens, highVolumeToolResponseTokens, toolNames)
	if estimateMessagesTokens(trimmed, tools) <= maxTokens {
		return trimmed
	}

	trimmed = trimToolResponses(trimmed, aggressiveToolResponseTokens, aggressiveHighVolumeToolResponseTokens, toolNames)
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

func trimToolResponses(messages []Message, maxTokens, maxTokensHighVolume int, toolNames map[string]string) []Message {
	out := make([]Message, len(messages))
	for i, m := range messages {
		limit := maxTokens
		if isHighVolumeTool(toolNames[m.ToolCallID]) {
			limit = maxTokensHighVolume
		}
		if m.Role == "tool" && EstimateTokens(m.Content) > limit {
			maxChars := limit * 4
			if maxChars > len(m.Content) {
				maxChars = len(m.Content)
			}
			m.Content = m.Content[:maxChars] + "\n[...truncated]"
		}
		out[i] = m
	}
	return out
}

// toolNamesByCallID maps each tool_call id to the function name the assistant
// invoked it with, so later passes (truncation, eviction) can key limits and
// placeholders off the tool name even though the "tool" role message that
// carries the result only stores the call id.
func toolNamesByCallID(messages []Message) map[string]string {
	names := make(map[string]string)
	for _, m := range messages {
		for _, tc := range m.ToolCalls {
			names[tc.ID] = tc.Function.Name
		}
	}
	return names
}

// evictStaleToolResults replaces the content of all but the most recent
// keepRecent tool results with a short placeholder. Without prompt caching on
// the LLM transport, every iteration re-bills the full accumulated tool-call
// history from scratch — this is the manual equivalent of Anthropic's
// context-editing (clear_tool_uses) strategy: it shrinks what's actually
// transmitted instead of relying on a cache discount that isn't available.
// The placeholder names the tool so the model can re-call it if it still
// needs that data. Idempotent: already-evicted messages are left alone.
// toolResultSummarizer condenses a stale tool result's content into a short
// summary the model can keep in context instead of the raw payload. Called at
// most once per tool result (evictStaleToolResults is idempotent), so an
// LLM-backed implementation is a reasonable one-time cost against the much
// larger savings of not resending the raw content every remaining iteration.
type toolResultSummarizer func(toolName, content string) string

func evictStaleToolResults(messages []Message, keepRecent int, summarize toolResultSummarizer, isError func(toolCallID string) bool) []Message {
	if keepRecent <= 0 {
		keepRecent = keepRecentToolResults
	}

	var toolIdx []int
	for i, m := range messages {
		if m.Role == "tool" {
			toolIdx = append(toolIdx, i)
		}
	}
	if len(toolIdx) <= keepRecent {
		return messages
	}

	toolNames := toolNamesByCallID(messages)
	staleIdx := toolIdx[:len(toolIdx)-keepRecent]

	out := make([]Message, len(messages))
	copy(out, messages)
	for _, i := range staleIdx {
		m := out[i]
		if strings.HasPrefix(m.Content, EvictedToolResultMarker) {
			continue
		}
		name := toolNames[m.ToolCallID]
		if name == "" {
			name = "unknown tool"
		}

		var summary string
		if isError != nil && isError(m.ToolCallID) {
			// Error results are short, deterministic diagnostics — one of them
			// is the anti-hallucination "do not fabricate output" directive on
			// transport failures. Never paraphrase these through an LLM; keep
			// the exact wording (truncated only if unexpectedly long).
			summary = truncateWhitespace(m.Content, evictionSummaryFallbackChars)
		} else if summarize != nil {
			summary = strings.TrimSpace(summarize(name, m.Content))
		}
		if summary == "" {
			summary = "no summary available"
		}

		out[i] = Message{
			Role:       m.Role,
			ToolCallID: m.ToolCallID,
			Content:    fmt.Sprintf("%s Tool: %s. Summary: %s Re-call the tool if you need the full data again.]", EvictedToolResultMarker, name, summary),
		}
	}
	return out
}
