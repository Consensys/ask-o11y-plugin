# Tasks: Autonomous Agent Workflows

**Input**: Design documents from `/specs/002-workflows/` (spec.md, plan.md)

**Prerequisites**: plan.md (required), spec.md (required for user stories)

**Tests**: Required. Constitution Principle II gates delivery on the full test set, and every user story carries acceptance scenarios. Test tasks are first-class tasks, written before or with the implementation they cover.

**Organization**: Tasks are grouped by user story. File paths are repository-relative.

## Phase 1: Foundational (blocking prerequisites)

**Purpose**: Types, seams, and helpers every user story needs.

- [x] T001 [P] Create `pkg/plugin/workflows.go`: `WorkflowEntry` struct per FR-001, parse from `jsonData.workflows`, validate per FR-002 (unknown skill, empty allowlist, unknown tool name, interval floor, duplicate or missing name). Unit tests in `pkg/plugin/workflows_test.go` covering every invalid case and the valid path.
- [x] T002 [P] Create `pkg/plugin/org_identity.go`: per-org `{grafanaURL, service-account token}` store, seeded at the existing Scout seeding site in the inbound agent-run path, token refreshed on later requests. Unit tests in `pkg/plugin/org_identity_test.go`.
- [x] T003 [P] Create `pkg/plugin/workflow_metrics.go`: per-workflow counters (ticks executed, ticks skipped by lock / identity / error, sessions started, completed, failed, cancelled) and an active-spawn gauge, plus a run-duration histogram. Follow the existing telemetry patterns. Unit test for registration and labels.
- [x] T004 [P] Create `pkg/agent/internal_tools.go`: `InternalTool` type (name, description, input schema, handler), `LoopRequest.InternalTools` field, loop dispatch for injected tools. No change to the interactive catalog path. Unit tests in `pkg/agent/internal_tools_test.go`: injected tool callable, absent when the field is nil, never listed.
- [x] T005 Create the Redis helpers in `pkg/plugin/workflow_scheduler.go`: tick lock (`workflow:<name>:tick`, SETNX, TTL ≤ interval/2) and the active-spawn set (`workflow:<name>:active`, ZSET, score = watchdog deadline, prune-on-read). Unit tests against the dev Redis or miniredis, including lock TTL expiry.

**Checkpoint**: Foundation compiles, gates pass, no behavior change anywhere.

---

## Phase 2: User Story 1 - A skill runs on a schedule, unattended (Priority: P1) — MVP

**Goal**: A provisioned workflow produces persisted, API-readable headless sessions on its interval, with the allowlist enforced.

**Independent Test**: 60-second workflow with a stub skill and one allowlisted tool; within two ticks a session record and a run record exist and the catalog matches the allowlist.

- [x] T006 [US1] Write the integration test first in `pkg/plugin/workflow_session_test.go`: fake LLM transport + stub MCP server; assert session and run records with the `workflow` conversation type, tool catalog exactly per FR-007, and execution refusal outside the allowlist. It must fail before implementation.
- [x] T007 [US1] Create `pkg/plugin/workflow_session.go`: headless `LoopRequest` construction (skill rendered through the existing mechanism, entry model, `maxIterations`, approval policy `off`, synthetic user, role `Editor`, entry `orgId`, identity from T002, internal tools injected) and persistence through the existing session and run stores. Reuse the interactive path's helpers; extract minimally.
- [x] T008 [US1] Create the scheduler in `pkg/plugin/workflow_scheduler.go`: one ticker per enabled entry, lock from T005, tick executes one session per FR-006, skip-and-log per FR-014 when identity is unseeded (rate-limited warning), metrics from T003.
- [x] T009 [US1] Wire startup in `pkg/plugin/plugin.go` `NewPlugin`: parse and validate entries, start schedulers, stop them in `Dispose`; no Redis configured disables all workflows with one error log (FR-005). Unit test for the wiring.

**Checkpoint**: US1 works end to end in the dev compose. Demo: a workflow session appears in the sessions API.

---

## Phase 3: User Story 2 - Bounded sub-sessions (Priority: P1)

**Goal**: `spawn_session` starts capped child sessions; `share_session` returns a share URL.

**Independent Test**: Dispatcher skill with three items and cap two: two children start, the third spawn returns a capacity error, a later spawn succeeds after one child finishes.

- [x] T010 [US2] Write tests first in `pkg/plugin/workflow_spawn_test.go`: capacity refusal naming the constraint, non-spawnable skill refusal naming allowed skills, nesting refusal, share URL returned, active-set prunes expired members. They must fail before implementation.
- [x] T011 [US2] Create `pkg/plugin/workflow_spawn.go`: `spawn_session` handler (child session per FR-009, active-set cardinality check against `maxConcurrentSessions`, `spawnableSkills` gate, nesting refused) and `share_session` handler through the existing share mechanism. Inject both through T004 only into workflow runs.

**Checkpoint**: The dispatcher-to-investigator shape works in dev.

---

## Phase 4: User Story 3 - Watchdog (Priority: P1)

**Goal**: Every workflow session is cancelled at its timeout, marked failed, counted; optional fallback skill runs once.

**Independent Test**: Stub LLM that never answers; cancelled within timeout + 30 s, failed in the run store, counted; fallback skill ran once; normal completion is a no-op.

- [x] T012 [US3] Write tests first in `pkg/plugin/workflow_session_test.go` (watchdog cases): timeout cancel, fallback run-once, completed-then-timer no-op. They must fail before implementation.
- [x] T013 [US3] Implement the watchdog in `pkg/plugin/workflow_session.go`: per-session timer on the host process, cancel through the existing cancel path, run marked failed, failure metric, optional `fallbackSkill` run once with the workflow payload.

**Checkpoint**: No workflow session can run forever.

---

## Phase 5: User Story 4 - One leader per tick (Priority: P2)

**Goal**: Two backend instances, one session per interval.

**Independent Test**: Two scheduler instances against one Redis over ten intervals: exactly ten sessions.

- [x] T014 [US4] Dual-instance test in `pkg/plugin/workflow_scheduler_test.go`: two plugin instances, shared Redis, one workflow; assert one session per interval and lock handover after TTL expiry.

---

## Phase 6: User Story 5 - Containment (Priority: P2)

**Goal**: Interactive users see nothing new; unattended writes stay inside the allowlist.

**Independent Test**: Tool catalogs identical before/after the feature for Admin, Editor, Viewer; a non-allowlisted tool is refused in a workflow run; a write tool executes without approval in a workflow run.

- [x] T015 [US5] Catalog-parity test: capture interactive tool listings with the feature off and on for all three roles; assert byte-identical, and assert `spawn_session` / `share_session` never appear.
- [x] T016 [US5] Execution-refusal and approval-off tests in the workflow session tests (may extend T006 cases).
- [ ] T017 [US5] Draft the RBAC statement for the PR body per the constitution's governance rule, using the spec's RBAC matrix.

---

## Phase 7: User Story 6 - Valid, seeded config only (Priority: P2)

**Goal**: Invalid entries disable themselves with named errors; unseeded identity skips ticks with a rate-limited warning.

**Independent Test**: One valid and one invalid entry: only the valid one ticks; unseeded org skips until seeded.

- [x] T018 [US6] Startup-validation integration test in `pkg/plugin/workflows_test.go`: mixed entries, missing skill, interval below floor, empty allowlist, unknown tool name, duplicate name — each disables only itself with one named error.
- [x] T019 [US6] Identity-skip test: unseeded org produces a rate-limited warning and no session; after seeding, the next tick runs.

---

## Phase 8: User Story 7 - Observability (Priority: P3)

**Goal**: Per-workflow metrics report loop health.

**Independent Test**: Ten ticks with one induced failure; counters read 10 started, 1 failed, 9 completed, and the duration histogram has entries.

- [x] T020 [US7] Metric emission across the scheduler, session runner, spawn, and watchdog paths, verified in a test that drives ticks and reads the registered metrics.

---

## Phase 9: Polish, specs, and gates

- [x] T021 [P] Write the user-facing documentation: a "Workflows" section in `README.md` and one documented example workflow (the shipped example for other customers; no tenant identifiers).
- [x] T022 [P] Update the touched retro-specs in the same PR with `Last verified`: 111 (new conversation type), 114 (new settings section), 124 (new metrics). Run `node scripts/verify-retro-specs.mjs`.
- [x] T023 Run the full per-change gate set: `go test ./pkg/...`, `nvm use 22 && npm run test:ci`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run build:backend`, `npm run validate:openapi` (no change expected), `npm run lint:standards`, `golangci-lint run ./pkg/...`.
- [ ] T024 Run the per-PR gates: `npm run validate`, `npm run e2e`, `npm run review:diff` with the answer table in the PR body, RBAC statement from T017.

---

## Phase 10: Config UI increment (2026-11-20)

**Purpose**: The Workflows tab in AppConfig and its status API.

- [x] T025 [P] Create `pkg/plugin/workflow_status.go`: per-instance status store (tick outcomes, session counters, last error) and the `GET /api/workflows` handler (Admin only). Unit and handler tests in `pkg/plugin/workflow_status_test.go`.
- [x] T026 Wire status recording into the scheduler tick and the session runner; register the route; add the OpenAPI entry and pass `validate:openapi`.
- [x] T027 [P] Add `WorkflowEntryUI` to the plugin types and the `workflows` field to `AppPluginSettings`.
- [x] T028 Create `src/components/AppConfig/Workflows.tsx`: status table, empty state, retry, enable toggle with immediate save-and-reload through the standard settings path. Component tests in `Workflows.test.tsx`.
- [x] T029 Wire the tab into `AppConfig.tsx` (tab registry, dirty map, save callback).
- [x] T030 Amend this spec (User Story 8, FR-019 to FR-021, FR-017 note) in the same PR.

---

## Dependencies & Execution Order

- **Phase 1** blocks every story. T001 to T004 are parallel; T005 depends on nothing but is consumed by T008.
- **US1** (Phase 2) depends on Phase 1 and is the MVP; it blocks US2 and US3 (both build on the session runner).
- **US2** (Phase 3) and **US3** (Phase 4) are independent of each other once US1 exists; they can proceed in parallel.
- **US4 to US7** (Phases 5 to 8) are verification and hardening; each is independent once its target phase is complete.
- **Phase 9** runs last; T021 and T022 are parallel.
- Commit after each task or logical group, conventional format, scope per `commitlint.config.js` (`feat(backend): ...`).

## Implementation Strategy

MVP first: Phases 1 and 2 deliver a working scheduled session. Phases 3 and 4 add the full NOC shape. Phases 5 to 8 harden. Tenant content (skills, mcp-grafana provisioning, workflow entries) lands in the tenant's deployment repo. The tenant's rollout plan decides when the allowlist gains write tools.
