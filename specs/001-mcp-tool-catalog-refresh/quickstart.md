# Quickstart: Validate the MCP Tool Catalog Refresh

A validation guide. Implementation detail lives in [plan.md](./plan.md) and `tasks.md`.

---

## Prerequisites

| Item | Check |
|---|---|
| Go 1.26+ | `go version` |
| Node 22 via nvm | `nvm use 22 && node -v` |
| Repo root | `cd ask-o11y-plugin` |
| Branch | `git branch --show-current` prints `001-mcp-tool-catalog-refresh` |
| No edits yet | `git status --short` is clean apart from `specs/` |

---

## Scenario 1 — Unit gate (fast, no network)

```bash
go test ./pkg/mcp/ -run 'TestIsUnknownToolError|TestListAndPublish|TestRefresh|TestCallTool|TestEnrich|TestCacheKey|TestTool|TestListToolsConcurrent' -v
```

**Expected**

| Test | Expected output |
|---|---|
| `TestIsUnknownToolError` | Every table row passes. Wrapped, `-32602`, and plain forms are true. `unauthorized`, `invalid params: missing field`, `connection refused`, and `nil` are false |
| `TestRefreshToolsSingleFlight` | One list call for 8 concurrent refreshes |
| `TestRefreshRateLimit` | Two refreshes inside 30s produce one list call. A refresh after the window produces a second |
| `TestCallToolRetriesOnceAfterRefresh` | 2 call attempts, 1 list call, success returned |
| `TestCallToolDoesNotLoopOnPersistentUnknownTool` | 2 call attempts, 1 list call, error returned with the hint |
| `TestEnrichUnknownToolError` | The hint contains `alerting_rules_read` for `alerting_manage_rules`, capped at 8 names with an `(N more)` tail |
| `TestRefreshFailureKeepsCatalogAndHealth` | Old slice returned, error nil, generation unchanged |
| `TestRefreshRejectsEmptyCatalog` | An empty listing is a failed refresh; the old catalog is kept |

---

## Scenario 2 — Race safety

```bash
go test -race ./pkg/mcp/ -run 'TestListToolsConcurrentWithInvalidate|TestRefreshToolsSingleFlight|TestRefreshWaiterRetriesWithoutSecondList' -count=3
```

**Expected**: no `DATA RACE`, no `WARNING: DATA RACE`, exit code 0.

**Proves**: FR-005 and FR-007 under concurrent `ListToolsWithContext`, `refreshTools`, and `FindToolByName`.

---

## Scenario 3 — Regression gate for untouched paths

```bash
go test ./pkg/... && go vet ./pkg/...
```

**Expected**: all packages pass. `pkg/mcp` includes the pre-existing retry, reconnect, result-cache, selection, health, and OAuth tests. A failure in `TestRetry_*` means the new layer disturbed the transport loop, which FR-003 forbids.

---

## Scenario 4 — OpenAPI exclusion

```bash
go test ./pkg/mcp/ -run 'TestCallToolOpenAPI' -v
```

**Expected**: zero list calls, zero retries, the existing OpenAPI call path returns its normal result.

**Proves**: FR-011 and contract C3.

---

## Scenario 5 — Health stays green through a failed refresh

```bash
go test ./pkg/mcp/ -run 'TestRefreshFailureKeepsCatalogAndHealth|TestHealth' -v
```

**Expected**: `ListTools` returns the cached slice with no error while the transport is down. `recordHealth` records success. The status field is not `Unhealthy` or `Disconnected`. `pkg/mcp/health.go` is unchanged by this feature.

**Proves**: FR-008 and SC-006.

---

## Scenario 6 — Full constitution gate set

```bash
go test ./pkg/...
nvm use 22 && npm run test:ci
nvm use 22 && npm run lint && npm run typecheck
nvm use 22 && npm run build && npm run build:backend
nvm use 22 && npm run validate:openapi
nvm use 22 && npm run validate
```

**Expected**: every command exits 0. `validate` may report the benign findings listed in `constitution.md:131`: unsigned plugin, sponsor link, react-19 jsx-runtime for `@floating-ui/react`. Anything else blocks.

---

## Scenario 7 — Spec drift

```bash
node scripts/verify-retro-specs.mjs
```

**Expected**: exit 0. The summary count rises by the number of new rules. No `evidence line out of range`, no missing tag, no `Last verified` mismatch.

```bash
node scripts/verify-retro-specs.mjs --review
git diff --stat specs/retro/REVIEW.md
```

**Expected**: `REVIEW.md` changes only if a new rule is tagged `ASSUMED` or `GAP`.

---

## Scenario 8 — Live replay of the reported incident (manual)

This is the scenario that motivated the feature. It needs a dev Grafana and a remote MCP server that can change its catalog.

1. Deploy the built plugin to the dev org, as the upgrade in Consensys/w3f-observability PR #768 did.
2. Configure `mcp-grafana` at the old catalog, and confirm `GET /api/mcp/tools` lists `mcp-grafana_alerting_manage_rules`.
3. Upgrade the remote server in place to the new catalog. Do **not** restart Grafana.
4. Run an `alerting` investigation that needs rule data.
5. Open the run's tool calls.

**Expected**

| Observation | Pass condition |
|---|---|
| First `alerting_manage_rules` call | Fails with `unknown tool` |
| Next catalog listing | Contains `alerting_rules_read` |
| Retried call | Succeeds, or the error names `alerting_rules_read` |
| Verdict | Correct. It does not claim the alert is not firing |
| Grafana restart | Not needed |

**Fail conditions**

- The run keeps calling `alerting_manage_rules` with no retry.
- The error text names no replacement.
- The verdict is wrong for the reason described in `spec.md` Context.

---

## Scenario 9 — Log and metric spot check

```bash
kubectl logs deploy/grafana -c grafana --tail=200 | grep -i "catalog\|unknown tool"
```

**Expected**

| Log line | Meaning |
|---|---|
| `mcp catalog refresh failed` with `server` and `error` | FR-004 path taken; the call error is unchanged and the old catalog is served |
| `mcp catalog refreshed` with `server` and `tool_count` | The refresh succeeded and the new catalog was published |
| No repeated refresh for the same server inside 30s | FR-006 holds |

Do not add a new metric. The existing `mcp_tool_call` span keeps `mcp.tool_name` and `mcp.error_kind` (`pkg/agent/loop.go:960-961`).

---

## Done criteria

- [ ] Scenarios 1 through 7 pass.
- [ ] Scenario 8 passes on dev, or its failure is recorded in the PR body.
- [ ] `specs/retro/106-mcp-proxy/spec.md`, `107-mcp-health/spec.md`, and `104-tool-dispatch/spec.md` are updated with new `Last verified` commits.
- [ ] No change to `pkg/plugin/openapi/openapi.json`.
- [ ] One commit: `fix(mcp): refresh the MCP tool catalog after an unknown-tool failure`.
