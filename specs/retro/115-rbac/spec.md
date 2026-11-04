# Retro-Spec: RBAC Filtering

**Capability ID**: `115-rbac`

**Status**: Retrospective

**Last verified**: `6c09d13`

**Owner**: Ask O11y maintainers

**Module**: `pkg/rbac/`

## Purpose

A Viewer can read observability data but cannot change it through the agent.
Every tool list is filtered by role, and every direct call is checked again.
Admin and Editor keep full access.

## Actors and RBAC

| Capability | Admin | Editor | Viewer | Evidence |
|---|---|---|---|---|
| List MCP tools | yes | yes | yes, read-only only | `pkg/plugin/plugin.go:742` |
| Call a read-only tool | yes | yes | yes | `pkg/rbac/rbac.go:16` |
| Call a mutating or unannotated tool | yes | yes | no | `pkg/plugin/plugin.go:799` |
| Approve a pending tool call | yes | yes | no | `pkg/plugin/plugin.go:1449` |
| Read skill content with `?include=content` | yes | no | no | `pkg/plugin/plugin.go:1719` |

## Contract

### HTTP endpoints

| Method | Path | Handler | Evidence |
|---|---|---|---|
| any | `/api/mcp/tools` | `handleMCPTools` | `pkg/plugin/plugin.go:729` |
| POST | `/api/mcp/call-tool` | `handleMCPCallTool` | `pkg/plugin/plugin.go:756` |

### SSE events

| Event | Payload fields | Evidence |
|---|---|---|
| None. Denials reach the agent as a tool result string. | — | `pkg/agent/loop.go:976` |

### Configuration keys

| Key | Location | Default | Evidence |
|---|---|---|---|
| None. The role comes from Grafana, not from plugin settings. | — | — | `pkg/plugin/plugin.go:691` |

### MCP tool names

| Tool | Read-only | Evidence |
|---|---|---|
| Any tool with `readOnlyHint: true` | yes | `pkg/rbac/rbac.go:5` |
| Any tool with `readOnlyHint: false` or no annotations | no | `pkg/rbac/rbac.go:7` |

## Behaviour Rules

1. The role model is exactly `Admin`, `Editor`, and `Viewer`, taken from the SDK plugin context. `VERIFIED` — `pkg/plugin/plugin.go:691`
2. When the context has no user, the role is `Viewer`, the least privileged value. `VERIFIED` — `pkg/plugin/plugin.go:700`
3. Client headers cannot set the role. `VERIFIED` — test `TestGetUserRoleIgnoresHeaders`
4. `IsReadOnlyTool` is true only when annotations exist and `ReadOnlyHint` is true. `VERIFIED` — `pkg/rbac/rbac.go:6`
5. A tool with no annotations is treated as mutating, so a Viewer cannot see it. `VERIFIED` — `pkg/rbac/rbac.go:7`
6. The three annotation cases are tested. `VERIFIED` — test `TestIsReadOnlyTool`
7. `CanAccessTool` returns true for `Admin` and `Editor` for every tool. `VERIFIED` — `pkg/rbac/rbac.go:13`
8. Any role other than Admin or Editor falls through to the read-only check. `VERIFIED` — `pkg/rbac/rbac.go:16`
9. The full role and tool matrix is tested, including an unknown role. `VERIFIED` — test `TestCanAccessTool`
10. `FilterToolsByRole` returns the input list untouched for Admin and Editor. `VERIFIED` — `pkg/rbac/rbac.go:20`
11. `FilterToolsByRole` keeps only read-only tools for every other role. `VERIFIED` — `pkg/rbac/rbac.go:25`
12. The filter is tested for Admin, Editor, Viewer, and an empty list. `VERIFIED` — test `TestFilterToolsByRole`
13. `GET /api/mcp/tools` filters the list after it is fetched. `VERIFIED` — `pkg/plugin/plugin.go:742`
14. Tool selection filtering runs after the RBAC filter, so selection cannot widen access. `VERIFIED` — `pkg/plugin/plugin.go:743`
15. The agent loop applies the same filter when it builds its tool list. `VERIFIED` — `pkg/agent/loop.go:162`
16. A direct tool call is checked again before dispatch. `VERIFIED` — `pkg/plugin/plugin.go:797`
17. The agent loop checks again inside `executeTool`. `VERIFIED` — `pkg/agent/loop.go:975`
18. A Viewer calling a mutating tool gets HTTP 403 with `Access denied: Viewer role cannot access tool <name>`. `VERIFIED` — `pkg/plugin/plugin.go:799`
19. The denial uses `http.Error`, so the body is plain text and the status is 403. `VERIFIED` — `pkg/plugin/plugin.go:799`
20. Inside the agent loop the denial becomes a tool result with `isError` set and kind `tool`. `VERIFIED` — `pkg/agent/loop.go:976`
21. An unknown tool name returns 404 before the RBAC check. `VERIFIED` — `pkg/plugin/plugin.go:793`
22. A disabled tool returns 403 `Tool is not enabled` after the RBAC check. `VERIFIED` — `pkg/plugin/plugin.go:805`
23. `pkg/agent/tools.go` applies no filter; it converts whatever list it receives to OpenAI format. `VERIFIED` — `pkg/agent/tools.go:7`
24. The conversion therefore relies on the caller filtering first, which `loop.go` does. `VERIFIED` — `pkg/agent/loop.go:162`
25. The raw JSON-RPC `/mcp` route is not registered, so it cannot bypass RBAC. `VERIFIED` — test `TestRawMCPRouteIsNotRegistered`
26. `GET /api/mcp/tools` does not check the HTTP method. `GAP` — `pkg/plugin/plugin.go:729`
27. Reading or cancelling a run depends on ownership, not on the role. `VERIFIED` — `pkg/plugin/plugin.go:1336`

Coverage: `VERIFIED` = code pointer or test; `ASSUMED` = code suggests, no test; `GAP` = missing or contradictory.

## Invariants

- A Viewer never sees a tool whose `readOnlyHint` is not true. `VERIFIED` — `pkg/rbac/rbac.go:25`
- The execution check and the listing check use the same predicate. `VERIFIED` — `pkg/rbac/rbac.go:12`
- An unannotated tool is denied to a Viewer. `VERIFIED` — `pkg/rbac/rbac.go:7`
- The role is never read from a request header. `VERIFIED` — `pkg/plugin/plugin.go:697`

## Failure Modes

| Condition | User-visible result | Evidence |
|---|---|---|
| Viewer calls a mutating tool | 403 `Access denied: Viewer role cannot access tool <name>` | `pkg/plugin/plugin.go:799` |
| Viewer runs an agent that tries a mutating tool | Tool result `Access denied: Viewer role cannot access tool <name>` | `pkg/agent/loop.go:976` |
| Role is unknown | Treated as Viewer for mutating tools | `pkg/rbac/rbac.go:16` |
| Role is missing from the context | Resolved as `Viewer` | `pkg/plugin/plugin.go:700` |
| Tool is unknown | 404 `Unknown tool: <name>` | `pkg/plugin/plugin.go:793` |
| Tool is disabled by selection | 403 `Tool is not enabled` | `pkg/plugin/plugin.go:805` |

## Data and Persistence

| Store | Key or table | TTL | Fallback | Evidence |
|---|---|---|---|---|
| None. RBAC is evaluated per request from the plugin context. | — | — | `Viewer` | `pkg/plugin/plugin.go:700` |

## Observability

| Signal | Name | Where | Evidence |
|---|---|---|---|
| Span | `mcp_tool_call` | Grafana tracing exporter | `pkg/agent/loop.go:961` |
| Span attribute | `mcp.tool_name`, `mcp.is_error` | `mcp_tool_call` span | `pkg/agent/loop.go:962` |
| Metric | None. No denial counter exists. | — | `pkg/plugin/plugin.go:798` |
| Log field | `tool`, `role` | Plugin logger on denial | `pkg/plugin/plugin.go:798` |
| Log field | `role`, `totalTools`, `filteredTools` | Plugin logger on listing | `pkg/plugin/plugin.go:745` |

## Evidence Index

- `pkg/rbac/rbac.go:5` — read-only predicate
- `pkg/rbac/rbac.go:12` — access predicate
- `pkg/rbac/rbac.go:19` — list filter
- `pkg/plugin/plugin.go:742` — listing filter call site
- `pkg/plugin/plugin.go:797` — execution check call site
- `pkg/agent/loop.go:162` — agent list filter
- `pkg/agent/loop.go:975` — agent execution check
- `pkg/rbac/rbac_test.go` — `TestCanAccessTool` — 11-case matrix
- `pkg/rbac/rbac_test.go` — `TestFilterToolsByRole` — 4-case matrix
- `pkg/plugin/security_hardening_test.go` — `TestGetUserRoleIgnoresHeaders` — header rejection

## Known Gaps

- `/api/mcp/tools` accepts any HTTP method. A forward spec should restrict it to GET.
- There is no metric for RBAC denials, so a Viewer probing mutating tools is visible only in logs.
- `Editor` and `Admin` are treated identically everywhere. A forward spec should state whether that is permanent.
