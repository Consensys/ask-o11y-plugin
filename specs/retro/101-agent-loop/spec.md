# Retro-Spec: Agent Loop and SSE Streaming
**Capability ID**: `101-agent-loop`
**Status**: Retrospective
**Last verified**: `6c09d13`
**Owner**: Ask O11y maintainers
**Module**: `pkg/agent`, `pkg/plugin`

---
## Purpose
A user sends one message and receives a streamed investigation. The loop calls the LLM and MCP tools until it writes a final answer. Every step reaches the browser as an SSE event.
## Actors and RBAC
| Capability | Admin | Editor | Viewer | Evidence |
|---|---|---|---|---|
| Start an agent run | yes | yes | yes | `pkg/plugin/plugin.go:871` |
| Read or cancel own run | yes | yes | yes | `pkg/plugin/plugin.go:1336` |
| Approve a gated tool call | yes | yes | no | `pkg/plugin/plugin.go:1449` |
| Call a write tool | yes | yes | no | `pkg/rbac/rbac.go:12` |
| Load a skill (`load_skill`) | yes | yes | yes | `pkg/agent/loop.go:954` |
A run is readable and cancellable only by its owning user in its owning org. The check compares `run.OrgID` and `run.UserID` with the request identity. `VERIFIED` — `pkg/plugin/plugin.go:1336`
## Contract
### HTTP endpoints
| Method | Path | Handler | Evidence |
|---|---|---|---|
| POST | `/api/agent/run` | `handleAgentRun` | `pkg/plugin/plugin.go:588` |
| GET | `/api/agent/runs/{runId}` | `handleAgentRuns` | `pkg/plugin/plugin.go:1428` |
| GET | `/api/agent/runs/{runId}/events` | `handleAgentRunEvents` | `pkg/plugin/plugin.go:1602` |
| POST | `/api/agent/runs/{runId}/cancel` | `handleCancelRun` | `pkg/plugin/plugin.go:1579` |
| POST | `/api/agent/runs/{runId}/approvals/{approvalId}` | `handleAgentApproval` | `pkg/plugin/plugin.go:1443` |
`POST /api/agent/run` does not stream. It returns JSON with `runId`, `sessionId`, `status`, `model`, and `modelSource`. `VERIFIED` — `pkg/plugin/plugin.go:1178`
### SSE events
| Event | Payload fields | Evidence |
|---|---|---|
| `run_started` | `runId`, `sessionId`, `skills[]` (`name`, `description`) | `pkg/agent/types.go:219` |
| `tool_call_start` | `id`, `name`, `arguments` | `pkg/agent/types.go:81` |
| `tool_call_result` | `id`, `name`, `content`, `isError`, `errorKind` | `pkg/agent/types.go:87` |
| `evidence` | `id`, `title`, `summary`, `source`, `toolName`, `query`, `datasourceUid`, `timeRange` | `pkg/agent/types.go:98` |
| `tools_activated` | `query`, `tools[]` (`name`, `description`), `evicted[]` | `pkg/agent/search_tools.go:339` |
| `approval_request` | `approvalId`, `toolCallId`, `toolName`, `risk`, `reason`, `arguments` | `pkg/agent/types.go:109` |
| `approval_resolved` | `approvalId`, `decision`, `comment`, `resolvedAt` | `pkg/agent/types.go:118` |
| `stall` | `kind`, `iteration`, `message` | `pkg/agent/types.go:189` |
| `mcp_unavailable` | `message` | `pkg/agent/types.go:162` |
| `final_report` | `verdict`, `confidence`, `summary`, `evidenceIds`, `gaps`, `nextSteps`, `hypotheses`, `validation` | `pkg/agent/types.go:147` |
| `content` | `content` | `pkg/agent/types.go:77` |
| `done` | `totalIterations`, `promptTokens`, `completionTokens`, `totalTokens`, `toolCallCount`, `usageByModel`, `stallNudges`, `forcedFinal` | `pkg/agent/types.go:173` |
| `error` | `message`, `code`, `statusCode`, `requestId`, `retryable` | `pkg/agent/types.go:195` |
The run store adds `sequence` to every event (`pkg/plugin/runstore.go:183`). The loop leaves it at zero. `VERIFIED` — `pkg/plugin/runstore.go:184`
### Configuration keys
| Key | Location | Default | Evidence |
|---|---|---|---|
| `maxIterations` | skill entry | 0 (unset) | `pkg/skills/registry.go:42` |
| `maxTotalTokens` | plugin jsonData | 64000 | `pkg/agent/context_window.go:16` |
| `maxParallelToolCalls` | plugin jsonData | 4 | `pkg/plugin/plugin.go:184` |
| `approvalPolicy` | plugin jsonData | `approval-gated-writes` | `pkg/plugin/plugin.go:181` |
| `recentMessageCount` | plugin jsonData | 10 | `pkg/plugin/plugin.go:282` |
### MCP tool names
| Tool | Read-only | Evidence |
|---|---|---|
| `load_skill` | yes (internal, never sent to MCP) | `pkg/agent/loop.go:45` |
| `search_tools` | yes (internal, never sent to MCP) | `pkg/agent/search_tools.go:28` |
## Behaviour Rules
1. The run returns immediately and the loop runs on a detached context. `VERIFIED` — `pkg/plugin/plugin.go:1162`
2. The loop starts in one goroutine and the event consumer in another. `VERIFIED` — `pkg/plugin/plugin.go:1169`
3. The iteration cap is `LoopRequest.MaxIterations`; zero or less becomes 25. `VERIFIED` — `pkg/agent/loop.go:145`
4. The plugin sets the cap from the highest skill `maxIterations`, then from `resolveMaxIterations`. `VERIFIED` — `pkg/plugin/plugin.go:1123`
5. `resolveMaxIterations` returns 50 for chat and 60 for alert investigations. `VERIFIED` — `pkg/plugin/config.go:45`
6. Alert investigation means `type == "investigation"` or a matching firing-alert phrase. `VERIFIED` — `pkg/plugin/iteration_budget.go:18`
7. A near-limit system warning is injected once, at iteration `maxIter-2`. `VERIFIED` — test `TestAgentLoop_NearLimitWarningInjected`
8. `run_started` is the first event and appears only when `RunID` is set. `VERIFIED` — `pkg/agent/loop.go:189`
9. Every tool call emits `tool_call_start` before any execution in the batch. `VERIFIED` — `pkg/agent/loop.go:564`
10. Every tool call emits `tool_call_result`, in the original call order. `VERIFIED` — test `TestAgentLoop_ParallelToolCallsPreserveOrder`
11. `mcp_unavailable` is emitted once, after two distinct tools fail with transport errors. `VERIFIED` — `pkg/agent/loop.go:681`
12. Exact duplicate calls replay the cached result with an "already executed" note instead of running again. `VERIFIED` — test `TestAgentLoop_ExactDuplicateCallReplaysCache`
13. The stall guard nudges after 3 repetition events, then after 4 no-progress iterations. `VERIFIED` — `pkg/agent/stall.go:22`
14. A second stalled episode forces a final answer and shortens the budget to `iteration+2`. `VERIFIED` — `pkg/agent/loop.go:726`
15. On a turn with tool calls, the assistant text is cleared before the message enters history. `VERIFIED` — `pkg/agent/loop.go:532`
16. A final text turn emits `final_report`, then `content`, then `done`. `VERIFIED` — test `TestAgentLoop_SimpleTextResponse`
17. A fenced `rca-report` block is parsed, validated, and stripped from the visible content. `VERIFIED` — `pkg/agent/report.go:47`
18. An invalid report gets one repair turn when budget remains; later failures are appended to `gaps`. `VERIFIED` — `pkg/agent/loop.go:475`
19. Report validation checks evidence ids, RFC3339 `firstSeen`, and topology edges. `VERIFIED` — `pkg/agent/report.go:95`
20. `done` reports iterations, token totals, tool-call count, and per-model usage, then ends the loop. `VERIFIED` — test `TestAgentLoop_AccumulatesUsageAndToolCallsIntoDoneEvent`
21. An LLM failure emits `error` and returns without `done`. `VERIFIED` — `pkg/agent/loop.go:357`
22. An interrupted LLM stream is retried once; a second failure yields code `llm_incomplete_stream`. `VERIFIED` — `pkg/agent/llm_client.go:222`
23. An HTTP LLM failure yields code `llm_http_<status>` and the upstream status. `VERIFIED` — `pkg/agent/llm_client.go:61`
24. Exhausting the iteration cap emits `error` with the max-iteration message and no error code. `VERIFIED` — test `TestAgentLoop_MaxIterations`
25. Cancelling a run calls the stored cancel function; a finished run returns 409. `VERIFIED` — `pkg/plugin/plugin.go:1585`
26. A cancelled loop returns before any `done` event. `VERIFIED` — test `TestAgentLoop_ContextCancellation`
27. `load_skill` is intercepted before MCP dispatch and never reaches the proxy or the RBAC check. `VERIFIED` — `pkg/agent/loop.go:954`
28. `load_skill` is advertised only when the skill catalog and the loader are both present. `VERIFIED` — `pkg/agent/loop.go:180`
29. A `load_skill` failure returns a normal tool error to the model. `VERIFIED` — test `TestAgentLoop_LoadSkillErrorSurfacesAsToolError`
30. Meta-tools never use the stall cache, never count as progress, and never become evidence. `VERIFIED` — `pkg/agent/tools.go:26`
31. A truncated tool call is retried once, then aborts with retryable code `llm_truncated_tool_call`. `VERIFIED` — `pkg/agent/loop.go:405`
32. The SSE endpoint replays the stored list first, then forwards live events. `VERIFIED` — test `TestHandleAgentRunEvents_ForwardsNewEvents`
33. A live sequence gap closes the stream so the client can replay from storage. `VERIFIED` — test `TestHandleAgentRunEvents_StopsAtLiveSequenceGap`
34. The SSE endpoint sends a `: keepalive` comment every 15 seconds. `VERIFIED` — `pkg/plugin/plugin.go:1642`
35. A finished run closes the SSE stream after the replay. `VERIFIED` — `pkg/plugin/plugin.go:1635`
36. The published OpenAPI contract states a 25-iteration cap. `GAP` — `pkg/plugin/openapi/openapi.json:499` contradicts rules 4 and 5 (50 and 60).
## Invariants
- `Run` closes `eventCh` exactly once, on every return path. `VERIFIED` — `pkg/agent/loop.go:143`
- An event send aborts on context cancellation instead of blocking forever. `VERIFIED` — `pkg/agent/loop.go:1245`
- Tool results append to history in the same order as the assistant tool calls. `VERIFIED` — `pkg/agent/loop.go:619`
- The RBAC filter runs before the model sees any tool definition. `VERIFIED` — `pkg/agent/loop.go:162`
- Event sequence numbers increase monotonically per run. `VERIFIED` — `pkg/plugin/runstore.go:183`
- A cancelled run never emits `done`. `VERIFIED` — test `TestAgentLoop_ContextCancellation`
## Failure Modes
| Condition | User-visible result | Evidence |
|---|---|---|
| LLM app returns 401 or 403 | `error`, code `llm_http_401`, message names the service-account token | `pkg/agent/llm_client.go:75` |
| LLM app returns 429 | `error`, code `llm_http_429`, retryable | `pkg/agent/llm_client.go:79` |
| LLM app returns 5xx | `error`, code `llm_http_5xx`, retryable | `pkg/agent/llm_client.go:82` |
| Stream ends without `finish_reason` twice | `error`, code `llm_incomplete_stream`, retryable | `pkg/agent/loop.go:864` |
| Tool arguments are truncated and no retry is left | `error`, code `llm_truncated_tool_call`, retryable | `pkg/agent/loop.go:405` |
| Iteration cap reached | `error` "Agent loop reached maximum iterations (N)" | `pkg/agent/loop.go:740` |
| MCP tool listing fails | none; the run continues with an empty tool set | `pkg/agent/loop.go:158` |
| User cancels | no terminal event; run status becomes `cancelled` | `pkg/plugin/plugin.go:1258` |
## Data and Persistence
| Store | Key or table | TTL | Fallback | Evidence |
|---|---|---|---|---|
| Run store | `runID` → events, trace, status | 1 hour (`RunMaxAge`) | none | `pkg/plugin/config.go:47` |
| Event list | per-run slice | capped at 500 events | oldest events dropped | `pkg/plugin/runstore.go:186` |
| Cancel registry | `p.runCancels[runID]` | deleted when the consumer exits | no cancel | `pkg/plugin/plugin.go:1173` |
## Observability
| Signal | Name | Where | Evidence |
|---|---|---|---|
| Span | `agent_run` | OTel tracer | `pkg/plugin/plugin.go:877` |
| Span | `llm_call` | OTel tracer | `pkg/agent/llm_client.go:134` |
| Span | `mcp_tool_call` | OTel tracer | `pkg/agent/loop.go:961` |
| Metric | `asko11y_agent_user_tokens_total` | Prometheus scrape | `pkg/plugin/metrics.go:19` |
| Log field | `runId`, `sessionId`, `iteration`, `toolCallCount` | plugin logger | `pkg/plugin/plugin.go:1103` |
## Evidence Index
- `pkg/agent/loop.go:142` — `Run` signature and channel ownership
- `pkg/agent/loop.go:279` — iteration loop
- `pkg/agent/loop.go:516` — `done` construction
- `pkg/agent/loop.go:829` — large-to-base fallback
- `pkg/plugin/plugin.go:1188` — `consumeAgentEvents` persists stats and terminal status
- `pkg/plugin/runstore.go:176` — sequence assignment and event cap
## Known Gaps
- The OpenAPI description says 25 iterations; the code uses 50 and 60. A forward spec must sync the published contract.
- No SSE event reports context truncation or tool-result eviction. The user cannot tell that older evidence was dropped.
- `ListToolsWithContext` failure is logged only. The run continues with no tools, which conflicts with Principle IV.
- A cancelled run emits no terminal event. A client that only watches SSE sees a closed stream with no reason.
