# Retro-Spec: Sessions and Run Store

**Capability ID**: `111-sessions-runs`

**Status**: Retrospective

**Last verified**: `18e315b`

**Owner**: Ask O11y maintainers

**Module**: `pkg/plugin/sessionstore*.go`, `pkg/plugin/runstore*.go`

## Purpose

A user keeps many chat sessions, each with messages, a title, and cumulative stats.
Each agent request creates a run that records SSE events, trace data, and status.
Both survive a pod restart when Redis is configured.

## Actors and RBAC

| Capability | Admin | Editor | Viewer | Evidence |
|---|---|---|---|---|
| Manage own sessions and the current session | yes | yes | yes | `pkg/plugin/plugin.go:2560` |
| Start, read, cancel, or stream a run | yes | yes | yes | `pkg/plugin/plugin.go:876` |
| Approve a pending tool call | yes | yes | no | `pkg/plugin/plugin.go:1454` |

## Contract

### HTTP endpoints

| Method | Path | Handler | Evidence |
|---|---|---|---|
| POST | `/api/agent/run` | `handleAgentRun` | `pkg/plugin/plugin.go:876` |
| GET | `/api/agent/runs/{id}` | `handleAgentRuns` | `pkg/plugin/plugin.go:1371` |
| GET | `/api/agent/runs/{id}/events` | `handleAgentRunEvents` | `pkg/plugin/plugin.go:1607` |
| POST | `/api/agent/runs/{id}/cancel` | `handleCancelRun` | `pkg/plugin/plugin.go:1584` |
| GET, POST, DELETE | `/api/sessions` | `handleSessionsRoot` | `pkg/plugin/plugin.go:2560` |
| GET, PUT, DELETE | `/api/sessions/current` | `handleSessionCurrent` | `pkg/plugin/plugin.go:2613` |
| GET, PUT, DELETE | `/api/sessions/{id}` | `handleSessionRouter` | `pkg/plugin/plugin.go:2665` |
| GET | `/api/sessions/{id}/stats` | `handleGetSessionStats` | `pkg/plugin/plugin.go:2797` |

### SSE events

| Event | Payload fields | Evidence |
|---|---|---|
| `error` | message | `pkg/plugin/runstore_redis.go:293` |
| `evidence` | evidence record | `pkg/plugin/runstore.go:294` |
| `approval_request`, `approval_resolved` | approval, tool, risk, arguments, decision | `pkg/plugin/runstore.go:298`, `pkg/plugin/runstore.go:310` |

### Configuration keys

| Key | Location | Default | Evidence |
|---|---|---|---|
| `sessionTTLDays` | jsonData | `90` | `pkg/plugin/config.go:71` |
| `redisURL` | secureJsonData | `redis://localhost:6379/0` | `pkg/plugin/plugin.go:70` |

### MCP tool names

| Tool | Read-only | Evidence |
|---|---|---|
| None. This module calls no MCP tool. | — | `pkg/plugin/runstore.go:57` |

## Behaviour Rules

Coverage: `VERIFIED` = code pointer or test; `ASSUMED` = code suggests, no test; `GAP` = missing or contradictory.

1. `GET /api/sessions` returns metadata only, sorted by `UpdatedAt` descending. `VERIFIED` — `pkg/plugin/sessionstore.go:185`
2. `POST /api/sessions` creates the session, then sets it as current. `VERIFIED` — `pkg/plugin/plugin.go:2591`
3. The store interface holds 14 methods, from `CreateSession` to `CleanupOld`. `VERIFIED` — `pkg/plugin/sessionstore.go:74`
4. The owner key is `"<userID>:<orgID>"`; every read and write is scoped by it. `VERIFIED` — `pkg/plugin/sessionstore.go:94`
5. A session owned by another user or org returns `session not found`. `VERIFIED` — `pkg/plugin/sessionstore.go:175`
6. Org isolation is tested. `VERIFIED` — test `TestSessionStore_OrgIsolation`
7. An empty title comes from the first user message, cut at 60 characters plus `...`. `VERIFIED` — `pkg/plugin/sessionstore.go:98`
8. A session ID is 32 random bytes, base64url encoded without padding. `VERIFIED` — `pkg/plugin/shareutil.go:20`
9. `SetCurrentSessionID` rejects a session the caller does not own. `VERIFIED` — `pkg/plugin/sessionstore.go:321`
10. Deleting the current session clears the current pointer. `VERIFIED` — test `TestSessionStore_DeleteClearsCurrentSession`
11. The in-memory store deletes sessions older than the TTL on `CleanupOld`; a TTL of zero disables the sweep. `VERIFIED` — `pkg/plugin/sessionstore.go:395`
12. The Redis session blob TTL is refreshed on every mutation. `VERIFIED` — `pkg/plugin/sessionstore_redis.go:222`
13. Redis mutations use a `WATCH` read-modify-write loop and retry on conflict. `VERIFIED` — `pkg/plugin/sessionstore_redis.go:190`
14. Concurrent appends lose no messages. `VERIFIED` — test `TestRedisSessionStore_AppendMessages_ConcurrentNoLostUpdates`
15. Usage stats live in a separate hash and use `HINCRBY`, so concurrent runs add independently. `VERIFIED` — `pkg/plugin/sessionstore_redis.go:481`
16. Concurrent increments lose no counts. `VERIFIED` — test `TestRedisSessionStore_IncrementStats_ConcurrentNoLostUpdates`
17. Stats increment on `done` before the event is stored and streamed. `VERIFIED` — `pkg/plugin/plugin.go:1210`
18. Stats increment is tested. `VERIFIED` — test `TestConsumeAgentEvents_IncrementsSessionStats`
19. A run holds status, events, trace, error, and owners; a session holds messages, title, model, and stats. `VERIFIED` — `pkg/plugin/runstore.go:23`
20. `AppendEvent` assigns an increasing `Sequence` and keeps the newest 500 events. `VERIFIED` — `pkg/plugin/runstore.go:183`
21. The in-memory sweep deletes finished runs older than one hour and never a running run. `VERIFIED` — `pkg/plugin/runstore.go:415`
22. Skipping running runs is tested. `VERIFIED` — test `TestRunStore_CleanupOld_SkipsRunning`
23. A run owned by another user or org returns HTTP 403. `VERIFIED` — `pkg/plugin/plugin.go:1341`
24. In Redis each run has a heartbeat with a 90-second TTL, refreshed every 30 seconds. `VERIFIED` — `pkg/plugin/runstore_redis.go:118`
25. A running run with no heartbeat for 90 seconds becomes `failed` with `agent run was interrupted before it completed`. `VERIFIED` — `pkg/plugin/runstore_redis.go:266`
26. The interrupted transition happens once, claimed with `SETNX`. `VERIFIED` — test `TestRedisRunStore_ReconcileIsClaimedOnce`
27. Nothing prevents two concurrent runs on one session; `ActiveRunID` keeps only the last ID. `GAP` — `pkg/plugin/plugin.go:1103`

## Invariants

- Session and run records never cross a user or org boundary. `VERIFIED` — `pkg/plugin/sessionstore.go:175`
- A session ID is accepted only when it decodes to exactly 32 bytes. `VERIFIED` — `pkg/plugin/shareutil.go:11`
- A running run is never deleted by cleanup. `VERIFIED` — `pkg/plugin/runstore.go:415`

## Failure Modes

| Condition | User-visible result | Evidence |
|---|---|---|
| Session ID is malformed | 400 `Invalid session ID format` | `pkg/plugin/plugin.go:2707` |
| Session is missing or owned by another user | 404 `Session not found` | `pkg/plugin/plugin.go:2715` |
| Run belongs to another user or org | 403 `Access denied` | `pkg/plugin/plugin.go:1342` |
| Redis is unreachable at startup | In-memory stores; the health message warns | `pkg/plugin/plugin.go:570` |

## Data and Persistence

| Store | Key or table | TTL | Fallback | Evidence |
|---|---|---|---|---|
| Redis | `session:{id}` | `sessionTTLDays`, default 90 days | In-memory `SessionStore` | `pkg/plugin/sessionstore_redis.go:15` |
| Redis | `usersessions:{userID}:{orgID}` | none | In-memory `userIdx` | `pkg/plugin/sessionstore_redis.go:16` |
| Redis | `session:{id}:stats` | 90 days, refreshed on increment | Session struct fields | `pkg/plugin/sessionstore_redis.go:25` |
| Redis | `run:{id}`, `run:{id}:events`, `run:{id}:sequence` | 1 hour | `AgentRun` fields | `pkg/plugin/runstore_redis.go:45` |
| Redis | `run:{id}:heartbeat` | 90 seconds | none | `pkg/plugin/runstore_redis.go:49` |
| Redis | `run:{id}:interrupted` | 1 hour | none | `pkg/plugin/runstore_redis.go:50` |
| Redis | `runs:user:{userID}:org:{orgID}` | 1 hour | map scan | `pkg/plugin/runstore_redis.go:51` |

## Observability

| Signal | Name | Where | Evidence |
|---|---|---|---|
| Span | `agent_run`, with `org_id`, `user_role`, `session_id` | Grafana tracing exporter | `pkg/plugin/plugin.go:882` |
| Log field | `runId`, `status` | Plugin logger on run finish | `pkg/plugin/runstore.go:216` |

## Evidence Index

- `pkg/plugin/runstore_redis.go:266` — abandoned-run reconciliation
- `pkg/plugin/sessionstore_test.go` — `TestSessionStore_OrgIsolation` — org scoping
- `pkg/plugin/plugin_test.go` — `TestHandleGetSessionStats_NotFoundForWrongOwner` — owner check

## Known Gaps

- Concurrent runs on one session are allowed and uncoordinated. A forward spec should define single-flight or per-session serialisation.
- The Redis session index has no TTL; it is pruned only on create, so an idle user keeps stale members.
- `GET /api/sessions/{id}/shares` filters by `UserID` only, not by org (`pkg/plugin/plugin.go:2770`). Cross-org leakage needs a review.
