# CLAUDE.md

## Project Overview

**Ask O11y** is a Grafana app plugin providing AI-powered observability assistance via natural language. Users query metrics, logs, traces, and manage dashboards without writing PromQL/LogQL.

**Stack:** TypeScript/React 18 (strict) + Go 1.21+ monorepo with YAML infrastructure configs. Key technologies: Grafana plugin SDK, Tailwind CSS, MCP protocol, Kubernetes/ArgoCD deployments, Redis, Tempo, Loki, Mimir. Always run lint and tests before considering a task complete.

**Architecture:** Server-side agentic loop (Go) streams SSE to React frontend. MCP proxy aggregates multiple tool servers. RBAC enforced at tool listing and execution via `ToolAnnotations`.

## Exploration & Investigation Rules

When asked to explore a codebase or investigate an issue, limit initial exploration to 3-5 targeted file reads before proposing a plan. Do NOT do exhaustive grep/search loops. If you haven't found what you need in 5 minutes of exploration, stop and ask the user for direction.

## Commands

Always chain with `nvm use 22 &&` — shell state doesn't persist between Bash calls.

```bash
nvm use 22 && npm run server          # Start dev environment (Docker)
nvm use 22 && npm run server:full     # Multi-org dev environment
nvm use 22 && npm run build           # Full production build
nvm use 22 && npm run build:backend   # Backend only (current platform)
nvm use 22 && npm run test:ci         # Frontend unit tests
nvm use 22 && npm run lint            # Linting
nvm use 22 && npm run typecheck       # Type checking
nvm use 22 && npm run validate:openapi # OpenAPI spec validation
nvm use 22 && npm run validate        # Full Grafana plugin validator (build + archive + run)
nvm use 22 && npm run validate:clean  # Remove validator zip artifacts
nvm use 22 && npm run e2e             # Playwright E2E tests
go test ./pkg/...                     # Backend tests
docker compose restart grafana        # Reload after backend rebuild
```

## Quality Gates (after every code change)

1. **Build compiles** — `npm run build` (frontend) + `npm run build:backend` (Go)
2. **OpenAPI spec** — update `pkg/plugin/openapi/openapi.json` and run `validate:openapi` if routes changed
3. **Code review** — fix critical/major/medium issues
4. **Clean AI noise** — remove comments that restate code; only keep non-obvious *why* comments
5. **Tests & lint** — `npm run test:ci`, `go test ./pkg/...`, `npm run lint`, `npm run typecheck`
6. **Plugin validator** — run `npm run validate` before PR. It builds, archives, and runs `@grafana/plugin-validator`. Expected benign findings: `unsigned plugin` (MANIFEST.txt is produced at CI sign step) and the optional sponsor-link recommendation. Any other `warning`/`error` must be fixed. Clean up with `npm run validate:clean`.

**Severity policy:** Critical = fix now. Major = fix before commit. Medium = fix before PR. Low = optional.

## Definition of Done

Feature is not done until: tests written, all tests pass, RBAC reviewed, no hardcoded colors.

## Architecture

**Frontend** (`src/`): functional components + hooks, thin service layer in `services/`, async/await only, no class components.

**Backend** (`pkg/`):
- `agent/` — agentic loop: LLM → tool calls → repeat (max 25 iterations)
- `plugin/` — HTTP routes, RBAC, session store, shares, rate limiting
- `mcp/` — MCP client/proxy, multi-server aggregation, health monitoring
- `rbac/` — annotation-based RBAC (`readOnlyHint`)

**Agentic flow:** Frontend POSTs to `/api/agent/run` → backend streams SSE (`content`, `tool_call_start`, `tool_call_result`, `done`, `error`)

## Multi-Org Constraints (CRITICAL)

SA token from `backend.GrafanaConfigFromContext()` is always Org 1 ([grafana#91844](https://github.com/grafana/grafana/issues/91844)).

- `useBuiltInMCP: true` only works for Org 1
- LLM client intentionally omits `X-Grafana-Org-Id` with SA token auth (non-Org-1 header → 401)
- **NEVER set `useBuiltInMCP: true` in `full.yaml_`** — use external `mcp-grafana` sidecar instead

## MCP Configuration

- **Built-in only**: `useBuiltInMCP: true` (Org 1 only)
- **External only**: external servers in provisioning, `useBuiltInMCP: false`
- **Combined**: both — external tools auto-prefixed `{serverid}_`

Add external servers in `provisioning/plugins/app.yaml`:
```yaml
mcpServers:
  - id: 'server-id'
    name: 'Display Name'
    url: 'http://server:8000/endpoint'
    enabled: true
    type: 'streamable-http'  # openapi | standard | sse | streamable-http
```

## Code Style

- **No `console.*`** — surface errors in UI; use Grafana SDK logger in Go (`backend/log`)
- **No hardcoded colors** — use semantic Tailwind: `bg-background`, `text-primary`, `border-weak`, etc.
- **No `any`** — use `unknown`
- **No raw errors in HTTP responses** — log server-side, return generic message to client
- **No `&http.Client{}` direct construction** — always use `github.com/grafana/grafana-plugin-sdk-go/backend/httpclient.New()`. When wrapping for custom headers, copy `.Timeout` from the SDK client into the wrapper. Never create a bare `&http.Client{}` as a fallback — propagate the error instead.
- Prefer `@grafana/ui` components over custom implementations
- Catch blocks must handle errors meaningfully — never swallow silently
- **Fail fast on errors** — never implement fallback/default behavior unless explicitly asked. If a dependency is missing or a call fails, surface the error immediately rather than silently degrading.

## OpenAPI Spec

Spec at `pkg/plugin/openapi/openapi.json` — update when adding/modifying routes. Always run `validate:openapi` after changes. Commit spec and code changes together.

## Testing

- Unit tests: Jest + React Testing Library in `src/` (`*.test.{ts,tsx}`), use `data-testid` from `src/components/testIds.ts`
- E2E tests: Playwright, `data-testid` selectors, mock externals with `page.route`, 3–5 tests per file
- Test RBAC with Admin, Editor, Viewer roles

## Commit Format (CI-enforced)

`type(scope): description` — lowercase, imperative, no period.

**Types:** feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert

**Scopes:** chat, mcp, session, config, rbac, oauth, share, viz, backend, ui, frontend, deps, release, ci, main

## Configuration Files

- `provisioning/plugins/app.yaml` — single-org config
- `provisioning/plugins/full.yaml_` — multi-org (trailing `_` prevents auto-load; `server:full` swaps it in)
- `docker-compose.yaml` / `docker-compose-full.yaml` — dev environments
- `mcpo/config.json` — external MCP proxy (mcpo) server config
- `.config/` — DO NOT EDIT (scaffolded by `@grafana/create-plugin`)

## Documentation Conventions

When writing documentation or adding content to files, carefully distinguish between developer-facing files (CLAUDE.md, CONTRIBUTING.md) and user-facing files (README.md). Ask if unsure which file is appropriate.

## Code Review Guidelines

When asked for a code review or security review, produce concrete findings with file paths and line numbers. Never respond with only a git status or general statements. If no issues are found, explicitly state that with evidence of what was checked.

---

## Architecture Index

### Module Map

**Backend (`pkg/`)**
| Package | Key files | Purpose |
|---|---|---|
| `pkg/` | `main.go` | Plugin binary entry; registers Plugin with Grafana SDK |
| `pkg/plugin/` | `plugin.go` | Plugin struct, `registerRoutes()`, health check, instance init/dispose |
| | `config.go` | `PluginSettings` struct, settings + secure settings parsing |
| | `sessionstore.go` / `sessionstore_redis.go` | `SessionStoreInterface` — in-memory + Redis impls |
| | `runstore.go` / `runstore_redis.go` | Agent run state persistence (active SSE runs) |
| | `shares.go` / `shares_redis.go` | Shareable session links |
| | `ratelimit.go` | `RateLimiter` interface — `InMemoryRateLimiter` + `RedisRateLimiter` (per-user token bucket) |
| | `prompts.go` / `prompt_defaults.go` | System prompt assembly, `/api/prompt-defaults` handler |
| | `openapi/openapi.go` | OpenAPI spec serving + validation |
| `pkg/agent/` | `loop.go` | Main agentic loop, SSE event streaming (max 25 iterations) |
| | `llm_client.go` | LLM API client (proxied via grafana-llm-app) |
| | `tools.go` | Tool dispatch to MCP proxy, RBAC check |
| | `context_window.go` | Message history truncation to fit LLM context window |
| | `types.go` | `Message`, `ToolCall`, SSE event types |
| `pkg/mcp/` | `proxy.go` | `Proxy` — aggregates multiple `Client` instances, routes tool calls |
| | `client.go` | MCP protocol HTTP client (`mcp/list-tools`, `mcp/call-tool`) |
| | `health.go` | `HealthMonitor` — polls server health on interval |
| | `types.go` | `ServerConfig`, `Tool`, `ToolAnnotations` |
| `pkg/rbac/` | `rbac.go` | `IsReadOnlyTool()`, `CanAccessTool()`, `FilterToolsByRole()` — Viewer = readOnly tools only |

**Frontend (`src/`)**
| Path | Purpose |
|---|---|
| `src/module.tsx` | Grafana plugin entry; registers App + config page |
| `src/components/App/` | Root app router |
| `src/components/AppConfig/` | Plugin settings UI (MCP servers, LLM config) |
| `src/components/AppLoader/` | Auth/config gate before rendering |
| `src/components/Chat/` | Main chat interface — sub-components, hooks, utils, scenes |
| `src/components/Chat/components/` | SessionSidebar, PromptEditor, QuickSuggestions, SidePanel, WelcomeMessage |
| `src/components/Chat/utils/` | PromQL parser, Grafana link parser, query analyzer, viz datasource resolver |
| `src/components/Chat/scenes/` | Grafana Scenes integration for inline visualizations |
| `src/components/MCPStatus/` | MCP server health status display |
| `src/services/agentClient.ts` | POST `/api/agent/run`, consume SSE stream |
| `src/services/backendMCPClient.ts` | MCP tools + servers endpoints |
| `src/services/backendSessionClient.ts` | Session CRUD |
| `src/services/sessionShare.ts` | Share link create/delete/get |
| `src/hooks/` | `usePluginJsonData`, `useAlertInvestigation`, `useSessionUrl` |
| `src/utils/` | Routing helpers, RBAC utils |
| `src/components/testIds.ts` | All `data-testid` constants (use for tests) |

### Dependency Graph (internal Go packages)

```
plugin ──► agent ──► mcp
plugin ──► rbac  ──► mcp
agent  ──► mcp
```

Frontend `src/services/` → HTTP → backend `pkg/plugin/`

### API Surface

All routes are under: `/api/plugins/consensys-asko11y-app/resources/`  
Registered in [pkg/plugin/plugin.go:339](pkg/plugin/plugin.go#L339)

| Endpoint | Handler | Purpose |
|---|---|---|
| `GET /health` | `handleHealth` | Health check |
| `GET /openapi.json` | `handleOpenAPISpec` | OpenAPI spec |
| `* /mcp` | `handleMCP` | MCP protocol passthrough (built-in) |
| `GET /api/mcp/tools` | `handleMCPTools` | List tools (RBAC-filtered by role) |
| `POST /api/mcp/call-tool` | `handleMCPCallTool` | Execute tool (RBAC-enforced) |
| `GET /api/mcp/servers` | `handleMCPServers` | List MCP servers + health status |
| `POST /api/agent/run` | `handleAgentRun` | Start agent run → SSE stream |
| `GET/DELETE /api/agent/runs/{id}` | `handleAgentRuns` | Get or cancel a run |
| `GET /api/prompt-defaults` | `handlePromptDefaults` | Default system prompts |
| `GET,POST /api/sessions` | `handleSessionsRoot` | List / create sessions |
| `GET,PUT,DELETE /api/sessions/{id}` | `handleSessionRouter` | Session CRUD |
| `GET /api/sessions/current` | `handleSessionCurrent` | Get active session |
| `POST /api/sessions/share` | `handleCreateShare` | Create share link (rate-limited) |
| `DELETE /api/sessions/share/{id}` | `handleDeleteShare` | Delete share link |
| `GET /api/sessions/shared/{id}` | `handleGetSharedSession` | Load a shared session |

### Data Flow

```
User input
  → src/services/agentClient.ts         POST /api/agent/run
  → pkg/plugin/plugin.go handleAgentRun
      → pkg/plugin/ratelimit.go         CheckLimit(userID)
      → pkg/plugin/prompts.go           assemble system prompt
      → pkg/agent/loop.go               RunAgentLoop()
          → pkg/agent/llm_client.go     stream from LLM (grafana-llm-app proxy)
          → pkg/agent/tools.go          dispatch tool call
              → pkg/rbac/rbac.go        CanAccessTool(role, tool)
              → pkg/mcp/proxy.go        route to correct MCP server client
                  → pkg/mcp/client.go   HTTP POST mcp/call-tool
                      → Grafana APIs (Mimir/Loki/Tempo) or built-in MCP
          → SSE events: content | tool_call_start | tool_call_result | done | error
  → Chat component renders streaming response + inline visualizations
```

### Test Locations

| Scope | Files | Command |
|---|---|---|
| All Go | `pkg/**/*_test.go` | `go test ./pkg/...` |
| Agent | `pkg/agent/*_test.go` | `go test ./pkg/agent/...` |
| MCP proxy | `pkg/mcp/proxy_test.go` | `go test ./pkg/mcp/...` |
| Plugin/routes | `pkg/plugin/*_test.go`, `*_redis_test.go` | `go test ./pkg/plugin/...` |
| RBAC | `pkg/rbac/rbac_test.go` | `go test ./pkg/rbac/...` |
| Frontend unit | `src/**/*.test.{ts,tsx}` | `nvm use 22 && npm run test:ci` |
| E2E Playwright | `tests/*.spec.ts` | `nvm use 22 && npm run e2e` |

E2E specs: `chat`, `sessionManagement`, `sessionSharing`, `appConfig`, `mcpAdvancedOptions`, `combinedMCP`, `errorHandling`, `sidePanel`

### Known Gotchas

1. **SA token always Org 1** — `backend.GrafanaConfigFromContext()` SA token is Org 1 only; `X-Grafana-Org-Id` with SA auth → 401. Never `useBuiltInMCP: true` in `full.yaml_`.
2. **External tool name prefix** — tools from external MCP servers are auto-prefixed `{serverid}_`.
3. **RBAC enforcement** — Viewers only access `readOnlyHint: true` tools; enforced in `pkg/rbac/rbac.go`, applied in `handleMCPTools` + `handleMCPCallTool`.
4. **Rate limiter** — `InMemoryRateLimiter` (single instance) vs `RedisRateLimiter` (HA). Selected at init based on Redis availability (`pkg/plugin/ratelimit.go`).
5. **Context window management** — `pkg/agent/context_window.go` truncates message history when approaching LLM limits.
6. **No bare `http.Client{}`** — always `httpclient.New()` from Grafana SDK; copy `.Timeout` into any wrapper. Never use `&http.Client{}` as fallback — propagate the error.
7. **SSE stream termination** — `done` event ends the stream; `error` event must be surfaced to user (never swallowed).
8. **Session vs Run** — a `Session` is a persistent conversation (stored in Redis); a `Run` is one agent execution within a session (streamed via SSE, also Redis-persisted).
