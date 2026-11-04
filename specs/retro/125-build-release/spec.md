# Retro-Spec: Build, CI, Release, Deployment

**Capability ID**: `125-build-release`

**Status**: Retrospective

**Last verified**: `6c09d13`

**Owner**: Ask O11y maintainers

**Module**: `.github/`, `package.json`, `webpack.config.ts`, `Magefile.go`, `deploy/`, `provisioning/`, `docker/`

---

## Purpose

Build the frontend and the Go backend, then package one signed plugin archive.
Gate every pull request with tests, validation, and title checks.
Ship a versioned archive, a container image, and a local stack.

## Actors and RBAC

| Capability | Admin | Editor | Viewer | Evidence |
|---|---|---|---|---|
| Run CI on a pull request | n/a | n/a | n/a | `.github/workflows/ci.yml:7`; repository permission governs, not a Grafana role |
| Publish a release | n/a | n/a | n/a | `.github/workflows/release.yml:7`; repository permission governs |

## Contract

### HTTP endpoints

| Method | Path | Handler | Evidence |
|---|---|---|---|
| — | — | None. This capability ships static files and binaries. | `webpack.config.ts:3` |

### SSE events

| Event | Payload fields | Evidence |
|---|---|---|
| — | None. This capability emits no event. | — |

### Configuration keys

| Key | Location | Default | Evidence |
|---|---|---|---|
| `RELEASE_TOKEN` | repository secret | none | `.github/workflows/release-please.yml:19` |
| `GRAFANA_ACCESS_POLICY_TOKEN` | repository secret | none | `.github/workflows/release.yml:35` |
| `LLM_API_KEY` | repository secret | none | `.github/workflows/e2e.yml:131` |
| `AWS_ACCOUNT_ID`, `AWS_REGION`, `AWS_IAM_ROLE`, `ECR_REPOSITORY`, `IMAGE_TAG_PREFIX` | repository variables | none | `.github/workflows/docker-release.yml:18` |

### MCP tool names

| Tool | Read-only | Evidence |
|---|---|---|
| None. This capability adds no MCP tool. | n/a | `Magefile.go:10` |

## Behaviour Rules

1. CI runs on push to main, on every pull request, and on manual dispatch. `VERIFIED` — `.github/workflows/ci.yml:3`
2. CI detects code changes with `dorny/paths-filter`, and the eleven paths include `.github/workflows/**` and `.github/actions/**`. `VERIFIED` — `.github/workflows/ci.yml:23`, `.github/workflows/ci.yml:36`
3. E2E and compatibility checks use the same `.github` paths as the build filter, so a workflow-only edit runs them. `VERIFIED` — `.github/workflows/e2e.yml:34`, `.github/workflows/is-compatible.yml:26`
4. The build job runs when code changed, or on push, or on dispatch. `VERIFIED` — `.github/workflows/ci.yml:43`
5. A pull request with no code change runs `skip-build`, which reports the same job name. `VERIFIED` — `.github/workflows/ci.yml:162`, `.github/workflows/ci.yml:163`
6. A docs-only pull request therefore satisfies the build gate with a no-op job. `ASSUMED` — `.github/workflows/ci.yml:165`; no test or branch rule states this intent
7. Required checks and branch protection rules are not stored in the repository. `GAP` — `CODEOWNERS:5` is the only review rule found
8. The build job runs typecheck, lint, unit tests, frontend build, and React 19 validation in that order. `VERIFIED` — `.github/workflows/ci.yml:73`
9. The frontend build merges the `@grafana/create-plugin` base config and adds Tailwind CSS rules. `VERIFIED` — `webpack.config.ts:3`
10. Production builds add a contenthash to chunk filenames. `VERIFIED` — `webpack.config.ts:160`
11. The build aliases `react/jsx-runtime` and `react/jsx-dev-runtime` to a local shim. `VERIFIED` — `webpack.config.ts:149`
12. The backend build is `buildAll` from the Grafana SDK build package, and `npm run build` runs it after the production frontend build. `VERIFIED` — `Magefile.go:10`, `package.json:6`
13. The archive is `dist` renamed to the plugin id, zipped, with a sha1 file beside it. `VERIFIED` — `.github/actions/package-plugin/action.yml:166`
14. Signing runs only when a policy token is present. `VERIFIED` — `.github/actions/package-plugin/action.yml:141`
15. CI runs the validator from the pinned image `grafana/plugin-validator-cli:v0.51.3` with the repo config. `VERIFIED` — `.github/workflows/ci.yml:153`
16. The validator config disables the `version` analyzer, and `govulncheck` runs separately on the pinned Go 1.26.10 toolchain. `VERIFIED` — `.github/plugin-validator.config.yaml:11`, `.github/workflows/ci.yml:103`
17. Local `npm run validate` pins `@grafana/plugin-validator@0.51.3`, the same version as the CI image. `VERIFIED` — `package.json:35`
18. Three validator findings are benign: unsigned plugin, sponsor link, and `react-19-dep-jsxRuntimeImport` for `@floating-ui/react`. `VERIFIED` — `CLAUDE.md:42`
19. E2E skips fork pull requests because secrets are unavailable, and otherwise builds a coverage bundle and runs Playwright. `VERIFIED` — `.github/workflows/e2e.yml:96`, `.github/workflows/e2e.yml:145`
20. The artifact workflow builds on every branch push, keeps the zip for 15 days, and passes `create_release: false`, so it never creates a release. `VERIFIED` — `.github/workflows/artifact.yml:42`, `.github/workflows/artifact.yml:34`
21. The release workflow runs on a push of a `v*` tag. `VERIFIED` — `.github/workflows/release.yml:7`
22. The release build enables provenance attestation, passes the policy token for signing, and verifies the attestation. `VERIFIED` — `.github/workflows/release.yml:32`, `.github/workflows/release.yml:74`
23. The build action creates a draft GitHub release when `create_release` is true. `VERIFIED` — `.github/actions/build-plugin/action.yml:166`, `.github/actions/build-plugin/action.yml:169`
24. release-please runs on push to main and authenticates with `RELEASE_TOKEN`. `VERIFIED` — `.github/workflows/release-please.yml:19`
25. release-please owns the version and the changelog; `skip-github-release` is true, so the tag is the hand-off to the release workflow. `VERIFIED` — `.github/release-please-config.json:11`
26. release-please hides docs, style, refactor, test, build, ci, and chore sections from the changelog. `VERIFIED` — `.github/release-please-config.json:19`
27. The create-plugin update workflow runs monthly and on dispatch, and opens a pull request. `VERIFIED` — `.github/workflows/cp-update.yml:6`, `.github/actions/create-plugin-update/action.yml:9`
28. commitlint validates every commit in a pull request against the eleven allowed types. `VERIFIED` — `.github/workflows/commitlint.yml:25`
29. The scope list is a warning only, so a new scope does not block a commit. `VERIFIED` — `commitlint.config.js:10`
30. The PR title check requires a conventional type and does not require a scope. `VERIFIED` — `.github/workflows/pr-title.yml:44`
31. `CONTRIBUTING.md` says commit types are checked by commitlint; scopes are a warning only. `VERIFIED` — `CONTRIBUTING.md:607`, `commitlint.config.js:10`
32. `CONTRIBUTING.md` states that `golangci-lint` is local only; no workflow runs it. `VERIFIED` — `CONTRIBUTING.md:288`
33. `npm run server` starts `docker-compose.yaml`; `server:full` swaps in `full.yaml_`, starts the full stack, and restores both files on exit. `VERIFIED` — `package.json:26`, `package.json:27`
34. `full.yaml_` provisions two orgs; `app.yaml` provisions org 1 with the built-in MCP. `VERIFIED` — `provisioning/plugins/full.yaml_:42`, `provisioning/plugins/app.yaml:31`
35. `npm run dev:stack` runs `scripts/dev.sh` against `docker-compose.dev.yaml`. `VERIFIED` — `package.json:28`
36. Deployment artifacts are a container image with `dist` in `/package`, the Grafana Helm chart, and the compose stacks, tagged `<prefix>-<suffix or run number>` in ECR. `VERIFIED` — `Dockerfile:3`, `deploy/helm/grafana-values-ask-o11y-ha.yaml:8`, `.github/workflows/docker-release.yml:79`

## Invariants

- Every GitHub Action and nested action is pinned to a full-length commit SHA. `VERIFIED` — `.github/actions/build-plugin/action.yml:6`, `.github/workflows/ci.yml:17`
- CI and the release workflow use the same validator image and config. `VERIFIED` — `.github/workflows/ci.yml:153`
- The Docker build uses the frontend and backend output in `dist`. `VERIFIED` — `Dockerfile:3`
- `full.yaml_` configures `mcpServers` and never sets `useBuiltInMCP`. `VERIFIED` — `provisioning/plugins/full.yaml_:20`

## Failure Modes

| Condition | User-visible result | Evidence |
|---|---|---|
| Fork pull request | E2E is skipped by design; no E2E result for that PR | `.github/workflows/e2e.yml:216` |
| Validator finds a non-benign warning | CI fails at the validate step | `.github/workflows/ci.yml:148` |
| Policy token is missing | Archive is unsigned; validator reports `unsigned plugin` | `.github/actions/package-plugin/action.yml:141` |

## Data and Persistence

| Store | Key or table | TTL | Fallback | Evidence |
|---|---|---|---|---|
| GitHub Actions artifact | zip and sha1, coverage build, Playwright report, server log | 15 days, 5 to 30 days | none | `.github/workflows/artifact.yml:42`, `.github/workflows/e2e.yml:90`, `.github/workflows/e2e.yml:157` |

## Observability

| Signal | Name | Where | Evidence |
|---|---|---|---|
| Check | `Build, lint and unit tests` | CI job | `.github/workflows/ci.yml:41` |
| Check | `E2E Tests with Coverage` | E2E job | `.github/workflows/e2e.yml:93` |
| Check | `compatibilitycheck` | Compatibility job | `.github/workflows/is-compatible.yml:30` |
| Check | `commitlint` and PR title | Message gates | `.github/workflows/commitlint.yml:8` |

## Evidence Index

- `.github/workflows/ci.yml:23` — the path filter
- `.github/workflows/ci.yml:153` — pinned validator image
- `.github/actions/package-plugin/action.yml:168` — archive and sha1 creation
- `.github/workflows/release.yml:7` — tag trigger
- `.github/release-please-config.json:11` — release ownership hand-off
- `package.json:27` — multi-org config swap

## Known Gaps

- Required checks live outside the repository. Forward spec: "Branch protection as code".
- Local validation and CI validation can disagree. Forward spec: "Pinned local validator".
- A workflow-only edit skips E2E. Forward spec: "Unified path filter".
- Commit scopes are documented as enforced but are not. Forward spec: "Scope enforcement".
