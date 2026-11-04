# Retro-Spec: Tool Dispatch, Search, and Index

**Capability ID**: `104-tool-dispatch`

**Status**: Retrospective

**Last verified**: `6c09d13`

**Owner**: Ask O11y maintainers

**Module**: `pkg/agent`

---
## Purpose
The agent turns an LLM tool call into one MCP call. When the tool catalog is large, the model discovers tools on demand instead of receiving every definition.
## Actors and RBAC
| Capability | Admin | Editor | Viewer | Evidence |
|---|---|---|---|---|
| See every MCP tool | yes | yes | no | `pkg/agent/loop.go:161` |
| See read-only MCP tools | yes | yes | yes | `pkg/rbac/rbac.go:19` |
| Call a listed tool | yes | yes | read-only only | `pkg/agent/loop.go:974` |
| Use `search_tools` | yes | yes | yes | `pkg/agent/search_tools.go:347` |
| Exceed the activated-tool cap | no | no | no | `pkg/agent/search_tools.go:222` |
RBAC applies at listing and again at execution. The index is built from the already-filtered set, so search cannot reveal a forbidden tool. `VERIFIED` — `pkg/agent/loop.go:161`
## Contract
### HTTP endpoints
| Method | Path | Handler | Evidence |
|---|---|---|---|
| POST | `/api/agent/run` | `handleAgentRun` (dispatch happens inside the loop) | `pkg/plugin/plugin.go:588` |
The agent path has no dedicated route. The direct MCP edge is `POST /api/mcp/call-tool`. `VERIFIED` — `pkg/plugin/plugin.go:586`
### SSE events
| Event | Payload fields | Evidence |
|---|---|---|
| `tool_call_start` | `id`, `name`, `arguments` | `pkg/agent/types.go:81` |
| `tool_call_result` | `id`, `name`, `content`, `isError`, `errorKind` | `pkg/agent/types.go:87` |
| `tools_activated` | `query`, `tools[]` (`name`, `description`), `evicted[]` | `pkg/agent/search_tools.go:339` |
### Configuration keys
| Key | Location | Default | Evidence |
|---|---|---|---|
| `toolSearch.mode` | plugin jsonData | `auto` | `pkg/agent/search_tools.go:72` |
| `toolSearch.budgetTokens` | plugin jsonData | 6000 | `pkg/agent/search_tools.go:33` |
| `toolSearch.maxActiveTools` | plugin jsonData | 24 | `pkg/agent/search_tools.go:36` |
| `toolSearch.activationTokenBudget` | plugin jsonData | 12000 | `pkg/agent/search_tools.go:40` |
| `toolSearch.alwaysInclude` | plugin jsonData | empty | `pkg/agent/search_tools.go:63` |
| `maxParallelToolCalls` | plugin jsonData | 4 | `pkg/plugin/plugin.go:185` |
### MCP tool names
| Tool | Read-only | Evidence |
|---|---|---|
| `{serverID}_{toolName}` for external servers | per tool annotation | `pkg/mcp/client.go:466` |
| `mcp-grafana_*` for the built-in server | per tool annotation | `pkg/plugin/plugin.go:87` |
| `search_tools` | yes (internal) | `pkg/agent/search_tools.go:28` |
| `load_skill` | yes (internal) | `pkg/agent/loop.go:45` |
## Behaviour Rules
1. The loop lists MCP tools once per run with the user identity in context. `VERIFIED` — `pkg/agent/loop.go:156`
2. A listing failure logs an error and continues with an empty tool set. `VERIFIED` — `pkg/agent/loop.go:157`
3. RBAC filters the tool list before the model sees it. `VERIFIED` — `pkg/agent/loop.go:161`
4. Per-server selection filters the list next. `VERIFIED` — `pkg/agent/loop.go:162`
5. `ExcludeToolNames` removes names from the advertised list. `VERIFIED` — `pkg/agent/loop.go:163`
6. The runtime builds the index from the filtered set. `VERIFIED` — `pkg/agent/loop.go:176`
7. Tool definitions are rebuilt every iteration so new activations appear. `VERIFIED` — `pkg/agent/loop.go:303`
8. Dispatch order is `search_tools`, then `load_skill`, then the approval gate. `VERIFIED` — `pkg/agent/loop.go:949`
9. `search_tools` runs only when discovery is enabled for the run. `VERIFIED` — `pkg/agent/search_tools.go:349`
10. Every other call resolves the tool by exact name in the proxy. `VERIFIED` — `pkg/agent/loop.go:970`
11. An unknown tool returns `Unknown tool: <name>` with `isError` true and kind `tool`. `VERIFIED` — `pkg/agent/loop.go:972`
12. RBAC is re-checked at execution. `VERIFIED` — `pkg/agent/loop.go:974`
13. A tool disabled in server settings is rejected. `VERIFIED` — `pkg/agent/loop.go:977`
14. Arguments must parse as a JSON object. `VERIFIED` — `pkg/agent/loop.go:982`
15. Graphiti arguments are org-scoped before the call. `VERIFIED` — `pkg/agent/loop.go:985`
16. The MCP call receives user id, org id, org name, and scope org id. `VERIFIED` — `pkg/agent/loop.go:987`
17. A transport failure returns kind `transport`; other proxy failures return kind `protocol`. `VERIFIED` — `pkg/agent/loop.go:990`
18. A tool-level error returns the extracted text with kind `tool`. `VERIFIED` — `pkg/agent/loop.go:997`
19. An empty result becomes "No results returned (empty response)". `VERIFIED` — `pkg/agent/loop.go:1006`
20. The model receives errors as a normal `tool` message with the error text. `VERIFIED` — `pkg/agent/loop.go:659`
21. Transport failures reach the model as an explicit "UNAVAILABLE" directive, while SSE keeps the raw error. `VERIFIED` — `pkg/agent/loop.go:645`
22. External tool names carry the server ID prefix. `VERIFIED` — `pkg/mcp/client.go:466`
23. The prefix is stripped before the upstream call. `VERIFIED` — `pkg/mcp/client.go:589`
24. Server lookup prefers the longest registered ID that prefixes the name. `VERIFIED` — test `TestServerIDForTool`
25. `search_tools` ranks tools with BM25 over name, description, and parameter names. `VERIFIED` — `pkg/agent/toolindex.go:98`
26. Name weight is 3.0, description and parameter weight 1.0, synonym weight 0.6. `VERIFIED` — `pkg/agent/toolindex.go:26`
27. A query term that matches every tool-name term adds a coverage bonus. `VERIFIED` — `pkg/agent/toolindex.go:193`
28. Ties break by tool name, so a repeated query returns the same order. `VERIFIED` — test `TestToolIndexDeterministicAndEmptyQuery`
29. An empty or unusable query returns no matches. `VERIFIED` — `pkg/agent/toolindex.go:153`
30. The result limit defaults to 8 and is capped at 25. `VERIFIED` — `pkg/agent/toolindex.go:149`
31. Auto mode enables discovery when definitions exceed 6000 tokens. `VERIFIED` — `pkg/agent/search_tools.go:124`
32. Auto mode stays off when the catalog has no tools beyond the pinned set plus one. `VERIFIED` — `pkg/agent/search_tools.go:127`
33. `search_tools` activates matches for the next iteration and emits `tools_activated`. `VERIFIED` — test `TestAgentLoopToolSearchActivatesTools`
34. Activation evicts the oldest tools until the count and token caps hold. `VERIFIED` — test `TestToolRuntimeActivationAndCaps`
35. Pinned tools are never evicted and the newest activation always survives. `VERIFIED` — `pkg/agent/search_tools.go:222`
36. `search_tools` with no match returns guidance and is not an error. `VERIFIED` — `pkg/agent/search_tools.go:365`
37. Parallel execution runs at most `MaxParallelToolCalls` calls, default 4. `VERIFIED` — `pkg/agent/loop.go:907`
38. A batch stays sequential when it has fewer than two calls, contains a meta-tool, or contains an approval-gated call. `VERIFIED` — test `TestBatchParallelizable`
39. Results are appended in the original call order even when they finish out of order. `VERIFIED` — test `TestAgentLoop_ParallelToolCallsPreserveOrder`
40. Meta-tools are never served from the stall cache and never count as progress. `VERIFIED` — `pkg/agent/tools.go:26`
41. `ExcludeToolNames` is not enforced at execution; a direct call to an excluded name can still run. `GAP` — `pkg/agent/loop.go:959`
42. A `limit` outside 1–25 is silently replaced, not rejected. `GAP` — `pkg/agent/toolindex.go:149`
43. `AlwaysInclude` supports exact names and a trailing `*` only; other glob forms do not match. `GAP` — `pkg/agent/search_tools.go:438`
## Invariants
- A tool the user cannot call is never indexed or advertised. `VERIFIED` — `pkg/agent/search_tools.go:104`
- RBAC is checked again after name resolution. `VERIFIED` — `pkg/agent/loop.go:974`
- Tool results keep the assistant call order. `VERIFIED` — `pkg/agent/loop.go:618`
- A tool call never reaches MCP with unparsed arguments. `VERIFIED` — `pkg/agent/loop.go:982`
- The activated set never exceeds the count or token caps. `VERIFIED` — `pkg/agent/search_tools.go:229`
## Failure Modes
| Condition | User-visible result | Evidence |
|---|---|---|
| Unknown tool name | `tool_call_result` with "Unknown tool", `isError` true | `pkg/agent/loop.go:972` |
| Viewer calls a write tool | `tool_call_result` with "Access denied", kind `tool` | `pkg/agent/loop.go:975` |
| Tool disabled in settings | `tool_call_result` with "disabled in MCP server settings" | `pkg/agent/loop.go:978` |
| Invalid JSON arguments | `tool_call_result` with "Invalid tool arguments" | `pkg/agent/loop.go:983` |
| MCP transport error | raw error to the UI; directive to the model, kind `transport` | `pkg/agent/loop.go:645` |
| MCP protocol error | `tool_call_result` with the error text, kind `protocol` | `pkg/agent/loop.go:994` |
| `search_tools` when discovery is off | tool error "Tool discovery is not enabled for this run" | `pkg/agent/search_tools.go:350` |
| `search_tools` without `query` | tool error "requires a 'query' argument" | `pkg/agent/search_tools.go:360` |
## Data and Persistence
| Store | Key or table | TTL | Fallback | Evidence |
|---|---|---|---|---|
| Tool index | in-memory `ToolIndex` per run | run lifetime | empty index | `pkg/agent/search_tools.go:109` |
| Activated set | `toolRuntime.active` and `activeIn` | run lifetime | none | `pkg/agent/search_tools.go:175` |
| Pinned set | `toolRuntime.always` | run lifetime | empty | `pkg/agent/search_tools.go:116` |
| Tool registry | MCP proxy client tools | connection lifetime | empty list | `pkg/mcp/proxy.go:380` |
## Observability
| Signal | Name | Where | Evidence |
|---|---|---|---|
| Span | `mcp_tool_call` with `mcp.tool_name`, `mcp.is_error`, `mcp.error_kind` | OTel tracer | `pkg/agent/loop.go:960` |
| Log field | `query`, `activated`, `evicted`, `active` | plugin logger, debug | `pkg/agent/search_tools.go:401` |
| Log field | `tool`, `error` on call failure | plugin logger, error | `pkg/agent/loop.go:989` |
| Metric | `asko11y_agent_user_tokens_total` | Prometheus scrape | `pkg/plugin/metrics.go:19` |
## Evidence Index
- `pkg/agent/tools.go:7` — `ConvertMCPToolsToOpenAI`
- `pkg/agent/toolindex.go:145` — `Search`
- `pkg/agent/search_tools.go:347` — `executeSearchTools`
- `pkg/agent/loop.go:923` — `batchParallelizable`
- `pkg/agent/toolsearch_test.go` — `TestToolIndexRanksByCapability`, `TestToolIndexOnlyReturnsIndexedTools`, `TestToolRuntimeModeSelection`, `TestToolRuntimeActivationAndCaps`, `TestToolRuntimeTokenCapEvicts`, `TestToolRuntimeAlwaysInclude`, `TestAgentLoopToolSearchActivatesTools`
- `pkg/agent/loop_test.go` — `TestAgentLoop_ParallelToolCallsRunConcurrently`, `TestAgentLoop_ParallelToolCallsPreserveOrder`, `TestAgentLoop_MaxParallelOneSerializes`, `TestAgentLoop_ApprovalGatedBatchStaysSequential`, `TestBatchParallelizable`
## Known Gaps
- `ExcludeToolNames` filters only the advertised list. Execution resolves names against the full proxy, so an excluded tool can run if the model emits its name. A forward spec must close this or document it as accepted.
- Activation state is per run. A follow-up turn in the same session rediscovers the same tools.
- The index is rebuilt for every run. Repeated runs pay the tokenization cost again.
- `search_tools` result descriptions are cut at 240 characters, so a subtle tool difference can be hidden.
- No event reports evicted tools to the user, only to the model in the tool result.
