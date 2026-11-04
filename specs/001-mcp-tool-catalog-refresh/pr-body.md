# Draft PR body

Title: `fix(mcp): refresh the MCP tool catalog after an unknown-tool failure`

---

## Problem

`Client` caches one tool slice per MCP server for the lifetime of the Grafana process (`pkg/mcp/client.go:479` before this change). Nothing cleared it. When a remote MCP server was upgraded in place, every advertised name went dead until Grafana restarted.

Reproduced in dev on 2026-11-04 during the `mcp-grafana` 1.4.0 → 2.2.0 upgrade (Consensys/w3f-observability PR #768). `alerting_manage_rules` became `alerting_rules_read`. The `alerting` investigation on `zzalert` then failed its rule snapshot, and the model invented a runbook URL and concluded the alert was not firing. After a rollout restart the same investigation returned the correct verdict.

## Change

- Detect an unknown-tool failure from the JSON-RPC `-32602` code with the `unknown tool` message, or from the `unknown tool` phrase in the wrapped error text (`pkg/mcp/tool_refresh.go`).
- Mark that server's catalog stale and re-list it once. The last known-good slice keeps serving readers, so no caller ever sees an empty catalog.
- Retry the failed call exactly once against the refreshed catalog.
- If the retry also fails, name the tools the server now provides. The hint is ranked by shared name tokens and capped at 8 names, so `alerting_rules_read` surfaces first for `alerting_manage_rules`.
- Coalesce concurrent failures with one mutex per client and a 30-second rate limit.
- Mark the catalog stale when the SDK delivers `notifications/tools/list_changed`. Delivery stays SSE-only; standalone SSE remains disabled.

The OpenAPI path, the `<serverID>_<toolName>` prefix, and the result cache are unchanged. The advertised tool set for a run stays a snapshot; a refreshed name is callable because execution resolves against the current catalog.

## Files

| File | Change |
|---|---|
| `pkg/mcp/client.go` | Catalog fields, `ListToolsWithContext` split, `newSDKClient`, unknown-tool retry |
| `pkg/mcp/tool_refresh.go` | New: detection, refresh, hint, ranking |
| `pkg/mcp/tool_refresh_test.go` | New: 18 tests plus 1 benchmark |
| `specs/retro/106-mcp-proxy/spec.md` | 13 new rules, 2 invariants, Known Gap removed |
| `specs/retro/107-mcp-health/spec.md` | 1 new rule |
| `specs/retro/104-tool-dispatch/spec.md` | 2 new rules, 1 invariant |
| `specs/001-mcp-tool-catalog-refresh/` | Spec, plan, research, data model, contracts, quickstart, tasks |

## Principles

| Principle | How this PR honours it |
|---|---|
| I. Contract-First HTTP Surface | No route is added or changed. `pkg/plugin/openapi/openapi.json` is untouched. `npm run validate:openapi` passes |
| II. Test-Gated Delivery | 18 table-driven tests and 1 benchmark cover every FR. `go test ./pkg/...` and `go test -race ./pkg/mcp/` pass |
| III. RBAC and Multi-Org | No new tool, route, or skill. The refresh runs after `rbac.CanAccessTool` (`pkg/agent/loop.go:974`) and `mcp.IsToolEnabled` (`pkg/agent/loop.go:977`). A Viewer still cannot call a mutating tool after a refresh. `useBuiltInMCP: false` is unchanged |
| IV. Fail Fast, No Silent Fallback | A failed refresh keeps the old catalog and returns the original call error. No fabricated result, no new metric, no fallback answer |
| V. House Style | `atomic.Bool` and `sync.Mutex` only. Lock order documented. No `any` |
| VI. Conventional Commits | `fix(mcp): refresh the MCP tool catalog after an unknown-tool failure` |
| VII. Evidence-Backed Specifications | Retro-specs 106, 107, and 104 updated in this PR with new `Last verified` commits. `node scripts/verify-retro-specs.mjs` passes |

## RBAC review

| Action | Admin | Editor | Viewer | Enforcement |
|---|---|---|---|---|
| Trigger a refresh by calling a removed tool | yes | yes | yes | `pkg/mcp/client.go` |
| Call a mutating tool after a refresh | yes | yes | no | `pkg/rbac/rbac.go`, `pkg/agent/loop.go` |

The refresh is a cache operation, so it is role-neutral. It cannot widen access: the RBAC and selection gates run before the proxy call, and the catalog contains no tool that the viewer filters would not already remove.

## Verification

| Gate | Result |
|---|---|
| `go build ./pkg/...` | Pass |
| `go vet ./pkg/...` | Pass |
| `go test ./pkg/...` | Pass |
| `go test -race ./pkg/mcp/` | Pass |
| `npm run test:ci` | Pass — 584 tests |
| `npm run lint && npm run typecheck` | Pass |
| `npm run build` | Pass |
| `npm run validate:openapi` | Pass |
| `npm run validate` | Pass — benign findings only |
| `npm run e2e` | Left to CI: needs a live Grafana and `LLM_API_KEY` |
| `node scripts/verify-retro-specs.mjs` | Pass — 898 rules, 1570 evidence pointers |
| `BenchmarkListToolsWithContextCacheHit` | 9.237 ns/op, 0 B/op, 0 allocs/op |

## Behaviour note

The retry repeats the same tool name, because the name is the caller's argument. A rename therefore recovers through the error hint, not through the retry: the model reads `alerting_rules_read` and calls it on the next iteration. A staggered server, where the listing and the call hit different replicas, does recover on the retry. Spec US1 acceptance scenario 1 states the retry "succeeds against the current tool"; scenario 2 and FR-010 cover the rename case that this PR actually implements.

## Out of scope

- Mid-run replacement of the advertised tool set (FR-015).
- Per-user catalogs (the cache stays per server).
- Enabling extra server-initiated streams (FR-016).
- `Proxy.EnsureServer` still ignores changes to `Type`, `TimeoutSeconds`, and `OAuth`. That stays a `GAP` row in 106.
