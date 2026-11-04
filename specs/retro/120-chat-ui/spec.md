# Retro-Spec: Chat UI and Streaming Render
**Capability ID**: `120-chat-ui`
**Status**: Retrospective
**Last verified**: `6c09d13`
**Owner**: Ask O11y maintainers
**Module**: `src/components/Chat/`, `src/services/agentClient.ts`
---
## Purpose
A user types a prompt and receives a streamed agent answer. Tool calls, evidence, approvals, and errors render inside the same turn.
## Actors and RBAC
| Capability | Admin | Editor | Viewer | Evidence |
|---|---|---|---|---|
| Send a chat message | yes | yes | yes | `src/components/Chat/hooks/useChat.ts:525` |
| Execute a write tool during the run | yes | yes | no | `pkg/rbac/rbac.go:12` |
| Use the chat input | yes | yes | yes | `src/components/Chat/scenes/ChatInterfaceScene.tsx:117` |

Read-only views hide the input. The gate is the `readOnly` prop, not the user role.
## Contract
### HTTP endpoints
| Method | Path | Handler | Evidence |
|---|---|---|---|
| POST | `/api/plugins/consensys-asko11y-app/resources/api/agent/run?model=` | `runAgentDetached` | `src/services/agentClient.ts:189` |
| GET | `…/api/agent/runs/{runId}/events` | `reconnectToAgentRun` | `src/services/agentClient.ts:442` |
| POST | `…/api/agent/runs/{runId}/cancel` | `cancelAgentRun` | `src/services/agentClient.ts:398` |
| GET | `…/api/agent/runs/{runId}` | `getAgentRunStatus` | `src/services/agentClient.ts:410` |
| POST | `…/api/agent/runs/{runId}/approvals/{approvalId}` | `resolveAgentApproval` | `src/services/agentClient.ts:341` |
### SSE events
| Event | Payload fields | Evidence |
|---|---|---|
| `content` | `content` | `src/services/agentClient.ts:16` |
| `tool_call_start` | `id`, `name`, `arguments` | `src/services/agentClient.ts:20` |
| `tool_call_result` | `id`, `name`, `content`, `isError`, `errorKind` | `src/services/agentClient.ts:29` |
| `done` | `totalIterations` | `src/services/agentClient.ts:42` |
| `error` | `message`, `code`, `statusCode`, `requestId`, `retryable` | `src/services/agentClient.ts:46` |
| `run_started` | `runId`, `sessionId`, `skills[]` | `src/services/agentClient.ts:60` |
| `mcp_unavailable` | `message` | `src/services/agentClient.ts:78` |
| `evidence` | `id`, `title`, `summary`, `source`, `toolName`, `query`, `datasourceUid`, `timeRange` | `src/services/agentClient.ts:82` |
| `approval_request` | `approvalId`, `toolCallId`, `toolName`, `risk`, `reason`, `arguments` | `src/services/agentClient.ts:93` |
| `approval_resolved` | `approvalId`, `decision`, `comment`, `resolvedAt` | `src/services/agentClient.ts:102` |
| `final_report` | `verdict`, `confidence`, `summary`, `evidenceIds`, `gaps`, `nextSteps`, `hypotheses`, `validation` | `src/services/agentClient.ts:129` |
| `tools_activated` | `query`, `tools[]`, `evicted[]` | `src/services/agentClient.ts:72` |
### Configuration keys
| Key | Location | Default | Evidence |
|---|---|---|---|
| `kioskModeEnabled`, `chatPanelPosition` | `jsonData`, read by `Chat` | `true`, `'right'` | `src/components/Chat/Chat.tsx:60` |
### MCP tool names
| Tool | Read-only | Evidence |
|---|---|---|
| `load_skill` | not asserted here | `src/components/Chat/hooks/useChat.ts:256` |
## Behaviour Rules
1. Enter without Shift sends the message. Shift+Enter inserts a newline. `VERIFIED` — test `should NOT call handleKeyPress for Shift+Enter (allows newline)`
2. An empty or whitespace-only input returns without a request. `VERIFIED` — `src/components/Chat/hooks/useChat.ts:527`
3. Input longer than 10000 characters is rejected before any request. `VERIFIED` — `src/components/Chat/hooks/useChat.ts:536`
4. Send appends the user message, then an empty assistant message, and sets `isGenerating`. `VERIFIED` — `src/components/Chat/hooks/useChat.ts:564`
5. The run starts with POST to `/api/agent/run`. The model travels as a query parameter, never in the body. `VERIFIED` — test `should append model as a query param and keep it out of the request body`
6. A message sent while generating is queued, then sent after completion. `ASSUMED` — `src/components/Chat/hooks/useChat.ts:553`
7. The queue is cleared when the session changes. `ASSUMED` — `src/components/Chat/hooks/useChat.ts:781`
8. A leading `/name` that matches a known skill is stripped and sent as `skills[]`. `VERIFIED` — test `sends a slash command as skills and strips the command from the message`
9. An unknown slash token passes through verbatim as message text. `VERIFIED` — test `passes an unknown slash token through verbatim`
10. A bare skill command with no message appends an error line and starts no run. `VERIFIED` — test `rejects a bare skill command with no message`
11. Skill precedence is slash command, then explicit skill, then the `?skill=` deep link. `ASSUMED` — `src/components/Chat/hooks/useChat.ts:551`
12. The `?skill=` deep link activates once and does not depend on the loaded skill catalog. Without a message it only prefills `/<skill> `. `VERIFIED` — test `activates a ?skill= deep link without waiting for the skill catalog`
13. `initialMessage` auto-sends through the `idle → creating-session → ready-to-send → sent` machine. `ASSUMED` — `src/components/Chat/hooks/useChat.ts:826`
14. A `content` event appends its text to the last assistant message and re-parses Grafana links. `ASSUMED` — `src/components/Chat/hooks/useChat.ts:241`
15. `tool_call_start` inserts a running tool call keyed by event id. `ASSUMED` — `src/components/Chat/hooks/useChat.ts:266`
16. `tool_call_result` clears `running` and stores either the error text or a text response. `ASSUMED` — `src/components/Chat/hooks/useChat.ts:276`
17. A successful `load_skill` result adds a skill chip. `VERIFIED` — test `adds a chip when the agent loads a skill mid-run via load_skill`
18. `run_started` replaces the message skill chips. `VERIFIED` — test `attaches run_started skills to the assistant message as chips data`
19. `evidence` upserts by `id`. `ASSUMED` — `src/components/Chat/hooks/useChat.ts:363`
20. `approval_request` ignores a repeated `approvalId`. `ASSUMED` — `src/components/Chat/hooks/useChat.ts:380`
21. `done` changes no UI state. The reconnect loop owns completion. `VERIFIED` — `src/services/agentClient.ts:271`
22. An `error` event sets `message.error`. `VERIFIED` — test `should handle SSE error events`
23. An error renders as an Alert titled "Something went wrong". `VERIFIED` — test `should render the error message when message.error is set`
24. The Retry button appears only on the last assistant message. `VERIFIED` — test `should not render a Retry button for non-last messages`
25. Retry re-sends the last user prompt with its original skill. `VERIFIED` — test `retry reuses the original turn skill`
26. Retry is a no-op while generating or when no user message exists. `ASSUMED` — `src/components/Chat/hooks/useChat.ts:655`
27. Stop aborts the stream, calls cancel for the active run, and clears the queue. `ASSUMED` — `src/components/Chat/hooks/useChat.ts:674`
28. A user abort appends `*[Generation stopped]*` to the assistant message. `ASSUMED` — `src/components/Chat/hooks/useChat.ts:631`
29. Two approval submissions for the same run and approval are blocked before rerender. `VERIFIED` — test `guards duplicate approval submissions before React state rerenders`
30. Approve-for-session sends `approvalScope` `always`. `VERIFIED` — test `passes approve-always scope to the approval API`
31. A failed approval falls back to the run status, and clears the card on a 409. `VERIFIED` — test `refreshes the run and clears stale approval cards after a resolved 409`
32. Events with `sequence` at or below the last seen value are skipped. `ASSUMED` — `src/services/agentClient.ts:266`
33. Malformed SSE lines are skipped without a throw. `VERIFIED` — test `should skip malformed SSE lines without crashing`
34. The stream fails after 60000 ms without data. `VERIFIED` — test `should return false on SSE idle timeout`
35. A failed stream reconnects up to 10 times, 1 s apart, and clears partial content first. `ASSUMED` — `src/services/agentClient.ts:423`
36. `X-Grafana-Org-Id` is sent when an org id is supplied. `VERIFIED` — test `should set X-Grafana-Org-Id header when orgId is provided`
37. An active run reconnects on mount or session change. `ASSUMED` — `src/components/Chat/hooks/useChat.ts:688`
38. The slash menu opens only for a partial `/token` and lists at most 8 skills. `VERIFIED` — test `filters the menu by the typed token`
39. Enter or Tab completes the highlighted skill. Escape dismisses the menu. `VERIFIED` — test `moves the active option with arrow keys and completes on Tab`
40. The menu renders in a body portal with fixed positioning. `VERIFIED` — test `renders the menu in a body portal with fixed positioning`
41. A committed skill shows the active-skill chip. `VERIFIED` — test `completes the active command on Enter and shows the skill chip`
42. The send button is disabled when the input is empty. `VERIFIED` — test `should be disabled when input is empty`
43. A validation error blocks send and shows an "Input validation error" Alert. `ASSUMED` — `src/components/Chat/components/ChatInput/ChatInput.tsx:213`
44. The stop button appears only while generating. `VERIFIED` — test `should show stop button during generation`
45. The queue indicator appears only when messages are queued. `VERIFIED` — test `should show queue indicator when messages are queued`
46. A read-only view hides the chat input. `VERIFIED` — test `should view a shared session in read-only mode`
47. `Chat` renders nothing when the scene builder returns null. `GAP` — `src/components/Chat/Chat.tsx:278` has no fallback UI
Coverage tags:

| Tag | Meaning | Review action |
|---|---|---|
| `VERIFIED` | A code pointer or a test proves the rule | Accept without reading |
| `ASSUMED` | Code suggests it, no test proves it | Human must confirm or veto |
| `GAP` | Behaviour is absent, unclear, or contradictory | Becomes a candidate forward spec |
## Invariants
- Stream events update only the last assistant message. `VERIFIED` — `src/components/Chat/hooks/useChat.ts:51`
- `isGenerating` returns to false in a `finally` block on every path. `VERIFIED` — `src/components/Chat/hooks/useChat.ts:643`
- Every agent request carries the org header when the org id is known. `VERIFIED` — `src/services/agentClient.ts:194`
## Failure Modes
| Condition | User-visible result | Evidence |
|---|---|---|
| Input over 10000 characters | "Input validation error: …" assistant line | `src/components/Chat/hooks/useChat.ts:538` |
| Bare `/skill` with no message | "Add a message after the skill command …" | `src/components/Chat/hooks/useChat.ts:544` |
| Backend rejects the run | Alert with the server text, plus Retry | `src/components/Chat/hooks/useChat.ts:636` |
| SSE `error` event | Alert with the event message | `src/components/Chat/hooks/useChat.ts:344` |
| Stream idle for 60 s | Silent reconnect, no message | `src/services/agentClient.ts:282` |
| 10 failed reconnects | "Agent run did not complete after multiple reconnection attempts" | `src/services/agentClient.ts:467` |
| MCP transport is down | `mcp_unavailable` banner | `src/components/Chat/hooks/useChat.ts:353` |
| Approval POST fails | Inline approval error text | `src/components/Chat/hooks/useChat.ts:512` |
## Data and Persistence
| Store | Key or table | TTL | Fallback | Evidence |
|---|---|---|---|---|
| React state | `chatHistory`, `toolCalls`, `messageQueue` | mount lifetime | empty | `src/components/Chat/hooks/useChat.ts:76` |
| Backend | agent run record | server-owned | none | `src/services/agentClient.ts:442` |
## Observability
| Signal | Name | Where | Evidence |
|---|---|---|---|
| Span | none in the chat client | — | `GAP` |
| Log field | none; errors surface in the UI | — | `GAP` |
## Evidence Index
- `src/components/Chat/hooks/useChat.ts:39` — slash-skill parsing contract
- `src/services/agentClient.ts:214` — SSE reader
- `src/services/agentClient.ts:298` — event dispatch map
- `src/components/testIds.ts:74` — chat test id constants
- `tests/chat.spec.ts` — `should send messages and transition to chat state` — send flow end to end
## Known Gaps
- No test covers message queueing or queue drain. Forward spec: queue and concurrency.
- No test covers stream cancellation. Forward spec: cancellation contract.
- The chat client emits no spans, metrics, or log fields. Forward spec: client observability.
