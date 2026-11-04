# Retro-Spec: Tool Approval and Risk Gating

**Capability ID**: `105-tool-approval`

**Status**: Retrospective

**Last verified**: `6c09d13`

**Owner**: Ask O11y maintainers

**Module**: `pkg/plugin`, `pkg/mcp`

---
## Purpose
A risky tool call pauses until a human approves it. The user can approve once, approve the tool for the rest of the session, or deny it.
## Actors and RBAC
| Capability | Admin | Editor | Viewer | Evidence |
|---|---|---|---|---|
| Approve or deny a pending call | yes | yes | no | `pkg/plugin/plugin.go:1449` |
| Approve a tool for the whole session | yes | yes | no | `pkg/plugin/plugin.go:1471` |
| Decide on another user's run | no | no | no | `pkg/plugin/plugin.go:1444` |
| Trigger a gated call through the agent | yes | yes | read-only only | `pkg/agent/loop.go:1019` |
| Read the decision in run state | yes | yes | yes | `pkg/plugin/runstore.go:298` |
A Viewer cannot reach a gated write tool because RBAC removes it first. A Viewer cannot approve because the handler requires Admin or Editor. `VERIFIED` — `pkg/plugin/plugin.go:1449`
## Contract
### HTTP endpoints
| Method | Path | Handler | Evidence |
|---|---|---|---|
| POST | `/api/agent/runs/{runId}/approvals/{approvalId}` | `handleAgentApproval` | `pkg/plugin/plugin.go:1443` |
| GET | `/api/agent/runs/{runId}` | `handleAgentRuns` (returns the approval trace) | `pkg/plugin/plugin.go:1428` |
The decision body is `{"decision":"approved\|rejected","comment":"...","approvalScope":"once\|always"}`. `VERIFIED` — `pkg/plugin/plugin.go:1437`
### SSE events
| Event | Payload fields | Evidence |
|---|---|---|
| `approval_request` | `approvalId`, `toolCallId`, `toolName`, `risk`, `reason`, `arguments` | `pkg/agent/types.go:109` |
| `approval_resolved` | `approvalId`, `decision`, `comment`, `resolvedAt` | `pkg/agent/types.go:118` |
### Configuration keys
| Key | Location | Default | Evidence |
|---|---|---|---|
| `approvalPolicy` | plugin jsonData | `approval-gated-writes` | `pkg/plugin/plugin.go:181` |
| `riskOverrides` | plugin jsonData | empty | `pkg/plugin/plugin.go:94` |
| `trustedMCPServers` | plugin jsonData | empty | `pkg/plugin/plugin.go:93` |
| `approvalTimeout` | process variable | 30 minutes | `pkg/plugin/plugin.go:36` |
| `maxParallelToolCalls` | plugin jsonData | 4 | `pkg/plugin/plugin.go:185` |
### MCP tool names
| Tool pattern | Risk class | Approval | Evidence |
|---|---|---|---|
| name contains `delete`, `remove`, `clear`, `drop`, `truncate`, `destroy`, `purge` | destructive | yes | `pkg/mcp/risk.go:109` |
| name contains `send`, `email`, `slack`, `webhook`, `publish`, `notify`, `postmessage` | open_world | yes | `pkg/mcp/risk.go:112` |
| name contains `create`, `update`, `write`, `set`, `patch`, `put`, `post`, `deploy`, `restart`, `stop`, `start`, `silence`, `mute`, `unmute`, `pause`, `resume`, `import`, `add`, `apply`, `provision`, `grant`, `revoke` | write | yes, unless annotated read-only | `pkg/mcp/risk.go:115` |
| `readOnlyHint: true` with no destructive or open-world signal | read | no | `pkg/mcp/risk.go:59` |
## Behaviour Rules
1. Approval applies only when the policy is enabled and the risk requires it. `VERIFIED` — `pkg/agent/loop.go:1019`
2. The policy is disabled by `""`, `off`, `none`, `never`, or `disabled`. `VERIFIED` — `pkg/agent/loop.go:1138`
3. The default policy is `approval-gated-writes`. `VERIFIED` — `pkg/plugin/plugin.go:181`
4. Approval is required for destructive, open-world, or non-read-only write tools. `VERIFIED` — `pkg/mcp/risk.go:59`
5. A per-tool override can force approval on or off. `VERIFIED` — test `TestClassifyToolRisk_OverrideCanForceApproval`
6. Annotations set read-only, destructive, and open-world flags when present. `VERIFIED` — `pkg/mcp/risk.go:33`
7. A nil annotation reads as not read-only. `VERIFIED` — `pkg/mcp/risk.go:98`
8. Name heuristics add destructive, open-world, and write flags after the annotations. `VERIFIED` — `pkg/mcp/risk.go:39`
9. Overrides match the full prefixed name first, then the unprefixed name. `VERIFIED` — `pkg/mcp/risk.go:85`
10. The risk label is `destructive`, `open_world`, `write`, or `read`. `VERIFIED` — `pkg/agent/loop.go:1147`
11. The reason string comes from the override when set, else from the risk class. `VERIFIED` — `pkg/mcp/risk.go:122`
12. A saved grant is checked before any prompt. `VERIFIED` — `pkg/agent/loop.go:1033`
13. A hit emits `approval_request` and `approval_resolved` with comment "approved by saved tool grant". `VERIFIED` — `pkg/agent/loop.go:1041`
14. A grant key is the session id plus the lowercased tool name. `VERIFIED` — `pkg/plugin/approval_grants.go:38`
15. A grant is scoped to one session and one tool. `VERIFIED` — test `TestHandleAgentApprovalApproveAlwaysPersistsToolGrant`
16. The in-memory grant store never expires a grant. `VERIFIED` — `pkg/plugin/approval_grants.go:74`
17. The Redis grant store writes a hash field with no TTL. `VERIFIED` — `pkg/plugin/approval_grants.go:125`
18. Only an approved decision with scope `always` persists a grant. `VERIFIED` — `pkg/plugin/plugin.go:1471`
19. A grant failure is logged; the decision still returns 200. `VERIFIED` — `pkg/plugin/plugin.go:1512`
20. The grant stores tool name, risk, reason, session id, and creation time from the run trace. `VERIFIED` — `pkg/plugin/plugin.go:1541`
21. A missing or malformed approval id is rejected at registration. `VERIFIED` — `pkg/plugin/approval_broker.go:53`
22. `registered` waits; `resolved` returns the earlier decision; `pending` returns an error. `VERIFIED` — `pkg/plugin/approval_broker.go:234`
23. `approval_request` is emitted before the loop blocks on the decision. `VERIFIED` — `pkg/agent/loop.go:1059`
24. While the loop waits, the SSE endpoint keeps sending a `: keepalive` comment every 15 seconds. `VERIFIED` — `pkg/plugin/plugin.go:1642`
25. The wait ends after 30 minutes with decision `rejected` and comment "approval timed out". `VERIFIED` — test `TestApprovalRegistrarTimesOutPendingApproval`
26. A denial returns a tool result "was not approved by the user" with kind `approval_denied`. `VERIFIED` — `pkg/agent/loop.go:1079`
27. After a denial the loop continues and the model can choose another action. `VERIFIED` — `pkg/agent/loop.go:1083`
28. With no registrar, the call fails with "requires approval before execution". `VERIFIED` — `pkg/agent/loop.go:1050`
29. A decision accepts `approved`, `approve`, `accepted`, or `accept` for approval, and the mirrored deny forms. `VERIFIED` — `pkg/plugin/plugin.go:2346`
30. An unrecognised decision returns 400. `VERIFIED` — `pkg/plugin/plugin.go:1459`
31. A repeated identical decision returns 200 and the stored decision. `VERIFIED` — test `TestHandleAgentApprovalIsIdempotentForDuplicateDecision`
32. A conflicting second decision returns 409. `VERIFIED` — test `TestHandleAgentApprovalRejectsConflictingDuplicateDecision`
33. An unknown or expired approval returns 409. `VERIFIED` — test `TestHandleAgentApprovalUnknownPendingStillConflicts`
34. An approval-required call forces the whole batch to run sequentially. `VERIFIED` — test `TestAgentLoop_ApprovalGatedBatchStaysSequential`
35. The Redis pending key and queue expire after the approval timeout plus 5 minutes. `VERIFIED` — `pkg/plugin/approval_broker.go:192`
36. Redis resolution is a Lua compare-and-set, so a duplicate decision cannot overwrite the first. `VERIFIED` — `pkg/plugin/approval_broker.go:278`
37. The `trusted` server flag is recorded on the risk result but never read by the gate. `GAP` — `pkg/mcp/risk.go:26`
38. No HTTP route lists or revokes saved grants; the only write path is approve-always. `GAP` — `pkg/plugin/plugin.go:1471`
39. The in-memory broker is unsafe with more than one Grafana replica; the code only logs a warning. `GAP` — `pkg/plugin/plugin.go:420`
40. Saved Redis grants are never deleted, even when the session is deleted. `GAP` — `pkg/plugin/approval_grants.go:125`
## Invariants
- Only an Admin or Editor can resolve an approval. `VERIFIED` — `pkg/plugin/plugin.go:1449`
- Only the run owner in the run org can resolve an approval. `VERIFIED` — `pkg/plugin/plugin.go:1444`
- A viewed approval carries the tool name, risk, reason, and raw arguments. `VERIFIED` — `pkg/agent/loop.go:1024`
- A decision resolves at most once; a later different decision conflicts. `VERIFIED` — `pkg/plugin/approval_broker.go:108`
- A grant never leaks to another session. `VERIFIED` — test `TestHandleAgentApprovalApproveAlwaysPersistsToolGrant`
## Failure Modes
| Condition | User-visible result | Evidence |
|---|---|---|
| Viewer posts a decision | HTTP 403 "Access denied" | `pkg/plugin/plugin.go:1450` |
| Decision body is invalid | HTTP 400 "Invalid request body" | `pkg/plugin/plugin.go:1456` |
| Decision value is unknown | HTTP 400 "Invalid approval decision" | `pkg/plugin/plugin.go:1461` |
| Approval already resolved differently | HTTP 409 "Approval already resolved as X" | `pkg/plugin/plugin.go:1487` |
| Approval is not pending or expired | HTTP 409 "Approval is not pending or has expired" | `pkg/plugin/plugin.go:1499` |
| Broker delivery fails | HTTP 504 "Approval delivery failed" | `pkg/plugin/plugin.go:1503` |
| Approval registration fails | tool result "Failed to prepare approval for tool X" | `pkg/agent/loop.go:1054` |
| User denies | model sees "was not approved by the user"; no SSE error | `pkg/agent/loop.go:1079` |
| Approval times out | `approval_resolved` with decision `rejected` and timeout comment | `pkg/plugin/approval_broker.go:92` |
| Run is cancelled while waiting | wait returns the context error; tool result is empty and errored | `pkg/agent/loop.go:1065` |
## Data and Persistence
| Store | Key or table | TTL | Fallback | Evidence |
|---|---|---|---|---|
| Approval waits | `approval:{runId}:{approvalId}:pending` and `:queue` | timeout + 5 minutes | in-memory broker | `pkg/plugin/approval_broker.go:180` |
| Resolved approval | `approval:{runId}:{approvalId}:resolved` | timeout + 5 minutes | in-memory broker | `pkg/plugin/approval_broker.go:184` |
| Grants (memory) | `sessionID:toolName` map | none | none | `pkg/plugin/approval_grants.go:38` |
| Grants (Redis) | hash `approval_grants:{sessionID}` | none | in-memory store | `pkg/plugin/approval_grants.go:90` |
| Approval trace | `run.Trace.Approvals` | run TTL (1 hour) | none | `pkg/plugin/runstore.go:298` |
## Observability
| Signal | Name | Where | Evidence |
|---|---|---|---|
| Log field | `runId`, `approvalId` on resolve failure | plugin logger, warn | `pkg/plugin/plugin.go:1502` |
| Log field | `error`, `runId`, `approvalId` on grant failure | plugin logger, warn | `pkg/plugin/plugin.go:1513` |
| Log field | `error` on cleanup failure | plugin logger, warn | `pkg/plugin/approval_broker.go:341` |
| Span | `mcp_tool_call` only after approval passes | OTel tracer | `pkg/agent/loop.go:961` |
## Evidence Index
- `pkg/plugin/approval_broker.go:52` — `InMemoryApprovalBroker.Register`
- `pkg/agent/loop.go:1013` — `executeToolWithApproval`
- `pkg/plugin/plugin.go:1521` — `grantToolApproval`
- `pkg/plugin/plugin_test.go` — `TestHandleAgentApprovalRequiresEditorOrAdmin`, `TestHandleAgentApprovalDeliversDecision`, `TestHandleAgentApprovalApproveAlwaysPersistsToolGrant`, `TestHandleAgentApprovalIsIdempotentForDuplicateDecision`, `TestHandleAgentApprovalRejectsConflictingDuplicateDecision`, `TestHandleAgentApprovalUnknownPendingStillConflicts`, `TestApprovalRegistrarTimesOutPendingApproval`
- `pkg/plugin/approval_broker_redis_test.go` — `TestRedisApprovalBrokerCrossInstanceResolvesPendingApproval`, `TestRedisApprovalBrokerDuplicateDecisionIsIdempotent`, `TestRedisApprovalBrokerConflictingDuplicateDecisionConflicts`, `TestRedisApprovalBrokerUnknownApprovalIsNotPending`
- `pkg/mcp/risk_test.go` — `TestClassifyToolRisk_ReadOnlyAnnotation`, `TestClassifyToolRisk_DestructiveNameRequiresApproval`, `TestClassifyToolRisk_OverrideCanForceApproval`
## Known Gaps
- `trusted` is dead configuration. A trusted server still prompts for every write tool.
- Grants have no management surface. A user cannot see or revoke an approve-always grant.
- Grants never expire and survive session deletion. A forward spec should bound and clean them.
- Single-replica safety depends on Redis being configured; the fallback only warns.
- There is no approval for `load_skill` or `search_tools`; both bypass the gate by design but this is not stated to the user.
- A denial is not shown as a distinct SSE event; the UI must infer it from the tool result.
