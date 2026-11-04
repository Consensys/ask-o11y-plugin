# Ask O11y Constitution

<!--
  Ratified 2026-11-04. This file holds process law only.
  Commands, architecture, and known gotchas live in CLAUDE.md.
  Amendment procedure: see Governance.
-->

## Core Principles

### I. Contract-First HTTP Surface

Every route change ships with the OpenAPI spec in the same commit.

- Routes register in `pkg/plugin/plugin.go` only.
- A route change updates `pkg/plugin/openapi/openapi.json` and passes `npm run validate:openapi`.
- All routes live under `/api/plugins/consensys-asko11y-app/resources/`.
- No route without a handler test in `pkg/plugin/`.

**Rationale**: 21 routes share one registration site and one published spec. A route without a spec entry is invisible to clients.

### II. Test-Gated Delivery

A change is not complete until the full gate set passes.

- Backend: `go test ./pkg/...`
- Frontend: `npm run test:ci`
- Style: `npm run lint`, `npm run typecheck`
- Build: `npm run build`, `npm run build:backend`
- Plugin: `npm run validate`

Severity policy: Critical = fix now. Major = fix before commit. Medium = fix before PR. Low = optional.

**Rationale**: CI cannot see local regressions. The gate set is the only shared definition of done.

### III. RBAC and Multi-Org Invariants (NON-NEGOTIABLE)

- Viewers receive only tools with `readOnlyHint: true`. The rule applies at listing and at execution, in `pkg/rbac/rbac.go`.
- Every feature that adds a tool, route, or skill states its Admin / Editor / Viewer behaviour.
- `useBuiltInMCP: true` never appears in `provisioning/plugins/full.yaml_`.
- The service-account token is Org 1 only. Never send `X-Grafana-Org-Id` with service-account auth.

**Rationale**: A leak here exposes customer data across organizations. There is no safe fallback.

### IV. Fail Fast, No Silent Fallback

- A missing dependency or a failed call surfaces immediately. Do not add default behaviour that hides the fault.
- SSE `error` events reach the user. Never swallow them.
- Use `httpclient.New()` from the Grafana SDK. Never construct a bare `&http.Client{}`. Copy `.Timeout` into any wrapper.
- HTTP responses never contain raw errors. Log server-side, return a generic message.

**Rationale**: Silent degradation turns a loud bug into wrong answers about observability data.

### V. House Style

- No `any`; use `unknown`.
- No `console.*`. Surface errors in the UI. Use `backend/log` in Go.
- No hardcoded colours. Use semantic Tailwind tokens: `bg-background`, `text-primary`, `border-weak`.
- Prefer `@grafana/ui` components over custom implementations.
- Comments explain non-obvious *why* only. Delete comments that restate code.
- Catch blocks handle errors meaningfully. Never swallow silently.

### VI. Conventional Commits and release-please

- Format: `type(scope): description`. Lowercase, imperative, no period.
- Types and scopes are fixed by `commitlint.config.js`. Do not invent a scope.
- Never edit `CHANGELOG.md` or a version by hand. release-please owns both.

**Rationale**: commitlint and release-please fail closed. A free-form scope breaks the release.

### VII. Evidence-Backed Specifications

- Retro-specs in `specs/retro/` state the contract that exists today.
- Each behaviour rule carries one coverage tag: `VERIFIED`, `ASSUMED`, or `GAP`.
- `VERIFIED` requires a code pointer (`path:line`) or a test name.
- Untagged behaviour prose is invalid in a retro-spec.
- A forward spec cites the retro-specs that it can break.

**Rationale**: Without tags, a retro-spec becomes a wish list. The tag makes every claim falsifiable.

## Specification Policy

### Directory layout

| Path | Content | Numbering |
|---|---|---|
| `specs/NNN-slug/` | Forward feature | Auto, from `create-new-feature.sh` |
| `specs/retro/NNN-slug/` | Retro-spec | Manual, 100+ block |
| `specs/_templates/retro-spec.md` | Retro template | Not a spec |
| `specs/retro/README.md` | Capability index | — |

`create-new-feature.sh` scans direct children of `specs/` with the pattern `^[0-9]{3,}-`. It therefore skips `specs/retro/` and `specs/_templates/`. Forward features keep clean numbers without flags.

### Persistence model

Living spec. A retro-spec is the contract for an active module. When the module changes, update the retro-spec and its `Last verified` commit in the same PR. Never fork a second copy.

### Workflow chain

`/speckit.specify` → `/speckit.clarify` → `/speckit.plan` → `/speckit.checklist` → `/speckit.tasks` → `/speckit.analyze` → `/speckit.implement` → `/speckit.converge`.

`/speckit.specify` is mandatory before `/speckit.plan`. Clarify, checklist, and analyze are optional. Converge is append-only.

Hotfixes use the `bug` extension. Do not run the full chain for a one-line fix.

### Context discipline

An agent loads one retro-spec per task. Never load `specs/retro/README.md` plus every spec.

## Quality Gates

### Per change

| Gate | Command |
|---|---|
| Backend tests | `go test ./pkg/...` |
| Frontend tests | `nvm use 22 && npm run test:ci` |
| Lint | `nvm use 22 && npm run lint` |
| Types | `nvm use 22 && npm run typecheck` |
| Build | `nvm use 22 && npm run build && npm run build:backend` |
| OpenAPI | `nvm use 22 && npm run validate:openapi` |

### Per pull request

| Gate | Command or condition |
|---|---|
| Plugin validator | `nvm use 22 && npm run validate` |
| E2E | `nvm use 22 && npm run e2e` |
| RBAC review | Explicit, in the PR body |
| Spec drift | `node scripts/verify-retro-specs.mjs` |
| Benign validator findings | `unsigned plugin`, sponsor link, react-19 jsx-runtime for `@floating-ui/react` |

Every other validator `warning` or `error` blocks the PR.

## Development Workflow

- Shell state does not persist between calls. Prefix every npm command with `nvm use 22 &&`.
- Do not edit `.config/`. It comes from `@grafana/create-plugin`.
- Configuration lives in `provisioning/plugins/app.yaml` and `provisioning/plugins/full.yaml_`. The trailing `_` stops auto-load.
- Documentation audience decides the file: `README.md` for users, `CLAUDE.md` and `CONTRIBUTING.md` for developers. Ask when unsure.

## Governance

- This constitution governs process. `CLAUDE.md` governs commands and architecture. On conflict about a command or a file path, `CLAUDE.md` wins. On conflict about a gate or a workflow, this constitution wins.
- Every PR states the principles it touches. An RBAC, multi-org, or fail-fast change names the principle explicitly.
- Amendment requires a dedicated PR with a stated reason and the retro-specs it invalidates.
- Version follows semantic versioning: patch for a clarification, minor for a new principle, major for a removal or redefinition.

**Version**: 1.0.0 | **Ratified**: 2026-11-04 | **Last Amended**: 2026-11-04
