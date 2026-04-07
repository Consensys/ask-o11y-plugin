# CLAUDE.md

## Project Overview

**Ask O11y** is a Grafana app plugin providing AI-powered observability assistance via natural language. Users query metrics, logs, traces, and manage dashboards without writing PromQL/LogQL.

**Stack:** React 18 + TypeScript (strict), Go 1.21+, Grafana Plugin SDK, Tailwind CSS, MCP protocol

**Architecture:** Server-side agentic loop (Go) streams SSE to React frontend. MCP proxy aggregates multiple tool servers. RBAC enforced at tool listing and execution via `ToolAnnotations`.

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
go test ./pkg/...                     # Backend tests
docker compose restart grafana        # Reload after backend rebuild
```

## Quality Gates (after every code change)

2. **OpenAPI spec** — update `pkg/plugin/openapi/openapi.json` and run `validate:openapi` if routes changed
3. **Code review** — fix critical/major/medium issues
4. **Clean AI noise** — remove comments that restate code; only keep non-obvious *why* comments
5. **Tests & lint** — `npm run test:ci`, `go test ./pkg/...`, `npm run lint`, `npm run typecheck`

**Severity policy:** Critical = fix now. Major = fix before commit. Medium = fix before PR. Low = optional.

## Definition of Done

Feature is not done until: tests written, all tests pass, RBAC reviewed, no hardcoded colors.

## Architecture

**Frontend** (`src/`): functional components + hooks, thin service layer in `services/`, async/await only, no class components.

**Backend** (`pkg/`):
- `agent/` — agentic loop: LLM → tool calls → repeat (max 25 iterations)
- `plugin/` — HTTP routes, RBAC, session store, shares, rate limiting
- `mcp/` — MCP client/proxy, OAuth PKCE, multi-tenant header injection
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

## OpenAPI Spec

Spec at `pkg/plugin/openapi/openapi.json` — update when adding/modifying routes. Always run `validate:openapi` after changes. Commit spec and code changes together.

## Testing

- Unit tests: Jest + React Testing Library in `tests/`, use `data-testid` from `src/components/testIds.ts`
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
- `.config/` — DO NOT EDIT (scaffolded by `@grafana/create-plugin`)
