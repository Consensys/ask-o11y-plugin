# Retro-Spec: Context Window and Eviction

**Capability ID**: `103-context-window`

**Status**: Retrospective

**Last verified**: `6c09d13`

**Owner**: Ask O11y maintainers

**Module**: `pkg/agent`

---
## Purpose
The agent fits a long investigation into the model context window. It trims large tool results and evicts stale ones instead of failing the request.
## Actors and RBAC
| Capability | Admin | Editor | Viewer | Evidence |
|---|---|---|---|---|
| Use the default context limits | yes | yes | yes | `pkg/agent/context_window.go:51` |
| Override limits in plugin settings | yes | no | no | `pkg/plugin/plugin.go:200` |
| Disable eviction summarization | yes | no | no | `pkg/plugin/plugin.go:207` |
No role sees different context rules. The limits are plugin-wide. `VERIFIED` — `pkg/agent/context_window.go:51`
## Contract
### HTTP endpoints
| Method | Path | Handler | Evidence |
|---|---|---|---|
| POST | `/api/agent/run` | `handleAgentRun` (passes limits into the loop) | `pkg/plugin/plugin.go:1133` |
The limits arrive through the run request only. `VERIFIED` — `pkg/plugin/plugin.go:1133`
### SSE events
| Event | Payload fields | Evidence |
|---|---|---|
| none | trimming and eviction are silent | `pkg/agent/loop.go:308` |
### Configuration keys
| Key | Location | Default | Evidence |
|---|---|---|---|
| `maxTotalTokens` | plugin jsonData | 64000 | `pkg/agent/context_window.go:16` |
| `recentMessageCount` | plugin jsonData | 10 | `pkg/plugin/plugin.go:283` |
| `keepRecentToolResults` | plugin jsonData | 8 | `pkg/agent/context_window.go:35` |
| `maxToolResponseTokens` | plugin jsonData | 8000 | `pkg/agent/context_window.go:24` |
| `aggressiveToolResponseTokens` | plugin jsonData | 2000 | `pkg/agent/context_window.go:25` |
| `maxHighVolumeToolResponseTokens` | plugin jsonData | 3000 | `pkg/agent/context_window.go:26` |
| `aggressiveHighVolumeToolResponseTokens` | plugin jsonData | 800 | `pkg/agent/context_window.go:27` |
| `toolCallSummarizationDisabled` | plugin jsonData | false | `pkg/plugin/plugin.go:207` |
### MCP tool names
| Tool | Read-only | Evidence |
|---|---|---|
| names containing `query`, `logs`, `loki`, `prometheus`, `tempo`, `trace`, `pyroscope`, or `dashboard` | n/a — tighter trim caps apply | `pkg/agent/context_window.go:86` |
## Behaviour Rules
1. The window is the system prompt, an optional summary, and the last `recentMessageCount` messages. `VERIFIED` — `pkg/agent/context_window.go:160`
2. The recent count falls back to 15 when unset. `VERIFIED` — `pkg/agent/context_window.go:17`
3. The summary is injected only when it is non-empty and history is longer than the recent count. `VERIFIED` — `pkg/agent/context_window.go:168`
4. Empty assistant messages with no tool calls are dropped. `VERIFIED` — test `TestSanitizeMessages`
5. Trimming runs on every iteration before the LLM call. `VERIFIED` — `pkg/agent/loop.go:308`
6. Trimming triggers only when the estimate exceeds the prompt budget. `VERIFIED` — `pkg/agent/context_window.go:206`
7. The estimate counts message content, tool-call arguments, tool-call ids, and tool definitions. `VERIFIED` — `pkg/agent/context_window.go:142`
8. The estimate uses 4 characters per token for prose and 2.5 for structured content. `VERIFIED` — `pkg/agent/context_window.go:110`
9. Content is structured when fewer than 55% of its runes are letters. `VERIFIED` — test `TestEstimateTokens_StructuredContentGetsTighterRatio`
10. The first trim pass caps each tool result at 8000 tokens, or 3000 for a high-volume tool. `VERIFIED` — `pkg/agent/context_window.go:212`
11. The second pass caps each tool result at 2000 tokens, or 800 for a high-volume tool. `VERIFIED` — test `TestTrimToolResponses_HighVolumeToolGetsTighterLimit`
12. A trimmed tool result ends with `[...truncated]`. `VERIFIED` — `pkg/agent/context_window.go:298`
13. The third pass drops the oldest non-system messages until the estimate fits. `VERIFIED` — `pkg/agent/context_window.go:231`
14. The third pass never starts the retained tail on a `tool` message. `VERIFIED` — `pkg/agent/context_window.go:233`
15. The third pass reserves 1000 tokens for the system prompt before it measures the tail. `VERIFIED` — `pkg/agent/context_window.go:229`
16. A dropped-history run gets one truncation notice after the system prompt. `VERIFIED` — `pkg/agent/context_window.go:261`
17. The notice is not duplicated because detection uses the marker prefix. `VERIFIED` — test `TestTrimMessagesToTokenLimit_TruncationNoticeIsIdempotent`
18. The final fallback keeps the system prompt and the last message only. `VERIFIED` — `pkg/agent/context_window.go:243`
19. The system prompt is never dropped. `VERIFIED` — `pkg/agent/context_window.go:258`
20. Eviction triggers when the run holds more than `keepRecent` tool results. `VERIFIED` — `pkg/agent/context_window.go:348`
21. Eviction replaces every tool result older than the newest `keepRecent` with a placeholder. `VERIFIED` — test `TestEvictStaleToolResults_EvictsOldestKeepsNewest`
22. The placeholder names the tool, carries a summary, and keeps the evidence id header. `VERIFIED` — `pkg/agent/context_window.go:386`
23. An already-evicted result is left unchanged. `VERIFIED` — `pkg/agent/context_window.go:359`
24. An error result is never LLM-summarized; it is whitespace-truncated to 300 characters. `VERIFIED` — test `TestEvictStaleToolResults_ErrorResultsSkipSummarizerVerbatim`
25. A summary is requested once per result, from the `base` model, with a 200-token cap. `VERIFIED` — `pkg/agent/loop.go:50`
26. The summary input is capped at 20000 characters. `VERIFIED` — `pkg/agent/loop.go:51`
27. A failed, empty, or unusable summary falls back to a 300-character truncation. `VERIFIED` — `pkg/agent/loop.go:52`
28. Summaries start in the background as soon as a successful tool result is appended. `VERIFIED` — `pkg/agent/loop.go:676`
29. Disabling summarization replaces the summary with a plain 300-character truncation. `VERIFIED` — `pkg/agent/loop.go:288`
30. A single tool result is capped at ingestion to 8000 tokens. `VERIFIED` — test `TestCapToolResultAtIngestion`
31. The ingestion cap appends a notice that tells the model to narrow the query. `VERIFIED` — `pkg/agent/context_window.go:404`
32. The user receives no event when trimming or eviction happens. `GAP` — `pkg/agent/loop.go:308`
33. The conversation-summary branch is never used in production because the plugin never sets `LoopRequest.Summary`. `GAP` — `pkg/plugin/plugin.go:1128`
34. Eviction summary tokens are recorded only as `base` model usage, with no dedicated counter. `GAP` — `pkg/agent/loop.go:810`
## Invariants
- The system prompt is always the first message when trimming returns. `VERIFIED` — `pkg/agent/context_window.go:166`
- A retained tail never begins with an orphan `tool` message. `VERIFIED` — `pkg/agent/context_window.go:233`
- Trimming and eviction are idempotent across iterations. `VERIFIED` — `pkg/agent/context_window.go:359`
- Error text from a transport failure is never paraphrased. `VERIFIED` — `pkg/agent/context_window.go:368`
- An evicted result keeps its run-local evidence id. `VERIFIED` — `pkg/agent/context_window.go:394`
## Failure Modes
| Condition | User-visible result | Evidence |
|---|---|---|
| One tool result is huge | result is cut at ingestion with a narrowing notice | `pkg/agent/context_window.go:408` |
| Context still over budget after two trim passes | oldest messages are dropped | `pkg/agent/context_window.go:231` |
| Summary model call fails | placeholder carries a truncated raw result | `pkg/agent/loop.go:804` |
| Summary future is missing at eviction time | synchronous summary fallback | `pkg/agent/loop.go:297` |
| Summarization is disabled | placeholder carries a 300-character truncation | `pkg/agent/loop.go:288` |
| Run is cancelled while a summary waits | empty summary, then "no summary available" | `pkg/agent/context_window.go:377` |
## Data and Persistence
| Store | Key or table | TTL | Fallback | Evidence |
|---|---|---|---|---|
| Message history | in-memory slice per run | run lifetime | none | `pkg/agent/loop.go:184` |
| Pending summaries | `pendingSummaries[toolCallID]` | run lifetime | synchronous summary | `pkg/agent/loop.go:277` |
| Token usage | `usageByModel["base"]` | run lifetime | none | `pkg/agent/loop.go:810` |
## Observability
| Signal | Name | Where | Evidence |
|---|---|---|---|
| Span | `llm_call` for each eviction summary | OTel tracer | `pkg/agent/llm_client.go:134` |
| Metric | `asko11y_agent_user_tokens_total` with `model="base"` | Prometheus scrape | `pkg/plugin/metrics.go:19` |
| Log field | `iteration`, `messageCount`, `toolCount` | plugin logger, debug | `pkg/agent/loop.go:310` |
| Log field | `error`, `tool` on summary failure | plugin logger, warn | `pkg/agent/loop.go:804` |
## Evidence Index
- `pkg/agent/context_window.go:51` — `withDefaults`
- `pkg/agent/context_window.go:113` — `EstimateTokens`
- `pkg/agent/context_window.go:200` — `TrimMessagesToTokenLimit`
- `pkg/agent/context_window.go:277` — `trimToolResponses`
- `pkg/agent/context_window.go:337` — `evictStaleToolResults`
- `pkg/agent/context_window_test.go` — `TestBuildContextWindow`, `TestTrimMessagesToTokenLimit_DropsOldMessages`, `TestTrimMessagesToTokenLimit_TruncationNoticeIsIdempotent`, `TestEstimateTokens`, `TestEvictStaleToolResults_EvictsOldestKeepsNewest`, `TestEvictStaleToolResults_ErrorResultsSkipSummarizerVerbatim`, `TestContextLimitsWithDefaults`, `TestCapToolResultAtIngestion`
## Known Gaps
- Truncation and eviction are invisible to the user. A forward spec should add a status event or a UI badge.
- The `Summary` path in `BuildContextWindow` is unreachable from the plugin. Either remove it or wire it.
- Summary cost has no dedicated metric, so its share of token spend is unknown.
- High-volume detection is a substring match on the tool name. A renamed tool silently loses the tighter cap.
- Eviction summarization has no per-run budget. A long run can issue one `base` call per tool result.
