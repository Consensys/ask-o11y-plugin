# Implementation Plan: MCP Tool Catalog Refresh

**Branch**: `001-mcp-tool-catalog-refresh` | **Date**: 2026-11-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-mcp-tool-catalog-refresh/spec.md`

## Summary

`Client` caches one tool slice per MCP server for the process lifetime (`pkg/mcp/client.go:440`). Nothing clears it, so an in-place server upgrade leaves every advertised name dead until Grafana restarts.

This change adds a per-server refresh path:

- Detect an unknown-tool failure from the JSON-RPC `-32602` signal or the `unknown tool` phrase.
- Re-list that server's catalog once, single-flight, rate limited to one re-list per 30s.
- Retry the failed call exactly once against the refreshed catalog.
- Name the tools the server now provides when the retry also fails.
- Mark the catalog stale when the SDK delivers `notifications/tools/list_changed`.

The cache is never emptied. Readers keep serving the last known-good slice while a refresh runs. OpenAPI servers, `<serverID>_` prefixing, and result-cache semantics do not change. Mid-run replacement of the advertised tool set is out of scope.

## Technical Context

**Language/Version**: Go 1.26.10 (`go.mod:3`)

**Primary Dependencies**: `github.com/modelcontextprotocol/go-sdk v1.5.0` (`go.mod:7`), `github.com/grafana/grafana-plugin-sdk-go` for `backend/log` and `httpclient`. The `jsonrpc` package ships inside the existing SDK module. No new module.

**Storage**: In-process memory only. One tool slice, one refresh stamp, and one generation counter per `Client`. No Redis, no database.

**Testing**: `go test ./pkg/...` plus `go test -race ./pkg/mcp/`. Table-driven Go tests beside the code, in package `mcp` so private fields and the `callToolOncer` seam are reachable.

**Target Platform**: Grafana backend plugin, linux/amd64 and linux/arm64.

**Project Type**: Backend plugin with a React frontend. This feature touches the backend only.

**Performance Goals**: No measurable change to the normal tool-call path (SC-004). The unknown-tool path adds one `tools/list` and one retry, bounded by the existing 30s call budget.

**Constraints**: At most one re-list per server per 30s after a failure. At most 8 concurrent failures collapse into one re-list. A failed refresh must not change server health and must not replace the catalog (FR-004, FR-008).

**Scale/Scope**: One refresh path in `pkg/mcp/client.go` (~150 lines including tests' seams), one new test file, three retro-spec updates. Two files change in `pkg/`: `client.go` and the new `tool_refresh.go`. No frontend change.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| I. Contract-First HTTP Surface | No route is added, removed, or changed. No `pkg/plugin/openapi/openapi.json` change. No handler test needed. | PASS |
| II. Test-Gated Delivery | New behaviour is covered by table-driven tests in `pkg/mcp/tool_refresh_test.go`. Full gate set runs before commit. | PASS |
| III. RBAC and Multi-Org | No new tool, route, or skill. The refresh runs inside the existing call path, after `rbac.CanAccessTool` (`pkg/agent/loop.go:974`) and `mcp.IsToolEnabled` (`pkg/agent/loop.go:977`). Viewers still receive only `readOnlyHint: true` tools. `provisioning/plugins/full.yaml_` keeps `useBuiltInMCP: false`. Service-account auth still never sends `X-Grafana-Org-Id`. | PASS |
| IV. Fail Fast, No Silent Fallback | A failed refresh returns the original call error. It does not invent data. No bare `&http.Client{}` is added. SSE `error` handling is untouched. | PASS |
| V. House Style | `atomic.Bool` and `sync.Mutex` only. No `any`. Comments explain lock ordering and why the cache is never emptied. | PASS |
| VI. Conventional Commits | One commit: `fix(mcp): refresh the MCP tool catalog after an unknown-tool failure`. Scope `mcp` is in `commitlint.config.js`. | PASS |
| VII. Evidence-Backed Specifications | Retro-specs 106, 107, and 104 are updated in the same PR, each with new tagged rules and a new `Last verified`. | PASS |

No violation, so Complexity Tracking stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-mcp-tool-catalog-refresh/
├── plan.md                        # This file
├── spec.md                        # Feature specification
├── research.md                    # Phase 0 output
├── data-model.md                  # Phase 1 output
├── quickstart.md                  # Phase 1 output
├── contracts/
│   └── mcp-tool-call.md           # Phase 1 output
├── checklists/requirements.md     # From /speckit.specify
└── tasks.md                       # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
pkg/mcp/
├── client.go            # MODIFIED: struct fields, ListToolsWithContext split,
│                        #   newSDKClient + onToolListChanged, unknown-tool retry in
│                        #   callToolWithCatalogRefresh
├── tool_refresh.go      # NEW: isUnknownToolError, refreshTools, catalog
│                        #   helpers, enrichUnknownToolError, rankToolNames
├── tool_refresh_test.go # NEW: table-driven tests and one benchmark
├── retry_test.go        # UNCHANGED reference for the test seam
└── health.go            # UNCHANGED: reads ListTools, stays healthy on failure

specs/retro/
├── 106-mcp-proxy/spec.md        # MODIFIED: new rules, gap closed, Last verified
├── 107-mcp-health/spec.md       # MODIFIED: failed refresh does not change health
└── 104-tool-dispatch/spec.md    # MODIFIED: refreshed names in the error text
```

**Structure Decision**: Single Go module. The feature lives in the package that owns the cache, so no new package, no new boundary, and no import cycle. `pkg/agent` needs no change, which keeps the run snapshot (FR-015) intact.

## Phase 0: Research

See [research.md](./research.md). All decisions are resolved: no NEEDS CLARIFICATION remains.

## Phase 1: Design

- [data-model.md](./data-model.md) — the four new `Client` fields, the catalog state machine, and the validation rules mapped to FRs.
- [contracts/mcp-tool-call.md](./contracts/mcp-tool-call.md) — the error text seen by the model, and the notification input contract.
- [quickstart.md](./quickstart.md) — runnable validation scenarios.

## Post-Design Constitution Re-Check

| Principle | Re-check | Status |
|---|---|---|
| I | Design adds no route and no OpenAPI field. | PASS |
| III | Design adds no tool and no permission. Refresh runs after the RBAC gate. | PASS |
| IV | Design keeps the original error when the refresh fails, and logs at debug. | PASS |
| VII | Design names the exact rules to add to 106, 107, and 104. | PASS |

## Project Gates (Ask O11y)

### Constitution Check additions

- **Principle I** — routes touched: none. OpenAPI update task: none. `pkg/plugin/openapi/openapi.json` is unchanged.
- **Principle III** — Admin, Editor, and Viewer can all trigger a refresh, because it is a cache operation. A Viewer still cannot call a mutating tool after the refresh, because `rbac.CanAccessTool` runs before the proxy call. `provisioning/plugins/full.yaml_` keeps `useBuiltInMCP: false`.
- **Principle IV** — when the MCP server is unreachable during a refresh, the user sees the original tool-call error. The plugin does not fabricate a result and does not change health status.
- **Principle VII** — retro-specs that this plan can break: `106-mcp-proxy`, `107-mcp-health`, `104-tool-dispatch`.

### Existing contracts to read

`specs/retro/106-mcp-proxy/spec.md`, `specs/retro/107-mcp-health/spec.md`, `specs/retro/104-tool-dispatch/spec.md`. Do not load the rest of `specs/retro/`.

### Module map

| Area | Package |
|---|---|
| MCP client, proxy, health, OAuth | `pkg/mcp/` |
| Agent loop, LLM, tools | `pkg/agent/` (unchanged) |
| RBAC | `pkg/rbac/` (unchanged) |

### Verification commands

| Gate | Command |
|---|---|
| Backend tests | `go test ./pkg/...` |
| Race detector | `go test -race ./pkg/mcp/` |
| Vet | `go vet ./pkg/...` |
| Frontend tests | `nvm use 22 && npm run test:ci` |
| Lint and types | `nvm use 22 && npm run lint && npm run typecheck` |
| Build | `nvm use 22 && npm run build && npm run build:backend` |
| OpenAPI | `nvm use 22 && npm run validate:openapi` |
| Plugin validator | `nvm use 22 && npm run validate` |
| Spec drift | `node scripts/verify-retro-specs.mjs` |

## Risks Carried Into Implementation

| Risk | Handling |
|---|---|
| Retrying a tool that already ran | Only a JSON-RPC unknown-tool error retries. An `IsError` tool result does not (FR-009) |
| Empty catalog shown to callers | Nothing sets `tools` to `nil`. The stale flag never hides the slice (FR-007) |
| Stampede after a notification | Single-flight via `refreshMu`. A waiting reader returns at once when the catalog is already fresh |
| Health flapping | `ListToolsWithContext` returns the cached slice with no error when a warm refresh fails (FR-008) |
| Older SDK without the handler | The handler is optional at the call site; unknown-tool recovery does not depend on it (FR-016) |
| Error text grows without bound | The hint lists at most 8 names and truncates the tail |
