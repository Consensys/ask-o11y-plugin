# Retro-Spec: MCP Tool Selection and Filtering

**Capability ID**: `108-mcp-selection`

**Status**: Retrospective

**Last verified**: `6c09d13`

**Owner**: Ask O11y maintainers

**Module**: `pkg/mcp/selection.go`

---

## Purpose

The plugin narrows the MCP tool set by role and by per-server enablement before
the LLM sees it. The same two filters run again before a tool executes. Graphiti
tools also receive a forced org scope.

## Actors and RBAC

| Capability | Admin | Editor | Viewer | Evidence |
|---|---|---|---|---|
| See every tool | yes | yes | no | `pkg/rbac/rbac.go:13` |
| See read-only tools only | n/a | n/a | yes | `pkg/rbac/rbac.go:16` |
| Disable a tool per server | yes | yes | no — needs admin settings | `pkg/mcp/selection.go:20` |

Role names are matched case-sensitively. Any unknown role is treated as Viewer.
`VERIFIED` — test `TestCanAccessTool`

## Contract

### HTTP endpoints

| Method | Path | Handler | Evidence |
|---|---|---|---|
| GET | `/api/mcp/tools` | `handleMCPTools` | `pkg/plugin/plugin.go:729` |
| POST | `/api/mcp/call-tool` | `handleMCPCallTool` | `pkg/plugin/plugin.go:761` |

### SSE events

| Event | Payload fields | Evidence |
|---|---|---|
| none | filtering is silent | `pkg/plugin/plugin.go:747` |

### Configuration keys

| Key | Location | Default | Evidence |
|---|---|---|---|
| `mcpServers[].enabled` | `jsonData` | `false` | `pkg/mcp/selection.go:17` |
| `mcpServers[].toolSelections` | `jsonData` | empty map means all enabled | `pkg/mcp/types.go:99` |
| `builtInMCPToolSelections` | `jsonData` | empty map means all enabled | `pkg/plugin/plugin.go:92` |
| `useBuiltInMCP` | `jsonData` | `false` | `pkg/plugin/plugin.go:91` |

### MCP tool names

| Tool | Read-only | Evidence |
|---|---|---|
| `search_tools` | yes | `pkg/agent/search_tools.go:104` |
| `load_skill` | yes | `pkg/agent/loop.go:953` |
| Graphiti base names: `add_memory`, `search_memory_facts`, `search_memory_nodes`, `delete_entity_edge`, `delete_episode`, `clear_graph` | mixed | `pkg/mcp/selection.go:97` |

Both meta-tools bypass MCP filtering by design. `pkg/agent/loop.go:950`

## Behaviour Rules

1. Listing applies the role filter first, then the per-server selection filter. `VERIFIED` — `pkg/plugin/plugin.go:747`
2. An agent run applies the same two filters in the same order. `VERIFIED` — `pkg/agent/loop.go:161`
3. Execution re-checks the role and returns 403 on failure. `VERIFIED` — `pkg/plugin/plugin.go:802`
4. Execution re-checks selection and returns 403 `Tool is not enabled`. `VERIFIED` — `pkg/plugin/plugin.go:808`
5. The agent execution path returns a tool error instead of an HTTP status. `VERIFIED` — `pkg/agent/loop.go:977`
6. A Viewer gets only tools whose `readOnlyHint` is exactly `true`. `VERIFIED` — test `TestIsReadOnlyTool`
7. A tool with no annotations is not read-only. `VERIFIED` — `pkg/rbac/rbac.go:6`
8. Tool ownership resolves by the longest configured server-ID prefix, the same rule as `Proxy.ServerIDForTool`. `VERIFIED` — `pkg/mcp/selection.go:33`
9. A tool name without an underscore is always enabled. `VERIFIED` — test `TestIsToolEnabled`
10. A tool whose prefix matches no configured server is always enabled. `VERIFIED` — `pkg/mcp/selection.go:25`
11. A server with `Enabled: false` disables every tool of that server. `VERIFIED` — test `TestIsToolEnabled`
12. An explicit `toolSelections` entry wins. `VERIFIED` — `pkg/mcp/selection.go:20`
13. A missing `toolSelections` entry defaults to enabled. `VERIFIED` — `pkg/mcp/selection.go:23`
14. An empty server list passes every tool through unchanged. `VERIFIED` — test `TestFilterToolsBySelection_NoServers`
15. Filtering keeps the input order. `ASSUMED` — `pkg/mcp/selection.go:51` appends in order; no test asserts order
16. The built-in MCP contributes a synthetic config with ID `mcp-grafana` only when `useBuiltInMCP` is true. `VERIFIED` — `pkg/plugin/plugin.go:640`
17. That synthetic config carries `builtInMCPToolSelections` and the global `riskOverrides`. `VERIFIED` — `pkg/plugin/plugin.go:648`
18. `settingsForFilter` returns a copy of `mcpServers` plus the built-in overlay. `VERIFIED` — `pkg/plugin/plugin.go:657`
19. Graphiti tools get `group_id` forced to `org_<orgID>` when the schema has that property. `VERIFIED` — test `TestEnsureScopedGraphitiArgs`
20. Graphiti tools get `group_ids` forced to `["org_<orgID>"]` when the schema has that property. `VERIFIED` — `pkg/mcp/selection.go:80`
21. An LLM-supplied `group_id` value is always overwritten. `VERIFIED` — `pkg/mcp/selection.go:77`
22. Org scoping is skipped when the org ID is empty, the args are nil, or the schema lacks the property. `VERIFIED` — `pkg/mcp/selection.go:63`
23. A Graphiti tool is detected by `graphiti_` prefix, `_graphiti_` infix, or a base-name suffix. `VERIFIED` — `pkg/mcp/selection.go:85`
24. Risk classification resolves the server ID by the longest prefix, so a server ID that contains `_` is attributed correctly. `VERIFIED` — `pkg/mcp/risk.go:17`
25. The exposed tool list is not sorted. `GAP` — `pkg/mcp/proxy.go:137` iterates a map; no sort exists before the response at `pkg/plugin/plugin.go:754`
26. There is no per-skill tool filtering. `GAP` — `allowed-tools` is parsed (`pkg/skills/skill.go:87`) but nothing reads it
27. There is no per-agent or per-conversation-type tool allow-list. `GAP` — the only per-run exclusion is `ExcludeToolNames` (`pkg/agent/loop.go:163`)
28. Excluded tool names are removed after both standard filters. `VERIFIED` — `pkg/agent/loop.go:170`
29. The meta-tools `search_tools` and `load_skill` are dispatched before RBAC. `VERIFIED` — `pkg/agent/loop.go:951`
30. Tool search can hide tools behind `search_tools` when the definition budget is exceeded. `VERIFIED` — `pkg/agent/search_tools.go:33`
31. The `search_tools` path does not re-apply the selection filter. `GAP` — `pkg/agent/loop.go:951` returns before the checks at `pkg/agent/loop.go:974`

## Invariants

- A Viewer never receives or executes a non-read-only tool. `VERIFIED` — `pkg/rbac/rbac.go:16`
- Selection is enforced both at listing and at execution. `VERIFIED` — `pkg/plugin/plugin.go:808`
- Graphiti `group_id` is always the caller's org, never an LLM value. `VERIFIED` — `pkg/mcp/selection.go:76`

## Failure Modes

| Condition | User-visible result | Evidence |
|---|---|---|
| Viewer asks for a write tool | 403 `Access denied: Viewer role cannot access tool ...` | `pkg/plugin/plugin.go:804` |
| Tool disabled by selection | 403 `Tool is not enabled` | `pkg/plugin/plugin.go:810` |
| Agent calls a denied tool | Tool result `Access denied: ...` | `pkg/agent/loop.go:975` |
| Agent calls a disabled tool | Tool result `Tool ... is disabled in MCP server settings` | `pkg/agent/loop.go:978` |

## Data and Persistence

| Store | Key or table | TTL | Fallback | Evidence |
|---|---|---|---|---|
| Plugin settings | `mcpServers[].toolSelections` | none | missing key means enabled | `pkg/mcp/types.go:99` |

## Observability

| Signal | Name | Where | Evidence |
|---|---|---|---|
| Log field | `tool`, `role` | plugin warn log on denial | `pkg/plugin/plugin.go:803` |

## Evidence Index

- `pkg/mcp/selection.go:8` — selection predicate
- `pkg/mcp/selection.go:62` — Graphiti org scoping
- `pkg/rbac/rbac.go:12` — role predicate
- `pkg/agent/loop.go:161` — agent-side filter order
- `pkg/rbac/rbac_test.go` — `TestCanAccessTool` — role matrix

## Known Gaps

- Two different prefix-splitting rules exist. `selection.go` and `risk.go` split at the first underscore; `proxy.go` uses the longest registered prefix.
- No per-skill tool filtering. `allowed-tools` is parsed and discarded.
- No per-agent tool allow-list.
- Tool list order is unstable.
