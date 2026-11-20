# Implementation Plan: Autonomous Agent Workflows

**Branch**: `002-workflows` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-workflows/spec.md`

## Summary

Ship a generic, tenant-agnostic workflow capability in the plugin backend: provisioned workflow entries (settings/provisioning JSON) drive an in-plugin scheduler that runs headless agent sessions with a skill, a model, a budget, and a per-workflow tool allowlist. Two internal tools, `spawn_session` and `share_session`, exist only inside workflow sessions; a watchdog bounds every run; a Redis lock elects one leader per tick across any number of replicas. No new routes, no UI, no skills, no tenant logic. The reference tenant (a NOC auto-investigation on Grafana IRM, via the external mcp-grafana server) configures everything as content; its rollout plan lives in its own deployment repo.

## Technical Context

**Language/Version**: Go 1.21+ (backend only; no frontend work)

**Primary Dependencies**: grafana-plugin-sdk-go (app instance settings, `httpclient`), existing `pkg/agent` loop, existing `pkg/mcp` proxy and selection, existing session/run stores (in-memory and Redis), existing skills registry, existing telemetry (`pkg/plugin/metrics.go` patterns), go-redis (already vendored for the Redis stores).

**Storage**: Redis (existing deployment, one instance). New keys: `workflow:<name>:tick` (lock, SETNX + TTL), `workflow:<name>:active` (ZSET of active spawned runs, scored by watchdog deadline). Session and run records reuse the existing keys and TTLs.

**Testing**: `go test ./pkg/...`. Unit tests with fakes for the LLM transport and MCP proxy (existing patterns), one dual-instance lock test using a shared miniredis or the dev Redis, plus the full repo gate set before PR.

**Target Platform**: Grafana app plugin backend, Linux containers, one or more replicas.

**Constraints**: No new HTTP routes (FR-017). No `os.Getenv`/filesystem reads in `pkg/` — workflow config arrives through `backend.AppInstanceSettings` in `NewPlugin`. No outbound HTTP added by this feature; all external I/O flows through the existing LLM client and MCP proxy. House log hygiene: workflow logs carry the workflow name and a status, never a payload body.

**Scale/Scope**: A handful of workflow entries per org; one tick session plus up to `maxConcurrentSessions` spawned sessions per workflow; sessions bounded to minutes.

## Constitution Check

| Principle | Status | Notes |
|---|---|---|
| I. Contract-first HTTP | Pass | No route changes; OpenAPI unchanged (FR-017) |
| II. Test-gated delivery | Pass | Full gate set before PR; handler-adjacent code tested in `pkg/plugin/` |
| III. RBAC and multi-org | Pass, explicit | Synthetic Editor identity; internal tools never listed for interactive users; no `X-Grafana-Org-Id` with SA auth (FR-015); Viewer rule untouched |
| IV. Fail fast, no silent fallback | Pass | Invalid entry disables itself with a named error; no Redis disables all workflows; lock-skip is the only silent skip and is by design (the other replica holds the tick) |
| V. House style | Pass | `unknown` over `any`, `backend/log`, no colours involved, minimal comments |
| VI. Conventional commits | Pass | `feat(backend): ...` scope per `commitlint.config.js` |
| VII. Evidence-backed specs | Pass | Spec cites retro 101, 105, 108, 111, 113, 114, 115, 116, 119, 124 |
| VIII. Safe outbound I/O | Pass | No new HTTP; Redis access through the existing client; no env reads |

## Project Structure

### Documentation (this feature)

```text
specs/002-workflows/
├── spec.md              # This feature's specification
├── plan.md              # This file
└── tasks.md             # Task list
```

`research.md`, `data-model.md`, `quickstart.md`, and `contracts/` are folded into this plan and the spec's Key Entities: the design was settled through a structured scoping session and the data model is small and fully specified by FR-001 to FR-018. A user-facing quickstart ships with the documentation task in the polish phase.

### Source Code (repository root)

```text
pkg/
├── agent/
│   ├── internal_tools.go        # InternalTool type; LoopRequest injection; loop dispatch
│   └── internal_tools_test.go
└── plugin/
    ├── workflows.go             # WorkflowEntry types; parse + validate from settings
    ├── workflows_test.go
    ├── workflow_scheduler.go    # Per-entry ticker; Redis tick lock; tick execution
    ├── workflow_scheduler_test.go
    ├── workflow_session.go      # Headless LoopRequest construction; persistence; watchdog
    ├── workflow_session_test.go
    ├── workflow_spawn.go        # spawn_session + share_session handlers; Redis active-set and caps
    ├── workflow_spawn_test.go
    ├── workflow_metrics.go      # Per-workflow counters and duration histogram
    ├── org_identity.go          # Per-org lazy identity capture (Scout pattern, generalized)
    └── org_identity_test.go
```

**Structure Decision**: All new code lives in `pkg/plugin/` except the small generic `InternalTool` extension in `pkg/agent/`, which the loop needs to dispatch plugin-provided tools without importing the plugin package. No routes register, so `plugin.go` changes are limited to construction wiring (start schedulers, seed the identity store at the existing Scout seeding site).

## Design Decisions

1. **Internal tools via `LoopRequest` extension, not global registration.** `LoopRequest.InternalTools []InternalTool` (name, description, schema, handler) is the only change to the agent package. The plugin injects `spawn_session` and `share_session` only for workflow runs, which satisfies FR-012 without touching the interactive catalog or RBAC filtering.
2. **Cross-replica caps through Redis, not memory.** `workflow:<name>:active` (ZSET, member = run id, score = watchdog deadline) counts spawned sessions across replicas. Spawn checks the cardinality against `maxConcurrentSessions`; expired members are pruned on read. The tick lock already serializes dispatchers, but ticks can rotate between replicas while spawned sessions are still running.
3. **Watchdog as a per-session timer on the host process.** The replica that starts a session owns its timer and cancels through the existing in-process cancel path; the run record reaches `failed` through the existing run-store update. If the host replica dies, the existing stalled-run heartbeat reconcile marks the run failed. No new recovery machinery.
4. **Per-org identity store, Scout untouched.** `org_identity.go` holds `{orgID → grafanaURL, SA token}`, seeded at the exact site where Scout is seeded today (the inbound agent-run path). Scout keeps its single-org capture (retro 119 unchanged); workflows read the new store.
5. **Session construction reuses the interactive path.** `workflow_session.go` calls the same skill resolution, prompt build, and store writes that `handleAgentRun` uses, with a workflow identity and conversation type. A minimal extraction of shared helpers is allowed; no behavior change to interactive runs.
6. **Dry-run is allowlist composition** (FR-018). The tenant's rollout plan is one allowlist choice, not a plugin mode.

## Complexity Tracking

No constitution violations. One justified addition: the `InternalTool` seam in `pkg/agent/` — rejected the simpler alternative (registering the two tools globally and filtering them out of interactive catalogs) because it would touch RBAC filtering and every catalog consumer to hide two tools, instead of one opt-in field on the loop request.
