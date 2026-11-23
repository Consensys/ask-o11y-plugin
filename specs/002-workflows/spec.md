# Feature Specification: Autonomous Agent Workflows

**Feature Branch**: `002-workflows`

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "Scheduled autonomous agent workflows inside the public plugin: an in-plugin scheduler, headless sessions with skills, budgets and per-workflow tool allowlists, a bounded spawn_session tool, and a watchdog. Tenant workflow content targets Grafana IRM through the external mcp-grafana MCP server. No tenant-specific logic ships in plugin code."

## Context

One asko11y deployment automates NOC alert triage today with an external workflow platform that drives the plugin through its HTTP API: a dispatcher acknowledges, tags, and dispatches alerts; an investigator starts agent runs, collects the report, and posts notes back. That orchestration capability belongs inside the product, so every customer can run it without an external platform.

This feature replaces the orchestration with a generic capability of the plugin itself, so that any customer of the public plugin can run scheduled agent workflows against their own systems through MCP. The design model is skills-plus-spawn: deterministic platform primitives carry schedule, budget, timeout, caps, and visibility; all workflow behaviour lives in tenant skills. The node-graph model of external workflow platforms was evaluated and rejected for v1 (build cost); the platform follows the proven separation of triggers, deterministic steps, and agent steps only as a concept reference.

The reference integration is a NOC auto-investigation: four skills (dispatch, investigate, collect, janitor) running against Grafana IRM tools from the external mcp-grafana server. All workflow content is tenant configuration and lives in the tenant's deployment, never in this repository. Tenant identifiers never enter this repo.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A skill runs on a schedule, unattended (Priority: P1)

A Grafana admin provisions a workflow entry: a name, an interval, a skill, a model, an iteration budget, and a tool allowlist. The plugin starts a scheduler for it. Every interval, the plugin runs one headless agent session with that skill, that model, that budget, and only the allowlisted tools. The session and its run record persist like an interactive run, under a synthetic workflow identity. The skill acts on the tenant's systems through MCP tools, for example posting a finding to a Grafana IRM incident.

**Why this priority**: This is the minimum standalone slice. One scheduled skill already delivers value (a janitor, a reporter, a single-tier investigator) without any other story.

**Independent Test**: Provision a workflow with a 60-second interval and a stub skill that calls one allowlisted MCP tool. Assert that within two ticks a session record and a run record exist, that the tool call went through, and that a tool outside the allowlist is absent from the session's tool catalog.

**Acceptance Scenarios**:

1. **Given** an enabled workflow with interval 60 and a valid skill, **When** the interval elapses, **Then** the plugin starts exactly one headless session for it and records it in the session and run stores.
2. **Given** a workflow whose allowlist names three tools, **When** the session starts, **Then** the session's advertised tool set contains those three tools, the internal workflow tools, and nothing else.
3. **Given** a completed workflow session, **When** an admin lists sessions for the workflow identity, **Then** the session appears with its messages, tool calls, and stats.

---

### User Story 2 - A workflow session starts bounded sub-sessions (Priority: P1)

A dispatcher skill finds work to do and starts one investigation per item. It calls the internal `spawn_session` tool with a skill name and a payload message. The plugin starts a new headless session for that skill, applies the workflow's spawn caps, and returns the session and run identifiers to the dispatcher.

**Why this priority**: The dispatcher-to-investigator shape is the canonical workflow. Without bounded spawn, the platform cannot express it.

**Independent Test**: Run a dispatcher skill against a stub list of three items with cap two. Assert that two sub-sessions start, that the third spawn call returns a capacity error to the model, and that after one sub-session finishes, a later spawn succeeds.

**Acceptance Scenarios**:

1. **Given** a workflow with `maxConcurrentSessions: 5` and `spawnableSkills` naming an investigation skill, **When** the dispatcher session calls `spawn_session` with that skill, **Then** a new headless session starts and the tool returns its session and run identifiers.
2. **Given** five active spawned sessions, **When** the dispatcher calls `spawn_session` again, **Then** the tool returns a capacity error to the model and no sixth session starts.
3. **Given** a spawn request for a skill not in `spawnableSkills`, **When** the dispatcher calls `spawn_session`, **Then** the tool refuses and names the allowed skills.

---

### User Story 3 - Every run is bounded by a watchdog (Priority: P1)

A workflow session hangs or runs past its budget. The watchdog cancels the run at the configured timeout, marks it failed, increments the failure metric, and optionally runs a configured fallback skill once.

**Why this priority**: Unattended sessions must never run forever. The watchdog is the deterministic safety net for LLM-driven control flow.

**Independent Test**: Point a workflow at a stub LLM that never answers. Assert that the run is cancelled within the timeout plus a 30-second grace, marked failed in the run store, counted in the failure metric, and that a configured fallback skill runs once.

**Acceptance Scenarios**:

1. **Given** a workflow with `sessionTimeoutSeconds: 120` and a session that makes no progress, **When** 120 seconds elapse, **Then** the run is cancelled through the existing cancel path and marked failed.
2. **Given** a workflow with a `fallbackSkill` configured, **When** the watchdog cancels a session, **Then** the fallback skill runs exactly once with the workflow payload.
3. **Given** a session that completes normally, **When** the watchdog timer fires after completion, **Then** nothing happens.

---

### User Story 4 - One leader per tick (Priority: P2)

A deployment can run several Grafana replicas, so several plugin backend instances. Each scheduler tick takes a Redis lock before it runs. Only the lock holder executes the tick. The other instances skip silently.

**Why this priority**: Without the lock, every workflow runs twice per interval. It is P2 because dev and single-replica deployments work without it, but production correctness depends on it.

**Independent Test**: Run two backend instances against one Redis with a 30-second workflow. Assert over ten intervals that exactly ten sessions start, not twenty.

**Acceptance Scenarios**:

1. **Given** two plugin instances and one Redis, **When** a workflow interval elapses, **Then** exactly one instance executes the tick.
2. **Given** a lock held by an instance that dies, **When** the lock TTL expires, **Then** the surviving instance takes the next tick.

---

### User Story 5 - Unattended runs stay contained (Priority: P2)

Workflow sessions run with approvals off, an Editor-role synthetic identity, and the per-workflow allowlist. The internal tools `spawn_session` and `share_session` exist only inside workflow sessions. Interactive users see no new tools, and the Viewer rule is untouched.

**Why this priority**: Containment is what makes unattended write tools acceptable. It is P2 because the primitives of stories 1 to 3 already work behind it.

**Independent Test**: Start an interactive run as Admin, Editor, and Viewer. Assert that no tool catalog contains `spawn_session` or `share_session`. Start a workflow session. Assert that a non-allowlisted tool is refused at listing and at execution.

**Acceptance Scenarios**:

1. **Given** an interactive run in any role, **When** the client lists tools, **Then** `spawn_session` and `share_session` do not appear.
2. **Given** a workflow session, **When** the model calls a tool outside the allowlist, **Then** the call is refused at execution, as the tool-selection filter already refuses it at listing.
3. **Given** a workflow session, **When** a tool call would normally require approval, **Then** it executes without an approval prompt, because the run carries approval policy `off`.

---

### User Story 6 - The workflow starts only from valid, seeded config (Priority: P2)

Workflow entries load from app instance settings and provisioning. An invalid entry (unknown skill, empty allowlist, interval below the floor) disables that entry at startup with an error log that names it; other entries run. A workflow whose org identity is not yet seeded skips ticks with a rate-limited warning until the first inbound request in that org seeds the service-account token.

**Why this priority**: Fail fast on bad config, and a defined behaviour for the lazy identity bootstrap. It is P2 because it hardens stories 1 to 3 rather than adding capability.

**Independent Test**: Provision two workflows, one valid and one referencing a missing skill. Assert that the valid one ticks and the invalid one logs one error naming the entry and never ticks.

**Acceptance Scenarios**:

1. **Given** a workflow entry with an unknown skill name, **When** the plugin starts, **Then** that entry is disabled with one error log naming it, and every other entry starts.
2. **Given** a workflow whose org has no seeded service-account token, **When** a tick fires, **Then** the tick is skipped with a rate-limited warning, and the workflow starts on the next tick after seeding.

---

### User Story 7 - Workflow failures are observable (Priority: P3)

Every workflow emits metrics: ticks executed, ticks skipped, sessions started, completed, failed, cancelled, active spawned sessions, and run duration. Logs name the workflow on every state change.

**Why this priority**: An operator must see a dead loop. The sessions UI shows outcomes per session; metrics show the loop's health. It is P3 because stories 1 to 3 already log; this makes the health legible at a glance.

**Independent Test**: Run a workflow for ten ticks with one induced failure. Assert the counters and the duration metric for that workflow name.

**Acceptance Scenarios**:

1. **Given** a workflow that fails one session in ten ticks, **When** the operator reads the metrics, **Then** started is 10, failed is 1, completed is 9.
2. **Given** a workflow identity, **When** the operator lists its sessions through the existing sessions API, **Then** workflow sessions are distinguishable from interactive sessions by their conversation type.

### User Story 8 - The admin watches and toggles workflows in the config UI (Priority: P2)

A Grafana admin opens the plugin configuration and sees one Workflows tab: every provisioned entry with its schedule, whether a scheduler runs for it on this instance, the last tick time and outcome, and the session outcome counters. Toggling a workflow enabled saves immediately and restarts the plugin instance, which restarts its schedulers.

**Why this priority**: The feature is unattended; without a surface, an operator reads logs and metrics to answer is it on and is it working. It is P2 because the metrics and the sessions UI already answer the same questions for a patient operator.

**Independent Test**: Configure one running and one disabled workflow; open the tab; assert both rows with status, and assert the toggle persists through the standard settings save.

**Acceptance Scenarios**:

1. **Given** two configured workflows, one running, **When** the admin opens the Workflows tab, **Then** both rows render with per-instance tick and session status.
2. **Given** a running workflow, **When** the admin switches it off, **Then** the full entry list persists losslessly and the plugin instance reloads without the scheduler.
3. **Given** a Viewer role request, **When** it calls the workflows API, **Then** it is refused.

### User Story 9 - The admin opens workflow sessions from the config UI (Priority: P2)

Each workflow row expands into its recent runs: status, start time, terminal error, and an Open button that deep-links the chat page to the run's session (?sessionId=). The session GET allows Admins to read workflow sessions — the synthetic owner would otherwise make them invisible — while interactive sessions stay owner-scoped and the org boundary always applies.

**Why this priority**: Unattended sessions nobody can open are unverifiable; this is the audit surface for the whole feature.

**Independent Test**: Run a workflow, open the tab, expand the row, click Open — the chat renders the session; a Viewer fetching the same session gets 404.

**Acceptance Scenarios**:

1. **Given** a workflow with runs, **When** the admin expands its row, **Then** the recent runs list with status and Open links.
2. **Given** an admin opens a workflow session, **Then** the chat renders it; **Given** a non-admin fetches it, **Then** 404.
3. **Given** an interactive session of another user, **When** an admin fetches it, **Then** 404 — the admin read covers workflow sessions only.

---

### User Story 10 - The admin edits workflow configs and prompts in the config UI (Priority: P2)

The tab gains a full editor: every workflow entry field (skill from the enabled-skill list, message, model, interval, timeout, cap, iteration budget, allowlist, spawnable skills, fallback, org), create, and delete. The name is immutable after creation — renaming would orphan the synthetic user's sessions. Edit prompt jumps to the Skills tab with that skill's editor open, so the workflow behavior (the skill body) is editable in place.

**Why this priority**: Provisioning-only editing keeps the loop in the platform team; the UI hands it to the NOC owners.

**Independent Test**: Edit a field, save — the settings persist losslessly, the instance reloads, the change takes effect on the next tick.

**Acceptance Scenarios**:

1. **Given** an existing workflow, **When** the admin edits its interval and saves, **Then** the full list persists and the scheduler restarts with the new interval.
2. **Given** the editor, **When** the admin clicks Edit prompt, **Then** the Skills tab opens with that skill's editor loaded.
3. **Given** a new workflow form with a missing name, skill, or allowlist, **When** the admin saves, **Then** the save is refused client-side.

### Edge Cases

- Redis is configured but unreachable. The tick is skipped with an error log. No tick runs without the lock while Redis is configured.
- Redis is not configured at all. No workflow starts. The plugin logs one error at startup naming the requirement. Dev compose provides Redis.
- The Grafana process restarts mid-investigation. The existing stalled-run reconcile marks the interrupted run failed. The next tick re-reads state from the tenant system. The plugin holds no workflow state to recover.
- The lock TTL expires while a tick is still running. Tick work is bounded to listing and spawning; long work lives in sessions. A duplicate dispatch is caught by the tenant's state, as it is today.
- The LLM gateway is down. The session fails, the watchdog fallback runs if configured, the failure metric increments.
- An MCP server in the allowlist is down. Tool errors reach the model and the run fails or the skill handles it. The error surfaces; no silent fallback.
- A spawned session outlives its parent tick. Spawned sessions are independent; the cap counts them until they finish or their own watchdog cancels them.
- A skill named in `spawnableSkills` is later disabled. Spawn calls for it fail with the refusal that names the allowed skills.
- A workflow session tries to spawn from a spawned session. Allowed only if the spawned session's workflow config permits nesting; v1 forbids nesting, the tool refuses.
- Two workflows name the same skill. Both run it independently with their own allowlists and caps.
- A Viewer opens the sessions list. Workflow sessions belong to the synthetic workflow identity, not the Viewer. A human reaches a workflow session only through a share link created by `share_session`.
- The allowlist names a tool that no configured server provides. The entry is invalid at startup, per User Story 6.
- The interval is set below the 60-second floor. The entry is invalid at startup.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST load workflow entries from app instance settings `jsonData.workflows` and from the equivalent provisioning file, with fields: `name`, `enabled`, `intervalSeconds` (default 300, floor 60), `skill`, `model`, `maxIterations`, `toolAllowlist`, `spawnableSkills`, `maxConcurrentSessions`, `sessionTimeoutSeconds`, and `fallbackSkill` (optional). Entries carry no org field: Grafana provisions app settings per org, so a workflow always runs in the org that owns its settings, and the instance identity (org, Grafana URL, service-account token) seeds from that org's requests. An earlier revision carried `orgId`; it was removed as redundant (2026-11-23).
- **FR-002**: At startup the system MUST validate every entry. An invalid entry (unknown skill, empty allowlist, allowlist naming no known tool, interval below the floor, missing name, duplicate name) MUST disable that entry with one error log naming it. Valid entries MUST start. The plugin MUST NOT refuse to start because one entry is invalid.
- **FR-003**: The system MUST run one scheduler per enabled entry, ticking at the entry's interval.
- **FR-004**: When Redis is configured, a tick MUST acquire a per-workflow lock (`workflow:<name>:tick`, SETNX, TTL no longer than half the interval) before it executes. A tick that cannot take the lock MUST skip silently. A tick that cannot reach Redis MUST skip with an error log.
- **FR-005**: When no Redis URL is configured, the system MUST disable all workflows at startup with one error log stating the requirement.
- **FR-006**: A tick MUST execute one headless agent session for the entry's skill, built on the existing `agent.LoopRequest` path, with: the skill rendered into the system prompt through the existing skill mechanism, the entry's model, the entry's `maxIterations`, approval policy `off`, synthetic user and role `Editor`, and the entry's `orgId`.
- **FR-007**: The session's advertised and callable tool set MUST be exactly: the allowlisted tools, the internal tools `load_skill` and `search_tools`, and the internal workflow tools `spawn_session` and `share_session`. Tool filtering MUST reuse the existing selection and RBAC filters, at listing and at execution.
- **FR-008**: Workflow sessions MUST create session and run records through the existing stores, with a `workflow` conversation type and the workflow name as metadata. They MUST be readable through the existing sessions and runs APIs under the synthetic identity.
- **FR-009**: The `spawn_session` tool MUST accept a skill name and a payload message, start a headless session per FR-006/FR-007 rules for that skill, and return its session and run identifiers.
- **FR-010**: `spawn_session` MUST refuse when the workflow's active spawned sessions reach `maxConcurrentSessions`, when the skill is not in `spawnableSkills`, and when called from a spawned session (no nesting in v1). Refusals MUST return an error to the model naming the constraint.
- **FR-011**: The `share_session` tool MUST create a share link for the current session through the existing share mechanism and return the share URL.
- **FR-012**: `spawn_session` and `share_session` MUST NOT appear in the tool catalog of any interactive run, in any role.
- **FR-013**: Every workflow session, top-level or spawned, MUST be bounded by `sessionTimeoutSeconds`. On timeout the system MUST cancel the run through the existing cancel path, mark it failed, increment the failure metric, and run `fallbackSkill` once if configured.
- **FR-014**: A tick MUST skip with a rate-limited warning when the entry's org identity is not seeded. Identity seeding MUST follow the existing Scout pattern: org id and service-account token captured from the first inbound request in that org, token refreshed on later requests.
- **FR-015**: Workflow runs MUST NOT send `X-Grafana-Org-Id` with service-account auth, and MUST reuse the org-resolution and token path of an interactive run in the same org. No new cross-org surface is introduced.
- **FR-016**: The system MUST emit per-workflow metrics: ticks executed, ticks skipped (by lock, by identity, by error), sessions started, completed, failed, cancelled, active spawned sessions, and run duration.
- **FR-017**: The original scope shipped no HTTP route. The config-UI increment (2026-11-20, same feature branch) adds exactly one: `GET /api/workflows`. The OpenAPI spec entry ships in the same commit.
- **FR-018**: Dry-run behaviour MUST be achieved by allowlist composition (omit the write tools), not by a separate mode.
- **FR-019**: The system MUST expose `GET /api/workflows` (Admin only) returning every configured entry joined with this plugin instance's runtime status: last tick time, last tick outcome, session outcome counters, and the last tick error when a tick could not proceed.
- **FR-020**: The status counters MUST be per-instance; the API MUST NOT present them as cluster-wide totals.
- **FR-021**: The AppConfig UI MUST provide a Workflows tab listing every entry with its status and an enable toggle whose save persists the full workflow list losslessly and restarts the plugin instance.
- **FR-022**: The system MUST expose `GET /api/workflows/{name}/runs` (Admin only) returning the recent runs of the named workflow, newest first, each with its session id, status, and terminal error.
- **FR-023**: `GET /api/sessions/{id}` MUST allow Admins to read a session whose conversation type is `workflow` in their own org, and MUST refuse every other cross-owner read, including Admins reading interactive sessions of other users.
- **FR-024**: The Workflows tab MUST offer a full entry editor (create, edit, delete) that persists the whole workflow list through the standard settings save; the entry name MUST be immutable after creation.
- **FR-025**: The tab MUST link each workflow's skill to the Skills tab editor for that skill.
- **FR-026**: The chat deep link (`?sessionId=`) MUST open workflow sessions for Admins; sending follow-up messages into a workflow session remains owner-scoped.

### Key Entities

- **Workflow entry**: The provisioned configuration: identity (name), schedule (interval), behaviour (skill, model, budget), containment (allowlist, spawnable skills, caps, timeout, fallback), and scope (org).
- **Workflow scheduler**: One in-process ticker per enabled entry, executing a tick.
- **Tick lock**: The per-workflow Redis lock that elects one leader among replicas for one tick.
- **Workflow session**: A headless agent session under the synthetic workflow identity, persisted in the session and run stores, carrying the `workflow` conversation type.
- **Spawn request**: A `spawn_session` call: target skill plus payload, bounded by caps and the spawnable list.
- **Internal workflow tools**: `spawn_session` and `share_session`, injected only into workflow sessions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A 60-second workflow produces a persisted, API-readable session within two ticks, and its tool catalog matches the allowlist exactly.
- **SC-002**: Two backend instances against one Redis produce exactly one session per interval over ten intervals.
- **SC-003**: A session that makes no progress is cancelled within its timeout plus 30 seconds, marked failed, and counted.
- **SC-004**: Active spawned sessions never exceed the configured cap; excess spawns return a capacity error to the model.
- **SC-005**: The interactive tool catalog is byte-identical before and after this feature, for Admin, Editor, and Viewer.
- **SC-006**: An invalid workflow entry disables only itself, with one error log naming it.
- **SC-007**: The per-workflow metrics report ticks, skips, starts, completions, failures, cancels, active spawns, and durations.

## Assumptions

- Tenant skills arrive as admin custom skills through the existing skills mechanism; the plugin ships no skills for this feature.
- The tenant provisions and authenticates the external mcp-grafana server per org; the plugin only filters its tools through the allowlist.
- Workflow state lives in the tenant's system of record (IRM alert groups, incidents, custom fields). The plugin stores run records only.
- One org per workflow entry in v1. Multi-org fan-out is out of scope.
- The synthetic workflow identity is not a real Grafana user; humans reach workflow sessions only through share links.
- No inbound webhook trigger and no template gallery. The AppConfig Workflows tab, originally deferred, shipped in the config-UI increment.
- Tenant workflow content, including any porting references, stays out of this repository; it carries tenant identifiers.
- Existing Redis, session store, run store, skills, and approval machinery are reused without modification to their contracts.

---

## Project Requirements (Ask O11y)

### RBAC Matrix

| Action | Admin | Editor | Viewer | Enforcement |
|---|---|---|---|---|
| Define a workflow entry (settings, provisioning) | yes | no | no | Grafana app settings, `settings:write` |
| Workflow session runs with unattended write tools | n/a (synthetic Editor identity, allowlist-bounded) | n/a | n/a | per-run allowlist, `pkg/mcp/selection.go`, `pkg/rbac/rbac.go` |
| See `spawn_session` / `share_session` in an interactive run | no | no | no | internal tools, not registered in the interactive catalog |
| Read a workflow session through the API | only under the synthetic identity, or via share link | same | same | existing session store and share contract |

The Viewer rule (read-only tools only) is untouched: workflow tools never enter the interactive catalog, and the synthetic identity is never a Viewer.

### Mandatory Edge Cases

| Edge case | Applies | Behaviour |
|---|---|---|
| A Viewer lists tools | Yes | Catalog unchanged; no workflow tools appear |
| The SSE `error` event | Yes | A failed workflow run records the error in its run record; no interactive stream is involved |
| Redis is unavailable | Yes | Tick skipped with error log; never a silent dual-run |
| The service-account token meets a non-Org-1 request | Yes | FR-015 forbids the org header with SA auth; the run reuses the interactive path for its org |

### Contract Changes

No route changes. `pkg/plugin/openapi/openapi.json` does not change (FR-017).

New observable contracts: the `workflows` settings section, the `workflow` conversation type on sessions, the two internal tools, and the per-workflow metrics.

### Existing Contracts

- `specs/retro/101-agent-loop/spec.md` — the loop request gains a workflow construction path; loop semantics unchanged.
- `specs/retro/105-tool-approval/spec.md` — approval policy `off` per run is an existing policy value; no gating change.
- `specs/retro/108-mcp-selection/spec.md` — the allowlist reuses tool selection; listing and execution filters unchanged.
- `specs/retro/111-sessions-runs/spec.md` — workflow sessions and runs use the stores; new conversation type; share links reused.
- `specs/retro/113-prompt-assembly/spec.md` — skill rendering into the system prompt is reused unchanged.
- `specs/retro/114-settings-multi-org/spec.md` — new `workflows` settings section; the Org-1 SA-token invariant is restated in FR-015.
- `specs/retro/115-rbac/spec.md` — no role change; internal tools never listed.
- `specs/retro/116-skills/spec.md` — explicit skill activation reused; skills stay tenant content.
- `specs/retro/119-evals-scout/spec.md` — the lazy identity capture generalizes Scout's pattern; Scout itself unchanged.
- `specs/retro/124-telemetry/spec.md` — new per-workflow metrics follow the existing telemetry patterns.
