# Retro-Spec: LLM Transport and Model Selection

**Capability ID**: `102-llm-transport`

**Status**: Retrospective

**Last verified**: `18e315b`

**Owner**: Ask O11y maintainers

**Module**: `pkg/agent`, `pkg/plugin`

---
## Purpose
The agent sends every completion request through the Grafana LLM app. It picks `base` or `large` per request, streams the response, and accounts for the tokens.
## Actors and RBAC
| Capability | Admin | Editor | Viewer | Evidence |
|---|---|---|---|---|
| Request `base` or `large` per run | yes | yes | yes | `pkg/plugin/agent_model.go:14` |
| Reject an unsupported model value | yes | yes | yes | `pkg/plugin/plugin.go:913` |
| Reject a conflicting session model | yes | yes | yes | `pkg/plugin/plugin.go:1029` |
| Inherit the model from an active skill | yes | yes | yes | `pkg/plugin/plugin.go:1094` |
No role receives a different model. Model choice is not an RBAC boundary. `VERIFIED` — `pkg/plugin/agent_model.go:14`
## Contract
### HTTP endpoints
| Method | Path | Handler | Evidence |
|---|---|---|---|
| POST | `/api/agent/run?model=base\|large` | `handleAgentRun` | `pkg/plugin/plugin.go:588` |
| GET | `/api/agent/runs/{runId}` | `handleAgentRuns` | `pkg/plugin/plugin.go:1433` |
The run response carries `model` and `modelSource` (`auto`, `request`, `session`, or `skill`). `VERIFIED` — `pkg/plugin/plugin.go:1188`
### SSE events
| Event | Payload fields | Evidence |
|---|---|---|
| `error` | `message`, `code`, `statusCode`, `requestId`, `retryable` | `pkg/agent/types.go:195` |
| `done` | `promptTokens`, `completionTokens`, `totalTokens`, `usageByModel` | `pkg/agent/types.go:173` |
The transport emits no event of its own. A transport failure reaches the client as the loop `error` event. `VERIFIED` — `pkg/agent/loop.go:356`
### Configuration keys
| Key | Location | Default | Evidence |
|---|---|---|---|
| `model` | query parameter | empty (auto) | `pkg/plugin/agent_model.go:15` |
| `model` | session record | empty | `pkg/plugin/plugin.go:1028` |
| `model` | skill front matter | empty | `pkg/skills/selection.go:92` |
| `maxTotalTokens` | plugin jsonData | 64000 | `pkg/agent/context_window.go:16` |
| `maxIterations` | skill entry | 0 (unset) | `pkg/skills/registry.go:42` |
### MCP tool names
| Tool | Read-only | Evidence |
|---|---|---|
| none — this capability calls an app route, not MCP | n/a | `pkg/agent/llm_client.go:24` |
## Behaviour Rules
1. The client posts to `/api/plugins/grafana-llm-app/resources/openai/v1/chat/completions` on the Grafana base URL. `VERIFIED` — `pkg/agent/llm_client.go:24`
2. The URL is the resolved Grafana URL with a trimmed trailing slash plus the endpoint. `VERIFIED` — `pkg/agent/llm_client.go:316`
3. The request sets `Authorization: Bearer <service-account token>`. `VERIFIED` — `pkg/agent/llm_client.go:324`
4. The request never sets `X-Grafana-Org-Id`. `VERIFIED` — test `TestLLMClient_ChatCompletion`
5. A missing token logs a warning and the request still goes out. `VERIFIED` — `pkg/agent/llm_client.go:329`
6. A non-empty org other than `1` logs a warning because the token is Org-1 scoped. `VERIFIED` — `pkg/agent/llm_client.go:325`
7. The request sets `Content-Type: application/json` and no `Cookie`. `VERIFIED` — test `TestLLMClient_ChatCompletion_FallbackToToken`
8. Every request forces `stream: true` and `stream_options.include_usage: true`. `VERIFIED` — `pkg/agent/llm_client.go:142`
9. The response is parsed as SSE `data:` lines; `[DONE]` ends the stream. `VERIFIED` — `pkg/agent/llm_client.go:352`
10. Tool-call deltas merge by index and concatenate their argument fragments. `VERIFIED` — test `TestLLMClient_ChatCompletion_ToolCall`
11. A stream without a terminal `finish_reason` returns `errIncompleteStream`. `VERIFIED` — `pkg/agent/llm_client.go:397`
12. A missing model field is omitted from the JSON body. `VERIFIED` — test `TestLLMClient_ChatCompletion`
13. The HTTP client uses a 600-second timeout and a 10-second dial timeout. `VERIFIED` — `pkg/plugin/plugin.go:423`
14. The client makes at most 2 attempts per completion. `VERIFIED` — `pkg/agent/llm_client.go:27`
15. The client retries transport errors. `VERIFIED` — `pkg/agent/llm_client.go:179`
16. The client retries only 429, 500, 502, 503, and 504. `VERIFIED` — `pkg/agent/llm_client.go:276`
17. Retry delay honours `Retry-After` up to 5 seconds, else `attempt × 250 ms`. `VERIFIED` — `pkg/agent/llm_client.go:284`
18. An interrupted stream is retried once, then the error surfaces. `VERIFIED` — test `TestLLMClient_ChatCompletion_IncompleteStreamExhausted`
19. A non-OK status becomes `LLMHTTPError` with status, request id, trace id, and retryable flag. `VERIFIED` — `pkg/agent/llm_client.go:244`
20. The upstream response body never reaches the user message. `VERIFIED` — test `TestLLMClient_ChatCompletion_HTTPErrorIncludesSafeDiagnostics`
21. Model values are `""`, `base`, or `large`; any other value is rejected with 400. `VERIFIED` — test `TestParseAgentModelParam`
22. A session model overrides the query model; a conflicting query model is rejected with 400. `VERIFIED` — test `TestHandleAgentRunRejectsConflictingSessionModel`
23. A new session persists the query model when one is given. `VERIFIED` — test `TestHandleAgentRunPersistsNewSessionModel`
24. With no session or query model, the first active skill `model` wins. `VERIFIED` — `pkg/skills/selection.go:92`
25. Otherwise auto selection returns `large` for `investigation`, `performance`, and `discovery`. `VERIFIED` — `pkg/plugin/agent_model.go:29`
26. Auto selection returns `large` for messages longer than 700 runes. `VERIFIED` — `pkg/plugin/agent_model.go:35`
27. Auto selection returns `large` on a keyword match, else `base`. `VERIFIED` — test `TestSelectAgentModelForTask`
28. A `large` run falls back to `base` only when fallback is allowed and the error is at least HTTP 500. `VERIFIED` — `pkg/agent/loop.go:840`
29. Fallback is allowed only for `auto` or `skill` sources with `large`. `VERIFIED` — `pkg/plugin/plugin.go:1141`
30. Usage is read from `prompt_tokens`, `completion_tokens`, and `total_tokens` on the final usage chunk. `VERIFIED` — `pkg/agent/types.go:65`
31. Usage accumulates per model and appears on `done` as totals plus `usageByModel`. `VERIFIED` — `pkg/agent/loop.go:363`
32. The completion budget is `maxTotalTokens / 8`, clamped to 512–4096, and capped at half the total. `VERIFIED` — test `TestCompletionTokenBudget`
33. The prompt budget is `maxTotalTokens - completionBudget`. `VERIFIED` — `pkg/agent/loop.go:154`
34. The iteration budget is the highest skill `maxIterations`, else 50, or 60 for an alert investigation. `VERIFIED` — `pkg/plugin/iteration_budget.go:27`
35. No bundled skill sets `maxIterations`, so shipped runs use 50 or 60. `ASSUMED` — `pkg/skills/registry.go:42`
36. A truncated final answer is re-requested once with a 16384-token budget. `VERIFIED` — test `TestAgentLoop_TruncatedFinalAnswerRetriedWithLargerBudget`
## Invariants
- `X-Grafana-Org-Id` is never sent with service-account auth. `VERIFIED` — `pkg/agent/llm_client.go:310`
- Every completion request is streamed. `VERIFIED` — `pkg/agent/llm_client.go:142`
- A response without `finish_reason` is never returned as complete. `VERIFIED` — `pkg/agent/llm_client.go:397`
- Upstream error bodies never appear in a user message. `VERIFIED` — `pkg/agent/llm_client.go:68`
- Org isolation is enforced at the MCP layer, not on the LLM request. `VERIFIED` — `pkg/agent/llm_client.go:314`
## Failure Modes
| Condition | User-visible result | Evidence |
|---|---|---|
| 401 or 403 | `error`, code `llm_http_401`, text names the service-account token | `pkg/agent/llm_client.go:75` |
| 404 | `error`, code `llm_http_404`, text names grafana-llm-app | `pkg/agent/llm_client.go:77` |
| 429 | `error`, code `llm_http_429`, retryable | `pkg/agent/llm_client.go:79` |
| 5xx | `error`, code `llm_http_5xx`, retryable | `pkg/agent/llm_client.go:82` |
| Stream ends early twice | `error`, code `llm_incomplete_stream` | `pkg/agent/loop.go:863` |
| Request timeout | transport error, then one retry, then `error` | `pkg/agent/llm_client.go:175` |
| Invalid `model` value | HTTP 400 with the supported values | `pkg/plugin/plugin.go:915` |
| Conflicting session model | HTTP 400 "Session model cannot be changed" | `pkg/plugin/plugin.go:1030` |
## Data and Persistence
| Store | Key or table | TTL | Fallback | Evidence |
|---|---|---|---|---|
| Session model | `session.Model` | session TTL | auto selection | `pkg/plugin/plugin.go:1033` |
| Token counter | `asko11y_agent_user_tokens_total` | process lifetime | none | `pkg/plugin/metrics.go:19` |
| Conversation history | in-memory message slice | run lifetime | none | `pkg/agent/loop.go:183` |
## Observability
| Signal | Name | Where | Evidence |
|---|---|---|---|
| Span | `llm_call` | OTel tracer | `pkg/agent/llm_client.go:134` |
| Span attribute | `llm.model`, `llm.message_count`, `llm.tool_count`, `llm.http_status` | span | `pkg/agent/llm_client.go:150` |
| Metric | `asko11y_agent_user_tokens_total` | Prometheus scrape | `pkg/plugin/metrics.go:19` |
| Log field | `model`, `modelSource`, `requestId`, `attempt` | plugin logger | `pkg/plugin/plugin.go:1116` |
## Evidence Index
- `pkg/agent/llm_client.go:335` — `parseStream` accumulation
- `pkg/agent/llm_client.go:244` — `buildHTTPError`
- `pkg/agent/loop.go:828` — `chatCompletionWithFallback`
- `pkg/plugin/agent_model.go:28` — `selectAgentModelForTask`
- `pkg/plugin/plugin.go:1092` — effective model resolution
- `pkg/plugin/iteration_budget.go:26` — `resolveMaxIterations`
- `pkg/agent/llm_client_test.go` — `TestLLMClient_ChatCompletion`, `TestLLMClient_ChatCompletion_FallbackToToken`, `TestLLMClient_ChatCompletion_RetriesTransientStatus`, `TestLLMClient_ChatCompletion_IncompleteStreamRetriesThenSucceeds`, `TestLLMClient_ChatCompletion_HTTPErrorIncludesSafeDiagnostics`
- `pkg/plugin/agent_model_test.go` — `TestParseAgentModelParam`, `TestSelectAgentModelForTask`
## Known Gaps
- The OpenAPI description states a 25-iteration cap, but the code uses 50 and 60 (`pkg/plugin/openapi/openapi.json:499`).
- The completion budget is silently clamped. The response does not report the budget that was used.
- There is no per-request retry budget shared across a run. Each completion retries on its own.
- An interrupted stream after the second attempt loses all partial tool calls; no partial text is shown.
- Skill-supplied `maxIterations` is untested at runtime because no bundled skill sets it.
