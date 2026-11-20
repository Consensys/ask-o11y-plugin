# Autonomous agent workflows (002)

## Summary

Adds a generic, tenant-agnostic workflow capability to the plugin backend: provisioned workflow entries (`jsonData.workflows`) drive an in-plugin scheduler that runs headless agent sessions with a skill, a model, an iteration budget, and a per-workflow tool allowlist. Two internal tools — `spawn_session` and `share_session` — exist only inside workflow sessions; a watchdog bounds every run; a Redis lock elects one leader per tick across replicas. No new routes, no UI, no skills, and no tenant logic ship in the plugin: workflows are pure configuration against the tenant's MCP servers.

- Spec: `specs/002-workflows/spec.md` — 7 user stories, 18 functional requirements.
- Plan: `specs/002-workflows/plan.md` — constitution check (all eight principles pass), design decisions, file layout.
- Tasks: `specs/002-workflows/tasks.md` — 24 tasks, all test-first where applicable, all complete.
- Retro-specs refreshed in this PR: 111 (workflow sessions), 114 (`workflows` settings key), 124 (workflow metrics); drifted evidence pointers in 101, 102, 103, 104, 105, 108, 112, 113, 115, 118, 119 repaired by the same change (`node scripts/verify-retro-specs.mjs` passes).

## RBAC statement (constitution III)

| Action | Admin | Editor | Viewer | Enforcement |
|---|---|---|---|---|
| Define a workflow entry (settings, provisioning) | yes | no | no | Grafana app settings, `settings:write` |
| Workflow session runs with unattended write tools | synthetic Editor identity, bounded by the per-workflow allowlist | n/a | n/a | `pkg/agent/loop.go` (listing + execution), `pkg/plugin/workflow_session.go:170` |
| See `spawn_session` / `share_session` in an interactive run | no | no | no | internal tools, injected per run only (`pkg/agent/internal_tools.go:15`, `pkg/plugin/workflow_session.go:292`) |
| Read a workflow session | synthetic identity or share link | same | same | existing session-store owner scoping (`pkg/plugin/sessionstore.go:175`) |

The Viewer rule is untouched: workflow tools never enter the interactive catalog, and the synthetic identity is never a Viewer. The Org-1 SA-token invariant is restated in the spec (FR-015) and honored: workflow runs reuse the interactive org/token path and never send `X-Grafana-Org-Id` with SA auth.

## Standards review answers (all questions, `npm run review:diff`)

| Question | Answer | Citation |
|---|---|---|
| filesystem-io | no | no `os.*` file APIs; settings arrive via `AppInstanceSettings` (`pkg/plugin/workflows.go:38`); enforced by `lint:standards` + `golangci-lint` (clean) |
| eval-in-browser | no | diff touches no frontend code |
| exec-user-input | no | no `exec.Command`/`syscall` in the diff; `golangci-lint` clean |
| third-party-analytics | no | new code emits Prometheus metrics only (`pkg/plugin/workflow_metrics.go:20`) |
| global-window | no | no frontend code |
| global-css | no | no frontend code |
| external-scripts | no | no frontend code |
| resources-closed | no | tick-scoped Redis contexts use `defer cancel` (`pkg/plugin/workflow_scheduler.go:33`); the plugin-lifecycle client closes in `Dispose` (`pkg/plugin/plugin.go`); test servers close via `t.Cleanup` (`pkg/plugin/workflow_session_test.go:44`) |
| global-dom-selectors | no | no frontend code |
| httpclient-sdk | no | the feature adds no outbound HTTP; existing SDK-built LLM/MCP clients are reused (`pkg/plugin/workflow_session.go:172`) |
| sensitive-in-logs | no | logs carry workflow names, ids, statuses, error values only (`pkg/plugin/workflow_session.go:198`); tokens never logged |
| log-formatting | no | all calls use key-value pairs (`pkg/plugin/workflow_scheduler.go:171`) |
| unsanitized-html | no | no frontend code |
| panic-for-errors | no | all failure paths return errors or tool-error content (`pkg/plugin/workflow_session.go:266`) |
| storage-key-namespacing | no | no browser storage |
| grafana-dependency-consistency | no | no `plugin.json` changes |
| nil-check-before-use | no | every error is checked before use (`pkg/plugin/workflow_session.go:36`); Redis nil-guards are explicit (`pkg/plugin/workflow_scheduler.go:62`) |
| request-context | no | no `QueryData`/`CheckHealth` changes |
| readme-install-instructions | no | `src/README.md` untouched |
| hardcoded-css-values | no | no frontend code |
| response-body-in-error | no | new code handles no HTTP responses; Redis errors log as error values (`pkg/plugin/workflow_scheduler.go:161`) |
| url-in-log | no | the share URL is tool content returned to the model (`pkg/plugin/workflow_session.go:316`), never logged |

## Gates

| Gate | Result |
|---|---|
| `go test ./pkg/...` | pass (all packages) |
| `golangci-lint run ./pkg/...` | 0 issues |
| `npm run test:ci` | 589 tests pass |
| `npm run lint` / `typecheck` | 0 errors (9 pre-existing warnings in untouched files) |
| `npm run build` / `build:backend` | pass |
| `npm run validate:openapi` | valid (no route changes; `openapi.json` unchanged) |
| `npm run lint:standards` | 72 Go files, 90 TS files clean |
| `npm run validate` | pass; findings limited to the documented benign set (unsigned plugin, React 19 `@floating-ui/react`, gosec G101/G404 pre-existing per `specs/001-mcp-tool-catalog-refresh/tasks.md:255`) |
| `npm run e2e` | 46 tests pass |
| `node scripts/verify-retro-specs.mjs` | pass |

## Constitution principles touched

III (RBAC and multi-org — statement above, no invariant changed), IV (fail fast — invalid entries disable themselves with named errors, no-Redis disables all workflows, lock-skip is the single silent skip and is by design), VIII (safe I/O — no new outbound HTTP, bounded Redis contexts, log hygiene).
