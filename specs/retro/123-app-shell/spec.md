# Retro-Spec: App Config UI, Shell, and Services

**Capability ID**: `123-app-shell`
**Status**: Retrospective
**Last verified**: `7e50ade`
**Owner**: Ask O11y maintainers
**Module**: `src/module.tsx`, `src/components/AppConfig/`, `src/services/`, `src/utils/`

---

## Purpose

An admin tunes the agent, the MCP servers, the skills, and the display from one settings page. Every user reaches the chat through one app shell.

## Actors and RBAC

| Capability                  | Admin | Editor | Viewer | Evidence              |
| --------------------------- | ----- | ------ | ------ | --------------------- |
| Open the app page           | yes   | yes    | yes    | `src/plugin.json:65`  |
| Open the Configuration page | yes   | no     | no     | `src/plugin.json:76`  |
| Use a read-only MCP tool    | yes   | yes    | yes    | `pkg/rbac/rbac.go:5`  |
| Use a write MCP tool        | yes   | yes    | no     | `pkg/rbac/rbac.go:12` |

Configuration is gated twice: the nav entry requires role `Admin`, and the action is `settings:write`.

## Contract

### HTTP endpoints

| Method | Path                                                               | Handler                 | Evidence                                      |
| ------ | ------------------------------------------------------------------ | ----------------------- | --------------------------------------------- |
| GET    | `/api/plugins/consensys-asko11y-app/resources/api/prompt-defaults` | `AppConfig` init        | `src/components/AppConfig/AppConfig.tsx:134`  |
| GET    | `…/api/graphiti/status`                                            | `AppConfig` mount       | `src/components/AppConfig/AppConfig.tsx:1026`  |
| POST   | `…/api/graphiti/discover`                                          | `onBuildKnowledgeGraph` | `src/components/AppConfig/AppConfig.tsx:1025` |
| GET    | `…/api/agent/runs/{runId}`                                         | discovery poll          | `src/components/AppConfig/AppConfig.tsx:969`  |
| PUT    | `/api/plugins/{pluginId}/settings`                                 | `updatePluginAndReload` | `src/components/AppConfig/AppConfig.tsx:2189` |

### SSE events

| Event | Payload fields                        | Evidence                                   |
| ----- | ------------------------------------- | ------------------------------------------ |
| —     | the config page consumes no SSE event | `src/components/AppConfig/AppConfig.tsx:1` |

### Configuration keys

| Key                       | Location   | Default                 | Evidence                                      |
| ------------------------- | ---------- | ----------------------- | --------------------------------------------- |
| `maxTotalTokens`          | `jsonData` | `64000`                 | `src/components/AppConfig/AppConfig.tsx:135`  |
| `approvalPolicy`          | `jsonData` | `approval-gated-writes` | `src/components/AppConfig/AppConfig.tsx:412`  |
| `maxParallelToolCalls`    | `jsonData` | `4`                     | `src/components/AppConfig/AppConfig.tsx:413`  |
| `toolSearch.mode`         | `jsonData` | `auto`                  | `src/components/AppConfig/AppConfig.tsx:151`  |
| `toolSearch.budgetTokens` | `jsonData` | `6000`                  | `src/components/AppConfig/AppConfig.tsx:152`  |
| `useBuiltInMCP`           | `jsonData` | `false`                 | `src/components/AppConfig/AppConfig.tsx:450`  |
| `mcpServers`              | `jsonData` | `[]`                    | `src/components/AppConfig/AppConfig.tsx:446`  |
| `kioskModeEnabled`        | `jsonData` | `true`                  | `src/components/AppConfig/AppConfig.tsx:456`  |
| `chatPanelPosition`       | `jsonData` | `right`                 | `src/components/AppConfig/AppConfig.tsx:459`  |
| `skills.entries`          | `jsonData` | `{}`                    | `src/components/AppConfig/AppConfig.tsx:1065` |

### MCP tool names

| Tool | Read-only                         | Evidence                                    |
| ---- | --------------------------------- | ------------------------------------------- |
| —    | the config page calls no MCP tool | `src/components/AppConfig/AppConfig.tsx:21` |

## Behaviour Rules

1. The plugin registers one root page and one config page with id `configuration`. `VERIFIED` — `src/module.tsx:32`
2. Both entries load lazily, behind a Suspense fallback. `VERIFIED` — `src/module.tsx:9`
3. Each entry has an error boundary titled "Application Error" or "Configuration Error". `VERIFIED` — `src/module.tsx:14`
4. Both entries render inside `PluginRoot`, which supplies the Grafana theme. `VERIFIED` — `src/module.tsx:13`
5. `/shared/:shareId` renders `SharedSession`; every other path renders `Home`. `VERIFIED` — `src/components/App/App.tsx:33`
6. `App` shows `AppLoader` until i18n init resolves, and swallows an i18n failure. `VERIFIED` — `src/components/App/App.tsx:27`
7. Plugin settings come from `props.meta.jsonData`. `VERIFIED` — `src/components/App/App.tsx:10`
8. `usePluginJsonData` returns `context.meta.jsonData`, or undefined without context. `VERIFIED` — test `should return undefined when jsonData is missing`
9. `plugin.json` exposes the app at `/a/%PLUGIN_ID%` with action `agent:read`. `VERIFIED` — `src/plugin.json:64`
10. The Configuration nav entry requires role `Admin` and action `settings:write`. `VERIFIED` — `src/plugin.json:76`
11. Role grants: Reader to Viewer, Editor, Admin; Operator to Editor, Admin; Administrator to Admin. `VERIFIED` — `src/plugin.json:90`
12. The config page has seven tabs in fixed order: General, Agent Runtime, MCP, Service Graph, Skills, Workflows, Prompts. `VERIFIED` — `src/components/AppConfig/AppConfig.tsx:164`
13. The tab is restored from sessionStorage after a save and reload. `VERIFIED` — test `restores the active settings tab from session storage`
14. A tab change rewrites the hash with `replaceState` and stores the tab. `ASSUMED` — `src/components/AppConfig/AppConfig.tsx:416`
15. A dirty tab shows `*` plus an "Unsaved changes" Alert. `VERIFIED` — test `shows unsaved changes notice for edited settings tabs`
16. Saving reloads the page and returns to the same tab. `VERIFIED` — test `should return to the active settings tab after saving`
17. The Skills tab never counts as dirty, because it saves on each action. `VERIFIED` — `src/components/AppConfig/AppConfig.tsx:585`
18. General writes `maxTotalTokens`. `VERIFIED` — `src/components/AppConfig/AppConfig.tsx:1103`
19. `maxTotalTokens` must be 1000..1000000; Save is disabled outside it. `VERIFIED` — test `should save valid config and reject invalid token limits`
20. General also writes `kioskModeEnabled` and `chatPanelPosition` in the same save as `maxTotalTokens`, through the single "Save general settings" button. `VERIFIED` — `src/components/AppConfig/AppConfig.tsx:1104`, `src/components/AppConfig/AppConfig.tsx:1920`
21. Agent Runtime writes the approval policy, the parallel-call cap, eval capture, four context limits, summarization, and tool search. `VERIFIED` — `src/components/AppConfig/AppConfig.tsx:1110`
22. `maxParallelToolCalls` must be 1..16. `VERIFIED` — `src/components/AppConfig/AppConfig.tsx:1294`
23. Tool search mode is `off`, `auto`, or `on`. `VERIFIED` — `src/components/AppConfig/AppConfig.tsx:154`
24. Discovery threshold input shows only in `auto` mode and must be 1..100000. `VERIFIED` — `src/components/AppConfig/AppConfig.tsx:1338`
25. `alwaysInclude` splits on commas, trims each name, and drops empty entries. `VERIFIED` — `src/components/AppConfig/AppConfig.tsx:1134`
26. MCP writes `mcpServers`, `useBuiltInMCP`, `builtInMCPToolSelections`, `useLocalGrafanaURL`, `localGrafanaPort`, and `trustedMCPServers`. `VERIFIED` — `src/components/AppConfig/AppConfig.tsx:1195`
27. A new server gets id `mcp-<epoch>`, name "New MCP Server", type `streamable-http`, and enabled state. `VERIFIED` — `src/components/AppConfig/AppConfig.tsx:738`
28. A blank server name blocks save with "Server name is required". `VERIFIED` — `src/components/AppConfig/AppConfig.tsx:1150`
29. A non-empty URL must be http or https, or save is blocked. `VERIFIED` — `src/services/validation.ts:82`
30. A server without a name renders "Unnamed Server". `VERIFIED` — test `should show "Unnamed Server" when name is cleared`
31. Server types are `openapi`, `standard`, `sse`, and `streamable-http`. `VERIFIED` — test `should add, configure, and remove MCP servers`
32. A server holds at most 10 custom headers. `VERIFIED` — `src/components/AppConfig/AppConfig.tsx:803`
33. A blank header key disables the Add Header button. `VERIFIED` — test `should disable add-header when incomplete header exists`
34. Header values save to `secureJsonData` as `mcpServerHeader.<serverId>.<key>`. `VERIFIED` — `src/components/AppConfig/AppConfig.tsx:887`
35. A duplicate normalised header key blocks save and shows an error Alert. `VERIFIED` — `src/components/AppConfig/AppConfig.tsx:1183`
36. The built-in MCP toggle is disabled when `grafana-llm-app` MCP is unavailable. `VERIFIED` — `src/components/AppConfig/AppConfig.tsx:1541`
37. Server status badges poll every 15 s and read "Status unknown" without data. `VERIFIED` — `src/components/AppConfig/AppConfig.tsx:461`
38. Removing a server stages its stored header secrets for deletion. `ASSUMED` — `src/components/AppConfig/AppConfig.tsx:769`
39. The Skills tab writes `jsonData.skills.entries` on each action. `VERIFIED` — `src/components/AppConfig/AppConfig.tsx:1065`
40. Toggling a pristine bundled skill keeps any override content. `VERIFIED` — `src/components/AppConfig/SkillsTab.tsx:74`
41. Prompt templates render only after the defaults load. `VERIFIED` — `src/components/AppConfig/AppConfig.tsx:1856`
42. A system prompt over 15000 characters blocks save and shows an error Alert. `VERIFIED` — `src/components/AppConfig/AppConfig.tsx:1041`
43. `canAccessTool` gives Admin and Editor every tool, and Viewer only `readOnlyHint` tools. `VERIFIED` — test `should allow Viewer to read-only tools only`
44. `filterToolsByRole` is never called from the UI. `GAP` — no reference outside `src/utils/`
45. The backend applies the same rule for listing and execution. `VERIFIED` — `pkg/rbac/rbac.go:19`
46. `PLUGIN_BASE_URL` is `/a/consensys-asko11y-app`, and `prefixRoute` appends a path. `VERIFIED` — test `should prefix route with plugin base URL`
47. AppConfig test ids carry a literal `data-testid ` prefix. `VERIFIED` — `src/components/testIds.ts:9`
48. `MCPToolsPage` exists but no route mounts it. `GAP` — `src/pages/MCPTools.tsx:27` has no importer
49. URL writes go through `locationService.replace`, never `window.location` or `window.history`. `VERIFIED` — `src/hooks/useSessionUrl.ts:32`, `src/components/AppConfig/AppConfig.tsx:416`
50. The URL is read through `locationService`, never `window.location`. `VERIFIED` — `src/hooks/useSessionUrl.ts:24`, `src/components/AppConfig/AppConfig.tsx:355`
51. Destructive actions confirm with `@grafana/ui` `ConfirmModal`, never a native `confirm`. `VERIFIED` — `src/components/Chat/components/SessionSidebar/SessionSidebar.tsx:243`
    Coverage tags:

| Tag        | Meaning                                        | Review action                    |
| ---------- | ---------------------------------------------- | -------------------------------- |
| `VERIFIED` | A code pointer or a test proves the rule       | Accept without reading           |
| `ASSUMED`  | Code suggests it, no test proves it            | Human must confirm or veto       |
| `GAP`      | Behaviour is absent, unclear, or contradictory | Becomes a candidate forward spec |

## Invariants

- Every saved tab spreads `savedJsonData` first, so one tab never erases another. `VERIFIED` — `src/components/AppConfig/AppConfig.tsx:1181`
- A settings save reloads the page. `VERIFIED` — `src/components/AppConfig/AppConfig.tsx:2222`
- The plugin never writes `useBuiltInMCP: true` into `provisioning/plugins/full.yaml_`. `VERIFIED` — `.specify/memory/constitution.md:40`

## Failure Modes

| Condition                     | User-visible result                      | Evidence                                      |
| ----------------------------- | ---------------------------------------- | --------------------------------------------- |
| `maxTotalTokens` out of range | Field error, Save disabled               | `src/components/AppConfig/AppConfig.tsx:1290` |
| MCP name empty                | Field error "Server name is required"    | `src/components/AppConfig/AppConfig.tsx:1629` |
| MCP URL invalid               | Field error from `validateMCPServerURL`  | `src/components/AppConfig/AppConfig.tsx:1645` |
| Duplicate header key          | Save does nothing, no message            | `src/components/AppConfig/AppConfig.tsx:1186` |
| Built-in MCP missing          | Warning Alert "Built-in MCP unavailable" | `src/components/AppConfig/AppConfig.tsx:1518` |
| Lazy chunk fails              | Error boundary "Application Error"       | `src/module.tsx:14`                           |

## Data and Persistence

| Store                 | Key or table                       | TTL             | Fallback        | Evidence                                     |
| --------------------- | ---------------------------------- | --------------- | --------------- | -------------------------------------------- |
| Plugin jsonData       | all keys above                     | plugin lifetime | constants above | `src/components/AppConfig/AppConfig.tsx:386` |
| Plugin secureJsonData | `mcpServerHeader.<serverId>.<key>` | plugin lifetime | empty           | `src/components/AppConfig/AppConfig.tsx:887` |
| sessionStorage        | `settings.activeTab`               | tab lifetime    | `general`       | `src/components/AppConfig/AppConfig.tsx:162` |

## Observability

| Signal    | Name                                                        | Where | Evidence |
| --------- | ----------------------------------------------------------- | ----- | -------- |
| Span      | none                                                        | —     | `GAP`    |
| Log field | none; failed saves surface through the Grafana settings API | —     | `GAP`    |

## Evidence Index

- `src/module.tsx:32` — plugin registration
- `src/components/AppConfig/AppConfig.tsx:164` — tab list
- `src/utils/rbac.ts:22` — client RBAC helper
- `pkg/rbac/rbac.go:12` — server RBAC rule
- `tests/appConfig.spec.ts` — `should add, configure, and remove MCP servers` — MCP editor contract
- `tests/mcpAdvancedOptions.spec.ts` — `should manage headers lifecycle` — header contract

## Known Gaps

- A duplicate header key blocks save with no feedback. Forward spec: MCP header validation.
- `filterToolsByRole` is unused, so the UI shows no role-based tool filtering. Forward spec: UI RBAC.
- `MCPToolsPage` is unreferenced. Forward spec: tool management route.
- The config page emits no spans, metrics, or log fields. Forward spec: settings observability.
