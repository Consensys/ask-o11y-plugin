---

description: "Task list for MCP Tool Catalog Refresh"
---

# Tasks: MCP Tool Catalog Refresh

**Input**: Design documents from `/specs/001-mcp-tool-catalog-refresh/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/mcp-tool-call.md](./contracts/mcp-tool-call.md), [quickstart.md](./quickstart.md)

**Tests**: Included. Constitution Principle II requires test-gated delivery. All tests are table-driven Go tests in `package mcp`, beside the code.

**Organization**: Tasks are grouped by user story. US1 is the MVP.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel. Different files, no dependency on an incomplete task.
- **[Story]**: `US1`, `US2`, `US3`, mapped to the user stories in `spec.md`.
- Every task names an exact file path.

## Path Conventions

Single Go module. Backend only. Frontend files are not touched.

- Source: `pkg/mcp/`
- Tests: `pkg/mcp/tool_refresh_test.go`
- Contracts: `specs/retro/{106-mcp-proxy,107-mcp-health,104-tool-dispatch}/spec.md`

---

## Phase 1: Setup

**Purpose**: Ground the implementer in the existing contracts and record a clean baseline.

- [X] T001 Read the three retro-specs and list every rule this feature can break in `specs/retro/106-mcp-proxy/spec.md`, `specs/retro/107-mcp-health/spec.md`, and `specs/retro/104-tool-dispatch/spec.md`. Do not read the other retro-specs.
- [X] T002 Record the baseline from `pkg/mcp/`: `go build ./pkg/...` and `go test ./pkg/mcp/` must both pass before any edit. Note the current pass count for comparison at T027.

---

## Phase 2: Foundational

**Purpose**: Shared state and the publish path. Blocks all three user stories.

**⚠️ CRITICAL**: No user story work starts until this phase is complete.

- [X] T003 [P] Add the catalog fields to the `Client` struct in `pkg/mcp/client.go`: `toolsStale bool`, `toolsDirty atomic.Bool`, `catalogGen uint64`, `refreshMu sync.Mutex`, `lastRefresh time.Time`, `listTools func(context.Context) ([]Tool, error)`. `toolsStale` and `catalogGen` are guarded by `mu`; `lastRefresh` is guarded by `refreshMu`; `toolsDirty` is atomic; `listTools` is set once before use. Add the `sync/atomic` and `time` imports.
- [X] T004 [P] Create `pkg/mcp/tool_refresh.go` with package-level constant `toolCatalogRefreshMinInterval = 30 * time.Second` and the helpers `markToolsStale()`, `clearToolsStale()`, and `catalogGeneration() uint64`. Each helper takes `c.mu` and documents that `refreshMu` is never held while `c.mu` is taken.
- [X] T005 Split `ListToolsWithContext` in `pkg/mcp/client.go` into a cache check plus a new `listAndPublish(ctx context.Context) ([]Tool, error)`. `listAndPublish` keeps the existing type switch, the `<serverID>_<toolName>` prefix loop, the publish under `c.mu`, and adds `c.catalogGen++` on success. The cache check stays `c.tools != nil && !c.toolsStale`. Nothing assigns `nil` to `c.tools`.
- [X] T006 Wire the `listTools` seam in `pkg/mcp/client.go`: `listAndPublish` calls `c.listTools` when non-nil, and otherwise dispatches through the existing switch. The seam is set once in tests only.
- [X] T007 Add `TestListAndPublishIncrementsGeneration` to `pkg/mcp/tool_refresh_test.go`: two successful publishes produce different `catalogGen` values, the prefix is applied, and a reader that copied the old slice still sees the old names.

**Checkpoint**: The cache publishes safely and exposes a generation counter. Story work can start.

---

## Phase 3: User Story 1 - Recover from a server tool rename without a restart (Priority: P1) 🎯 MVP

**Goal**: An unknown-tool failure re-lists the server once and retries the call once. A failed retry names the tools the server now provides.

**Independent Test**: Point a `Client` at a stub `listTools` that returns a new catalog on the second call. Call the removed name through the `callToolOncer` seam. Assert one refresh, one retry, and success on the new name.

### Tests for User Story 1

- [X] T008 [US1] Add `TestIsUnknownToolError` to `pkg/mcp/tool_refresh_test.go`, table-driven. True: `*jsonrpc.Error` with `CodeInvalidParams` and message `unknown tool "x"`; the wrapped string `failed to call tool: calling "tools/call": unknown tool "alerting_manage_rules"`. False: `nil`, `invalid params: missing field`, `unauthorized`, `connection refused`, `unknown parameter "x"`.
- [X] T009 [US1] Add `TestCallToolRetriesOnceAfterRefresh`, `TestCallToolDoesNotLoopOnPersistentUnknownTool`, `TestCallToolIgnoresNonUnknownErrors`, `TestCallToolOpenAPINeverRefreshes`, `TestRefreshRateLimit`, `TestToolResultErrorDoesNotRefresh`, and `TestCacheKeyIncludesToolName` to `pkg/mcp/tool_refresh_test.go`. Assert: exactly one retry; exactly one listing; a second unknown-tool reply returns the enriched error; a non-unknown error performs no listing; `config.Type == "openapi"` performs no listing and returns the plain error; two failures inside 30s produce one listing and a failure after the window produces a second; a result with `IsError=true` and a nil error performs no listing (FR-009); two tool names never share a result-cache entry (FR-012).

### Implementation for User Story 1

- [X] T010 [US1] Implement `isUnknownToolError(err error) bool` in `pkg/mcp/tool_refresh.go`. Two signals only: `errors.As` to `*jsonrpc.Error` with `Code == jsonrpc.CodeInvalidParams` and `strings.Contains(strings.ToLower(rpcErr.Message), "unknown tool")`, or the same substring on `strings.ToLower(err.Error())`. No other aliases.
- [X] T011 [US1] Implement `refreshTools(ctx context.Context, sinceGen uint64) (bool, error)` in `pkg/mcp/tool_refresh.go`. Return `(false, nil)` at once when `c.config.Type` is not an MCP transport. Otherwise lock `refreshMu` and apply the decision table in `data-model.md`: generation moved → `(true, nil)`; cold and already fresh → `(true, nil)`; warm and `time.Since(c.lastRefresh) < toolCatalogRefreshMinInterval` → `(false, nil)`; otherwise `markToolsStale`, fetch the catalog, and reject an empty result as a failed refresh before anything is published. On success publish, stamp `lastRefresh`, and return `(true, nil)`. On failure or an empty result `clearToolsStale`, keep the old slice, log at `Debug`, and return `(false, err)`. Do not clear `toolsDirty` here; `publishTools` owns that.
- [X] T012 [US1] Wire the retry in `callMCPToolWithContext` in `pkg/mcp/client.go`, above `callMCPToolWithRetry`, exactly as R5 specifies: capture `gen := c.catalogGeneration()` before the call; return at once when the error is nil or is not an unknown-tool error; on a non-MCP transport return the plain error; otherwise call `refreshTools` and, when it refuses, return `c.enrichUnknownToolError(err, originalName)`. On success retry exactly once and enrich if the retry fails with an unknown-tool error. The refresh error is logged inside `refreshTools` and never returned to the caller. Do not modify `callMCPToolWithRetry` or `callMCPToolOnce`.
- [X] T013 [US1] Implement `enrichUnknownToolError(err error, failedName string) error` in `pkg/mcp/tool_refresh.go`. Wrap with `%w`. Append `; this server now provides: ` plus a ranked list: strip `c.config.ID+"_"` from each candidate, split on `_`, rank by shared-token count descending then name ascending, cap at 8, and append `(N more)` whenever the catalog holds more than 8 names. Produce the exact shape in `contracts/mcp-tool-call.md` C1.
- [X] T014 [US1] Add `TestEnrichUnknownToolError` to `pkg/mcp/tool_refresh_test.go`. Assert: the original text stays as a prefix; `errors.Is` and `errors.As` still reach the original error; the ranking puts `alerting_rules_read` first for the failed name `alerting_manage_rules`; at most 8 names are listed; `(N more)` appears whenever the catalog holds more than 8 names.
- [X] T015 [US1] Add `TestRefreshFailureKeepsCatalogAndHealth` and `TestRefreshRejectsEmptyCatalog` to `pkg/mcp/tool_refresh_test.go`: with a warm catalog and a failing or empty `listTools`, `refreshTools` returns `(false, err)`, the generation does not move, `toolsStale` is cleared, `ListToolsWithContext` still returns the cached slice with a nil error, and the original call error is returned to the caller. Do not modify `pkg/mcp/health.go`.

**Checkpoint**: The reported defect is fixed. A rename no longer requires a Grafana restart.

---

## Phase 4: User Story 2 - Concurrent investigations do not stampede the server (Priority: P2)

**Goal**: Concurrent unknown-tool failures on one server coalesce into one listing.

**Independent Test**: Start 8 concurrent calls that all fail with an unknown-tool error against one `Client`. Count the `listTools` invocations. The count is one.

- [X] T016 [US2] Add `TestRefreshToolsSingleFlight` to `pkg/mcp/tool_refresh_test.go`: 8 goroutines call `refreshTools` with the same `sinceGen` and a `listTools` stub that sleeps and counts. Assert one invocation and that every caller returns `true`.
- [X] T017 [US2] Add `TestRefreshWaiterRetriesWithoutSecondList` to `pkg/mcp/tool_refresh_test.go`: a second caller that observed an older `catalogGen` returns `(true, nil)` after waiting, with no second `listTools` call. This is the R3 branch that makes the queue useful.
- [X] T018 [US2] Add `TestListToolsConcurrentWithInvalidate` to `pkg/mcp/tool_refresh_test.go`: concurrent `ListToolsWithContext`, `markToolsStale`, and `FindToolByName` calls complete without a data race, and no caller ever sees an empty catalog. Run `go test -race ./pkg/mcp/`.

**Checkpoint**: A fleet-wide upgrade costs one listing per server, not one per run.

---

## Phase 5: User Story 3 - Notice an announced catalog change before a call fails (Priority: P3)

**Goal**: A `notifications/tools/list_changed` notification marks the catalog stale. The next listing reflects the change.

**Independent Test**: Set the dirty flag through the handler, then call `ListToolsWithContext` and assert it re-lists and clears the flag.

- [X] T019 [US3] Add `TestToolDirtyFlagTriggersRelist` to `pkg/mcp/tool_refresh_test.go`: a warm catalog with `toolsDirty` set re-lists on the next `ListToolsWithContext`, returns the new names, and clears the flag.
- [X] T020 [US3] Add `TestToolListChangedHandlerTakesNoLock` to `pkg/mcp/tool_refresh_test.go`: hold `c.mu` exclusively, invoke the handler, and assert it returns before a short deadline. This proves the callback never waits on `c.mu`.
- [X] T021 [US3] Add `ClientOptions{ToolListChangedHandler: ...}` in `pkg/mcp/client.go`. Extract the duplicated `mcpsdk.NewClient` blocks at `:186` and `:384` into one `newSDKClient()` helper, and extract the handler into a named method `func (c *Client) onToolListChanged(context.Context, *mcpsdk.ToolListChangedRequest)` so tests can invoke it directly; the method only calls `c.toolsDirty.Store(true)`. Keep `DisableStandaloneSSE: true` at both transports.
- [X] T022 [US3] Consume the flag in `pkg/mcp/client.go`: the `ListToolsWithContext` cache check also requires `!c.toolsDirty.Load()`, and `listAndPublish` clears the flag only after a successful publication.

**Checkpoint**: SSE servers skip the failed call. All other transports fall back to US1.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Contract updates and the full gate set.

- [X] T023 Update `specs/retro/106-mcp-proxy/spec.md`: add tagged rules for the stale flag, the never-empty catalog, single-flight, the 30s bound, the one-retry rule, the empty-catalog rejection, the OpenAPI exclusion, and the dirty flag. Remove the Known Gap "No cache invalidation on config change. Forward spec: cache invalidation." Set `Last verified` to this branch's commit SHA.
- [X] T024 [P] Update `specs/retro/107-mcp-health/spec.md`: one rule that a failed refresh returns the cached catalog and does not change health status. Set `Last verified`.
- [X] T025 [P] Update `specs/retro/104-tool-dispatch/spec.md`: one rule that a tool-call error may name refreshed tool names, and that execution still resolves against the current catalog. Set `Last verified`.
- [X] T026 Regenerate `specs/retro/REVIEW.md` with `node scripts/verify-retro-specs.mjs --review` when any new row is `ASSUMED` or `GAP`, then run `node scripts/verify-retro-specs.mjs`.
- [X] T027 Run `go test ./pkg/...` and `go vet ./pkg/...`, and compare against the T002 baseline.
- [X] T028 Run `nvm use 22 && npm run test:ci`.
- [X] T029 Run `nvm use 22 && npm run lint && npm run typecheck`.
- [X] T030 Run `nvm use 22 && npm run build && npm run build:backend`.
- [X] T031 Run `nvm use 22 && npm run validate:openapi` and confirm `pkg/plugin/openapi/openapi.json` is unchanged.
- [X] T032 Run `nvm use 22 && npm run validate` and confirm only the benign findings listed in `constitution.md:131` appear.
- [X] T033 [P] Verify RBAC ordering is untouched: `rbac.CanAccessTool` at `pkg/agent/loop.go:974` and `mcp.IsToolEnabled` at `pkg/agent/loop.go:977` still run before the proxy call. Run `go test ./pkg/rbac/...`.
- [X] T034 Walk `quickstart.md` scenarios 1 through 9 and record the result of each.
- [X] T035 Prepare, but do not create, the commit for `pkg/mcp/` and `specs/retro/`: `fix(mcp): refresh the MCP tool catalog after an unknown-tool failure`. Confirm with the user before committing. Do not push.
- [ ] T036 [P] Run `nvm use 22 && npm run e2e` and record the result. This satisfies the per-PR E2E gate in `constitution.md:128`.
  **Blocked locally**: the suite needs a live Grafana from `docker compose up -d grafana` and the `LLM_API_KEY` secret (`.github/workflows/e2e.yml:96,131`). Neither is available on this workstation. The change is backend-only and no Playwright test exercises it, so CI must satisfy this gate.
- [X] T037 [P] Draft the PR body in `specs/001-mcp-tool-catalog-refresh/` notes for the eventual PR: state the principles touched (I, II, III, IV, VI, VII), the explicit RBAC review, and the changed surfaces. Do not open a PR.
- [X] T038 [P] Add `BenchmarkListToolsWithContextCacheHit` to `pkg/mcp/tool_refresh_test.go` with `b.ReportAllocs()`, and record the allocation count as the SC-004 evidence.

---

## Dependencies & Execution Order

### Phase Dependencies

| Phase | Depends on | Note |
|---|---|---|
| Phase 1 Setup | — | Starts immediately |
| Phase 2 Foundational | Phase 1 | Blocks US1, US2, US3 |
| Phase 3 US1 | Phase 2 | MVP |
| Phase 4 US2 | Phase 3 | Tests the mechanism US1 introduces |
| Phase 5 US3 | Phase 2 | Independent of US1 and US2 |
| Phase 6 Polish | All desired stories | Final gate set |

### Within each story

- Tests are written first and must fail before the implementation task.
- `tool_refresh.go` helpers land in T011 and T013 before T012 wires them.
- No task edits `pkg/mcp/health.go`, `pkg/agent/`, `pkg/rbac/`, or `pkg/plugin/`.

### Parallel Opportunities

- T003 and T004 touch different files.
- T024 and T025 touch different retro-specs.
- US3 can run beside US1 and US2 once Phase 2 is complete, because it touches the client-construction path, not the retry path.

---

## Parallel Example: User Story 1

```bash
# After T007, the test file and the implementation file can be edited by two people,
# but T008/T009 (tests) must merge before T010/T011/T013 (implementation) is verified.
Task: "Add TestIsUnknownToolError to pkg/mcp/tool_refresh_test.go"
Task: "Implement isUnknownToolError in pkg/mcp/tool_refresh.go"
```

---

## Implementation Strategy

### MVP first

1. Phase 1 and Phase 2.
2. Phase 3 (US1) only.
3. Stop and validate: the rename scenario in `quickstart.md` passes, and `go test -race ./pkg/mcp/` is clean.
4. The defect is fixed at this point. US2 and US3 reduce load and latency; they are not required for correctness of the recovery.

### Incremental delivery

| Increment | Stories | Value |
|---|---|---|
| 1 | US1 | Renames recover without a restart |
| 2 | US1 + US2 | A fleet-wide upgrade costs one listing per server |
| 3 | US1 + US2 + US3 | SSE servers skip the failed call |

---

## Notes

- The user has not authorised a commit or a push. T035 stops at the proposal.
- `[P]` tasks touch different files. Two tasks in `tool_refresh_test.go` are never parallel.
- Every new retro-spec rule carries exactly one `VERIFIED`, `ASSUMED`, or `GAP` tag. A `VERIFIED` rule needs a resolving `path:line` or a test name.

---

## Project Task Contract (Ask O11y)

### Per user story

| Requirement | US1 | US2 | US3 |
|---|---|---|---|
| Implementation task with exact paths | T010–T013 | T016–T018 (tests only; the mechanism lands in T011) | T021–T022 |
| Test task | T008, T009, T014, T015 | T016–T018 | T019, T020 |
| RBAC task (only when a tool, route, or skill is added) | Not applicable — no tool, route, or skill is added. Verified at T033. | Not applicable | Not applicable |
| OpenAPI task (only when a route changes) | Not applicable — no route changes. Verified at T031. | Not applicable | Not applicable |

### Final phase gates

| Gate | Task |
|---|---|
| `go test ./pkg/...` passes | T027 |
| `nvm use 22 && npm run test:ci` passes | T028 |
| `nvm use 22 && npm run lint && npm run typecheck` passes | T029 |
| `nvm use 22 && npm run build && npm run build:backend` passes | T030 |
| `nvm use 22 && npm run validate:openapi` passes when routes changed | T031 |
| `nvm use 22 && npm run validate` reports only benign findings | T032 |
| `node scripts/verify-retro-specs.mjs` passes | T026 |
| `nvm use 22 && npm run e2e` passes (per-PR gate) | T036 |
| PR body states the principles and the RBAC review | T037 |
| Cache-hit allocation count recorded for SC-004 | T038 |
| Retro-specs for touched modules updated with a new `Last verified` | T023, T024, T025 |

### Forbidden task shapes

- A task with no file path — none.
- A task that edits `.config/` — none.
- A task that bumps a version or edits `CHANGELOG.md` by hand — none.
- A task that adds a fallback instead of surfacing an error — none. T011 returns the original error on a failed refresh.

---

## Validation Results

Recorded on branch `001-mcp-tool-catalog-refresh` at `f1a7736`. Nothing committed, nothing pushed.

| Gate | Task | Result |
|---|---|---|
| `go build ./pkg/...` | T002, T027 | Pass |
| `go vet ./pkg/...` | T027 | Pass |
| `go test ./pkg/...` | T027 | Pass — agent 6.5s, mcp 1.3s, plugin 65.5s, oauth/openapi/rbac/skills cached |
| `go test -race ./pkg/mcp/` | T018 | Pass — 3.1s |
| Quickstart scenarios 1–5 | T034 | Pass (18 named tests, plus 3× race run) |
| Quickstart scenario 6 | T028–T032 | Pass |
| Quickstart scenario 7 | T026 | Pass — 898 rules, 1570 evidence pointers |
| Quickstart scenario 8 | T034 | Not run — needs a dev Grafana and an in-place MCP upgrade. CI or dev replay must confirm |
| Quickstart scenario 9 | T034 | Log lines verified in code: `mcp catalog refreshed`, `mcp catalog refresh failed` |
| `npm run test:ci` | T028 | Pass — 43 suites, 584 tests |
| `npm run lint` | T029 | Pass — 0 errors, 9 pre-existing deprecation warnings |
| `npm run typecheck` | T029 | Pass |
| `npm run build` | T030 | Pass — frontend prod bundle plus 6 backend binaries |
| `npm run validate:openapi` | T031 | Pass — valid, 3 pre-existing warnings; `openapi.json` unmodified |
| `npm run validate` | T032 | Pass — only the benign findings from `constitution.md:131` (gosec G101/G404, unsigned plugin, React 19 `@floating-ui/react`) |
| `npm run e2e` | T036 | Blocked — see T036 |
| SC-004 benchmark | T038 | `BenchmarkListToolsWithContextCacheHit` = 9.237 ns/op, 0 B/op, 0 allocs/op |
| RBAC ordering | T033 | Unchanged — `rbac.CanAccessTool` at `pkg/agent/loop.go:974`, `mcp.IsToolEnabled` at `pkg/agent/loop.go:977` |

### Known deviation from the spec text

US1 acceptance scenario 1 says the retried call "succeeds against the current tool". The implementation retries the **same** name, because the tool name is the caller's argument. A rename therefore recovers in two ways:

1. A staggered server (the listing and the call hit different replicas) succeeds on the retry.
2. A true rename returns the enriched error, which names `alerting_rules_read`. The model calls that name on the next iteration, and `FindToolByName` resolves it against the refreshed catalog.

The rename case is covered by FR-010 and by acceptance scenario 2, not by scenario 1. `spec.md` was left unchanged; the PR body records this.
