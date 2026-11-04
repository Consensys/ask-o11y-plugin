# Retro-Spec: Topology and Service Graph

**Capability ID**: `117-topology`

**Status**: Retrospective

**Last verified**: `6c09d13`

**Owner**: Ask O11y maintainers

**Module**: `pkg/plugin/topology.go`, `pkg/plugin/topology_snapshot.go`, `src/components/ServiceGraph/`

---

## Purpose

A user sees the organization's service graph, derived from knowledge-graph facts.
An RCA run starts with a compact dependency list instead of discovering topology itself.
Both paths fail open: a missing graph never blocks an investigation.

## Actors and RBAC

| Capability | Admin | Editor | Viewer | Evidence |
|---|---|---|---|---|
| Read `GET /api/agent/topology` | yes | yes | yes | `pkg/plugin/plugin.go:1859` (no role check) |
| Receive the prefetched topology block on an RCA run | yes | yes | yes | `pkg/plugin/plugin.go:987` |
| Open the AppConfig service-graph panel | yes | no | no | `GAP` — no route-level check; Grafana gates the config page |

## Contract

### HTTP endpoints

| Method | Path | Handler | Evidence |
|---|---|---|---|
| GET | `/api/agent/topology` | `handleAgentTopology` | `pkg/plugin/plugin.go:592` |

Query parameters: `query` (string), `maxNodes` (default 100, max 500), `maxEdges` (default 200, max 1000). `VERIFIED` — `pkg/plugin/plugin.go:1864`

### SSE events

None. The route returns one JSON body. `VERIFIED` — `pkg/plugin/plugin.go:1989`

### Configuration keys

| Key | Location | Default | Evidence |
|---|---|---|---|
| `serviceGraphMaxNodes` | plugin jsonData | 100 | `src/components/AppConfig/AppConfig.tsx:136` |
| `serviceGraphMaxEdges` | plugin jsonData | 200 | `src/components/AppConfig/AppConfig.tsx:137` |

The backend does not read either key; the UI forwards them as query parameters. `GAP` — `pkg/plugin/plugin.go:115`

### MCP tool names

| Tool | Read-only | Evidence |
|---|---|---|
| `*_search_memory_facts` (Graphiti) | yes | `pkg/plugin/topology.go:596` |
| `*_search_nodes` / `*_search_memory_nodes` (Graphiti) | yes | `pkg/plugin/topology.go:616` |
| `*_query_prometheus` (snapshot path) | yes | `pkg/plugin/topology_snapshot.go:344` |
| `*_list_datasources` (snapshot path) | yes | `pkg/plugin/topology_snapshot.go:360` |

## Behaviour Rules

Tags: `VERIFIED` (code pointer or test), `ASSUMED` (untested), `GAP` (missing).

1. The response carries `enabled`, `source`, `nodes`, `edges`, `rawFactCount`, and `warnings`. `VERIFIED` — `pkg/plugin/topology.go:25`
2. A node is `{id, label, type}`; an edge is `{id, source, target, label}`. `VERIFIED` — `pkg/plugin/topology.go:12`
3. `source` is always `graphiti` on this route. `VERIFIED` — `pkg/plugin/plugin.go:1978`
4. `enabled: false` and empty arrays return when `graphiti_add_memory` is absent. `VERIFIED` — `pkg/plugin/plugin.go:1873`
5. A missing facts tool returns `enabled: true`, empty arrays, and a warning. `VERIFIED` — `pkg/plugin/plugin.go:1890`
6. The default fact query covers topology, dependencies, deployment, and signals. `VERIFIED` — `pkg/plugin/topology.go:708`
7. Node type derives from Graphiti labels: service, namespace, cluster, database, queue. `VERIFIED` — `pkg/plugin/topology.go:388`
8. Known infrastructure names are dropped from the graph. `VERIFIED` — `pkg/plugin/topology.go:82`
9. English function words are dropped as node names. `VERIFIED` — `pkg/plugin/topology.go:98`
10. A node ID is the lowercased label with spaces and separators replaced by hyphens. `VERIFIED` — `pkg/plugin/topology.go:561`
11. An edge ID is `source->target`; repeated pairs keep the first edge and self edges are rejected. `VERIFIED` — `pkg/plugin/topology.go:495`
12. An edge label is the lowercased relation name, or `depends`/`relates to` when absent. `VERIFIED` — `pkg/plugin/topology.go:828`
13. Free text is parsed for arrows, call verbs, deployment, cluster, signal, and queue patterns. `VERIFIED` — `pkg/plugin/topology.go:437`
14. A missing nodes tool falls back to text-only parsing and adds a warning. `VERIFIED` — `pkg/plugin/plugin.go:1921`
15. Centered fact lookups are capped at 12 nodes per request. `VERIFIED` — `pkg/plugin/topology.go:43`
16. Per-center fact limit is between 25 and 100, scaled by the edge limit. `VERIFIED` — `pkg/plugin/topology.go:741`
17. Invalid or absent limits fall back to the defaults. `VERIFIED` — `pkg/plugin/plugin.go:1992`
18. A limit above the hard maximum is clamped, not rejected. `VERIFIED` — `pkg/plugin/topology.go:182`
18. Node truncation and edge truncation each append a warning. `VERIFIED` — `pkg/plugin/topology.go:197`
19. Edges whose endpoints were truncated away are dropped. `VERIFIED` — `pkg/plugin/topology.go:207`
20. An empty graph appends a "no facts matched" warning. `VERIFIED` — `pkg/plugin/plugin.go:1985`
21. Nil nodes or edges serialise as `[]`, never `null`. `VERIFIED` — `pkg/plugin/topology.go:224`
22. The route has no cache; every request fans out to Graphiti. `GAP` — `pkg/plugin/plugin.go:1859` (no cache lookup)
23. The prompt snapshot prefers Tempo service-graph metrics over Graphiti. `VERIFIED` — `pkg/plugin/topology_snapshot.go:264`
24. The snapshot budget is 3 seconds for the whole prefetch. `VERIFIED` — `pkg/plugin/topology_snapshot.go:27`
25. A successful snapshot caches for 5 minutes; a miss caches for 1 minute. `VERIFIED` — test `TestTopologySnapshot_ServiceGraphPrimaryAndCached`
26. The snapshot cache key is org ID plus the alert's service label. `VERIFIED` — test `TestTopologySnapshot_CacheKeyIncludesService`
27. The snapshot renders at most 40 edges above 0.01 rps. `VERIFIED` — `pkg/plugin/topology_snapshot.go:40`
28. Up to 5 Prometheus datasources are probed; the first with edges wins. `VERIFIED` — test `TestTopologySnapshot_ProbesMultiplePrometheusDatasources`
29. With no Prometheus datasource, the snapshot queries the MCP default datasource. `VERIFIED` — `pkg/plugin/topology_snapshot.go:288`
30. The snapshot scopes to the alert's `service` label, and keeps all edges when nothing matches. `VERIFIED` — `pkg/plugin/topology_snapshot.go:154`
31. Graphiti fallback is capped at 60 facts and labels edges as unverified. `VERIFIED` — `pkg/plugin/topology_snapshot.go:48`
32. An empty snapshot renders no prompt block. `VERIFIED` — `pkg/plugin/prompt_defaults.go:85`
33. Failed or partial node lookups return a warning and partial data, never a 500. `VERIFIED` — `pkg/plugin/plugin.go:1934`

## Invariants

- The route always answers JSON, even when the graph is absent. `VERIFIED` — `pkg/plugin/plugin.go:1873`
- A topology failure never blocks a run: the snapshot is best-effort. `VERIFIED` — `pkg/plugin/topology_snapshot.go:20`
- Graphiti queries always carry the org `group_id`, never a caller-supplied one. `VERIFIED` — `pkg/plugin/topology.go:646`

## Failure Modes

| Condition | User-visible result | Evidence |
|---|---|---|
| Tool listing fails | 500 `Failed to load topology tools` | `pkg/plugin/plugin.go:1870` |
| Facts call fails | 500 `Failed to load topology` | `pkg/plugin/plugin.go:1911` |
| Graphiti not registered | 200 with `enabled: false` | `pkg/plugin/plugin.go:1873` |
| Nodes tool missing | 200, text-only graph, warning | `pkg/plugin/plugin.go:1921` |
| Prompt snapshot empty | No topology block in the prompt | `pkg/plugin/prompt_defaults.go:85` |

## Data and Persistence

| Store | Key or table | TTL | Fallback | Evidence |
|---|---|---|---|---|
| In-memory map | `topoCache[orgID + service]` | 5 min hit / 1 min miss | Graphiti | `pkg/plugin/topology_snapshot.go:32` |
| Graphiti | `group_id = org_<id>` | external | none | `pkg/plugin/topology.go:643` |

## Observability

| Signal | Name | Where | Evidence |
|---|---|---|---|
| Log | `topologySnapshot: service graph query failed` | plugin backend log | `pkg/plugin/topology_snapshot.go:296` |
| Span / metric | none | — | `GAP` — no span around either topology path |

## Evidence Index

- `src/services/agentTopologyClient.ts:30` — client URL and error contract
- `src/components/ServiceGraph/ServiceGraphScene.tsx:72` — nodeGraph panel construction
- `pkg/plugin/topology_test.go` — `TestLimitTopologyResponseTrimsNodesAndEdges`

## Known Gaps

- The backend ignores `serviceGraphMaxNodes` and `serviceGraphMaxEdges`; only query parameters count.
- `/api/agent/topology` is Graphiti-only, while the prompt snapshot is Tempo-first. The two views can disagree.
- No cache and no timeout on the HTTP route; a slow Graphiti server holds the request open.
