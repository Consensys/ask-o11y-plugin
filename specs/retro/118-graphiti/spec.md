# Retro-Spec: Graphiti Memory and Discovery

**Capability ID**: `118-graphiti`

**Status**: Retrospective

**Last verified**: `6c09d13`

**Owner**: Ask O11y maintainers

**Module**: `pkg/plugin/graphiti_memory.go`, `/api/graphiti/*`

---

## Purpose

The plugin stores investigation findings and service relationships in a per-org knowledge graph.
The agent reads that graph back on later runs, so repeat incidents start with prior context.
Graphiti is optional: without it, every other capability still works.

## Actors and RBAC

| Capability | Admin | Editor | Viewer | Evidence |
|---|---|---|---|---|
| `GET /api/graphiti/status` | yes | yes | yes | `pkg/plugin/plugin.go:2056` (no role check) |
| `POST /api/graphiti/discover` | yes | yes | no (403) | `pkg/plugin/plugin.go:2090` |
| `POST /api/graphiti/ingest-session` | yes | yes | no (403) | `pkg/plugin/plugin.go:2246` |
| Automatic session ingest after a run | yes | yes | yes | `pkg/plugin/plugin.go:1278` (no role check) |
| Read graph facts through the agent | yes | yes | yes, read-only tools only | `pkg/agent/loop.go:161` |

## Contract

### HTTP endpoints

| Method | Path | Handler | Evidence |
|---|---|---|---|
| GET | `/api/graphiti/status` | `handleGraphitiStatus` | `pkg/plugin/plugin.go:595` |
| POST | `/api/graphiti/discover` | `handleGraphitiDiscover` | `pkg/plugin/plugin.go:596` |
| POST | `/api/graphiti/ingest-session` | `handleGraphitiIngestSession` | `pkg/plugin/plugin.go:597` |

### SSE events

| Event | Payload fields | Evidence |
|---|---|---|
| none | Discovery runs through the run store, not an SSE stream | `pkg/plugin/plugin.go:2178` |

### Configuration keys

| Key | Location | Default | Evidence |
|---|---|---|---|
| `graphitiScanInterval` | plugin jsonData | `off` | `pkg/plugin/scout.go:303` |
| `graphitiAutoSaveSessionsDisabled` | plugin jsonData | `false` (auto-save on) | `pkg/plugin/plugin.go:1278` |
| `graphitiEpisodeTTLDays` | plugin jsonData | 30 | `pkg/plugin/config.go:72` |

### MCP tool names

| Tool | Read-only | Evidence |
|---|---|---|
| `graphiti_add_memory` (presence probe) | no | `pkg/plugin/graphiti_memory.go:43` |
| `graphiti_search_memory_facts` | yes | `pkg/plugin/topology.go:598` |
| `graphiti_get_status` | yes | `pkg/plugin/plugin.go:2065` |

Five write tools are hidden from the model: `graphiti_add_memory`, `graphiti_delete_entity_edge`, `graphiti_delete_episode`, `graphiti_clear_graph`, `graphiti_build_communities`. `VERIFIED` — `pkg/plugin/graphiti_memory.go:35`

## Behaviour Rules

Tags: `VERIFIED` (code pointer or test), `ASSUMED` (untested), `GAP` (missing).

1. Graphiti counts as available only when `graphiti_add_memory` is in the tool list. `VERIFIED` — `pkg/plugin/graphiti_memory.go:43`
2. `status` returns `{enabled, connected}` and nothing else. `VERIFIED` — `pkg/plugin/plugin.go:2074`
3. `connected` is true only when `graphiti_get_status` succeeds. `VERIFIED` — `pkg/plugin/plugin.go:2065`
4. `status` never fails when Graphiti is absent: it returns `enabled: false`. `VERIFIED` — `pkg/plugin/plugin.go:2062`
5. `discover` rejects a Viewer with 403. `VERIFIED` — `pkg/plugin/plugin.go:2090`
6. `discover` and `ingest-session` return 503 when Graphiti is unavailable. `VERIFIED` — `pkg/plugin/plugin.go:2099`
7. Both write routes share the agent rate limiter and return 429 when exhausted. `VERIFIED` — `pkg/plugin/plugin.go:2094`
8. `discover` starts a hidden agent run: type `discovery`, 50 iterations, `large` model, approvals off. `VERIFIED` — `pkg/plugin/plugin.go:2137`
9. Discovery excludes every Graphiti write tool from the model. `VERIFIED` — `pkg/plugin/plugin.go:2150`
10. `discover` returns `{runId, status: "running"}` immediately. `VERIFIED` — `pkg/plugin/plugin.go:2178`
11. Discovery ingests its synthesis as episode `discovery_synthesis` only when the run ends with `done`. `VERIFIED` — `pkg/plugin/plugin.go:2198`
12. Discovery synthesis is the concatenated assistant content, truncated to 12,000 chars. `VERIFIED` — `pkg/plugin/graphiti_memory.go:88`
13. A synthesis with no content falls back to a summary built from tool results. `VERIFIED` — test `TestCollectDiscoverySynthesis_FallsBackToToolResults`
14. `ingest-session` caps the body at 1 MiB. `VERIFIED` — `pkg/plugin/config.go:28`
15. `ingest-session` rejects more than 500 messages. `VERIFIED` — `pkg/plugin/plugin.go:2271`
16. `ingest-session` rejects an empty message list or one with no non-empty content. `VERIFIED` — `pkg/plugin/plugin.go:2267`
17. Ingest uses the last 12 turns, 1,200 chars per message, 12,000 chars total. `VERIFIED` — `pkg/plugin/graphiti_memory.go:17`
18. A manual ingest writes episode `investigation_session` with source `message` and returns `{ingested: n}`. `VERIFIED` — `pkg/plugin/plugin.go:2286`
19. An ingest failure returns 500 with a generic message; the cause goes to the log. `VERIFIED` — `pkg/plugin/plugin.go:2293`
20. Every run that ends with `done` auto-saves its session unless disabled. `VERIFIED` — `pkg/plugin/plugin.go:1278`
21. Auto-save is best-effort: a failure only logs. `VERIFIED` — `pkg/plugin/plugin.go:1315`
22. Every Graphiti call is scoped to `group_id = org_<orgID>`. `VERIFIED` — `pkg/plugin/config.go:8`
23. The agent's Graphiti tool arguments are rewritten to the current org scope, ignoring model input. `VERIFIED` — `pkg/mcp/selection.go:76`
24. An available graph appends a scoping instruction block to the system prompt. `VERIFIED` — `pkg/plugin/plugin.go:1002`
25. Retention runs hourly: build communities, then prune episodes older than the TTL. `VERIFIED` — `pkg/plugin/scout.go:252`
26. Community build failure is logged and does not stop pruning. `VERIFIED` — `pkg/plugin/scout.go:255`
27. Pruning inspects at most 1,000 episodes per pass and reports truncation. `VERIFIED` — `pkg/plugin/graphiti_memory.go:30`
28. Auto-save is skipped when Graphiti is absent. `VERIFIED` — `pkg/plugin/plugin.go:1278`
29. No timeout wraps `ingestGraphitiMemory`; the call uses the MCP client default. `ASSUMED` — `pkg/plugin/graphiti_memory.go:129` (no context deadline)

## Invariants

- Write tools never reach the model; Go performs every graph write. `VERIFIED` — `pkg/plugin/plugin.go:2150`
- Cross-org reads are impossible: the group ID is derived, never supplied. `VERIFIED` — `pkg/mcp/selection.go:72`
- A graph outage never fails a chat run. `VERIFIED` — `pkg/plugin/plugin.go:1278`

## Failure Modes

| Condition | User-visible result | Evidence |
|---|---|---|
| Graphiti not registered | `status` reports `enabled: false` | `pkg/plugin/plugin.go:2062` |
| Graphiti registered but unreachable | `status` reports `enabled: true, connected: false` | `pkg/plugin/plugin.go:2065` |
| Discovery request from Viewer | HTTP 403 `Access denied` | `pkg/plugin/plugin.go:2090` |
| Ingest body over 1 MiB | HTTP 400 `Invalid request body` | `pkg/plugin/plugin.go:2259` |
| Ingest write fails | HTTP 500 `Failed to ingest session` | `pkg/plugin/plugin.go:2293` |
| Auto-save fails | Nothing shown; warning logged | `pkg/plugin/plugin.go:1315` |

## Data and Persistence

| Store | Key or table | TTL | Fallback | Evidence |
|---|---|---|---|---|
| Graphiti episodes | `group_id = org_<id>` | 30 days (configurable) | none | `pkg/plugin/scout.go:258` |
| Session store | session messages, source of auto-save | 90 days default | none | `pkg/plugin/config.go:71` |

## Observability

| Signal | Name | Where | Evidence |
|---|---|---|---|
| Log | `Session ingested into knowledge graph` | plugin backend log | `pkg/plugin/plugin.go:2297` |
| Span / metric | none | — | `GAP` — no ingest latency or failure counter |

## Evidence Index

- `pkg/plugin/graphiti_memory.go:96` — session body construction
- `pkg/plugin/graphiti_memory.go:182` — episode pruning
- `src/components/Chat/components/SaveToMemoryButton/SaveToMemoryButton.tsx:24` — UI ingest trigger

## Known Gaps

- Auto-save sends every completed session, including Viewer sessions, with no per-user opt-out.
- `ingestGraphitiMemory` has no context deadline; a stalled Graphiti server can hold the handler.
- Ingest and discovery have no metric, so failure volume is invisible outside logs.
