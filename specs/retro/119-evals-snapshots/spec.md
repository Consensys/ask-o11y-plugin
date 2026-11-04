# Retro-Spec: Evals, Scout, and Snapshot Prefetch

**Capability ID**: `119-evals-snapshots`

**Status**: Retrospective

**Last verified**: `6c09d13`

**Owner**: Ask O11y maintainers

**Module**: `pkg/plugin/agent_eval.go`, `scout.go`, `datasource_snapshot.go`, `metric_namespace_snapshot.go`, `alert_rule_snapshot.go`

---

## Purpose

An operator scores completed agent runs against a fixed rubric.
Scout refreshes the knowledge graph on a schedule without a user.
Snapshot prefetch gives the agent exact identifiers before its first query.

## Actors and RBAC

| Capability | Admin | Editor | Viewer | Evidence |
|---|---|---|---|---|
| List evals (`GET /api/agent/evals`) | yes | yes | yes | `pkg/plugin/plugin.go:1784` (no role check) |
| Run evals (`POST /api/agent/evals/run`) | yes | yes | no (403) | `pkg/plugin/plugin.go:1826` |
| Receive snapshot prefetch on a run | yes | yes | yes | `pkg/plugin/plugin.go:957` |
| Configure the scan interval | yes | no | no | `pkg/plugin/plugin.go:114` (jsonData, Admin AppConfig) |

## Contract

### HTTP endpoints

| Method | Path | Handler | Evidence |
|---|---|---|---|
| GET | `/api/agent/evals` | `handleAgentEvals` | `pkg/plugin/plugin.go:590` |
| POST | `/api/agent/evals/run` | `handleAgentEvalRun` | `pkg/plugin/plugin.go:591` |

### SSE events

None. Evals read stored run traces; runs stream on `/api/agent/runs/`. `VERIFIED` — `pkg/plugin/plugin.go:1858`

### Configuration keys

| Key | Location | Default | Evidence |
|---|---|---|---|
| `agentEvalCaptureEnabled` | plugin jsonData | `false` | `pkg/plugin/plugin.go:132` |
| `graphitiScanInterval` | plugin jsonData | `off` | `pkg/plugin/scout.go:303` |
| `graphitiEpisodeTTLDays` | plugin jsonData | 30 | `pkg/plugin/config.go:72` |

### MCP tool names

| Tool | Read-only | Evidence |
|---|---|---|
| `*_list_datasources` | yes | `pkg/plugin/datasource_snapshot.go:115` |
| `*_list_prometheus_metric_names` | yes | `pkg/plugin/metric_namespace_snapshot.go:242` |
| `*_query_prometheus` (topology snapshot) | yes | `pkg/plugin/topology_snapshot.go:351` |

## Behaviour Rules

Tags: `VERIFIED` (code pointer or test), `ASSUMED` (untested), `GAP` (missing).

1. An eval record carries run ID, status, timestamps, counts, scores, and warnings. `VERIFIED` — `pkg/plugin/agent_eval.go:9`
2. Scores are `evidenceCoverage`, `approvalCompliance`, `finalReportCompleteness`, `rcaQuality`, `hallucinationRisk`, `overall`. `VERIFIED` — `pkg/plugin/agent_eval.go:22`
3. Evidence coverage is 100 at 4+ events, 85 at 3, 70 at 2, 45 at 1, else 0. `VERIFIED` — `pkg/plugin/agent_eval.go:93`
4. Approval compliance is 100 with no approvals, else 100 minus 50 per unresolved approval. `VERIFIED` — `pkg/plugin/agent_eval.go:108`
5. Final-report completeness starts at 45 and adds bonuses for length, confidence, evidence IDs, gaps, next steps, hypotheses, and validation. `VERIFIED` — `pkg/plugin/agent_eval.go:120`
6. RCA quality averages evidence coverage, report completeness, and status. `VERIFIED` — `pkg/plugin/agent_eval.go:62`
7. Hallucination risk is 100 minus the average of coverage and completeness, floored at 80 for a report with zero evidence. `VERIFIED` — `pkg/plugin/agent_eval.go:63`
8. Overall averages the five sub-scores and clamps to 0-100. `VERIFIED` — `pkg/plugin/agent_eval.go:67`
9. GET returns `{enabled: false, evals: []}` when capture is disabled. `VERIFIED` — `pkg/plugin/plugin.go:1789`
10. GET returns only the caller's runs in the caller's org, newest first. `VERIFIED` — `pkg/plugin/runstore.go:247`
11. The GET limit defaults to 20 and clamps to 100. `VERIFIED` — `pkg/plugin/plugin.go:2317`
12. POST returns 404 when capture is disabled. `VERIFIED` — `pkg/plugin/plugin.go:1822`
13. POST rejects a Viewer with 403 and accepts Admin or Editor. `VERIFIED` — `pkg/plugin/plugin.go:1826`
14. POST with `runId` scores one run after an ownership check. `VERIFIED` — `pkg/plugin/plugin.go:1839`
15. POST without `runId` scores up to `limit` of the caller's recent runs. `VERIFIED` — `pkg/plugin/plugin.go:1845`
16. POST returns `{status: "completed", results: [...]}`. `VERIFIED` — `pkg/plugin/plugin.go:1859`
17. Scores are computed per request and never persisted; there is no eval store. `VERIFIED` — `pkg/plugin/agent_eval.go:36`
18. Scout skips a scavenge until org ID, Grafana URL, and Graphiti tools are known. `VERIFIED` — `pkg/plugin/scout.go:152`
19. Scan intervals are 5m, 15m, 30m, 1h, 3h, 12h, 24h; anything else disables discovery. `VERIFIED` — test `TestParseScanInterval`
20. The discovery loop starts only for a valid interval; retention always starts. `VERIFIED` — `pkg/plugin/plugin.go:448`
21. Each scavenge scopes its discovery message to the scan interval. `VERIFIED` — `pkg/plugin/scout.go:274`
22. A scavenge ingests `scout_synthesis` only when the run ends with `done`. `VERIFIED` — `pkg/plugin/scout.go:213`
23. Retention builds communities, then prunes episodes older than the TTL. `VERIFIED` — `pkg/plugin/scout.go:252`
24. The datasource snapshot is synchronous with a 2-second budget and fails open to a warning string. `VERIFIED` — `pkg/plugin/datasource_snapshot.go:94`
25. A datasource snapshot caches 5 minutes; the fail-open text caches 30 seconds. `VERIFIED` — test `TestDatasourceCache_FailOpenTTL`
26. The datasource snapshot renders at most 40 entries and evicts the oldest org beyond 256. `VERIFIED` — test `TestDatasourceCache_EvictsOldestOverMax`
27. The metric-namespace snapshot never blocks: a miss returns empty and refreshes in the background, deduplicated per org. `VERIFIED` — test `TestMetricNamespaceSnapshot_DedupesConcurrentRefreshes`
28. Metric namespaces cache for one hour, fetch up to 5,000 names per datasource, and render 40 prefixes. `VERIFIED` — `pkg/plugin/metric_namespace_snapshot.go:19`
29. The alert-rule snapshot has a 5-second budget, 90-second hit TTL, and 30-second miss TTL. `VERIFIED` — `pkg/plugin/alert_rule_snapshot.go:37`
30. The alert-rule snapshot renders at most 3 rules from at most 8 datasources. `VERIFIED` — `pkg/plugin/alert_rule_snapshot.go:49`
31. The alert-rule prefetch runs only when the alert name is extractable from the message. `VERIFIED` — `pkg/plugin/plugin.go:973`
32. Every snapshot fails open: an empty result renders no prompt block and the run continues. `VERIFIED` — `pkg/plugin/alert_rule_snapshot.go:29`

## Invariants

- An eval never mutates a run. `VERIFIED` — `pkg/plugin/agent_eval.go:36`
- A run is visible only to its owner in its own org. `VERIFIED` — `pkg/plugin/plugin.go:1341`
- No prefetch can fail a run. `VERIFIED` — `pkg/plugin/datasource_snapshot.go:96`

## Failure Modes

| Condition | User-visible result | Evidence |
|---|---|---|
| Capture disabled | GET `enabled: false`; POST 404 | `pkg/plugin/plugin.go:1821` |
| Viewer calls eval run | HTTP 403 `Access denied` | `pkg/plugin/plugin.go:1826` |
| Run not owned | HTTP 403 `Access denied` | `pkg/plugin/plugin.go:1342` |
| Run list fails | HTTP 500 `Failed to list agent evals` | `pkg/plugin/plugin.go:1801` |
| `list_datasources` times out | Fail-open warning block in prompt | `pkg/plugin/datasource_snapshot.go:95` |
| Scavenge fails | Run skipped; warning logged | `pkg/plugin/scout.go:214` |

## Data and Persistence

| Store | Key or table | TTL | Fallback | Evidence |
|---|---|---|---|---|
| Run store (Redis) | run, events, index keys | 1 hour | in-memory | `pkg/plugin/runstore_redis.go:617` |
| Datasource cache | `dsCache[orgID]` | 5 min / 30 s fail-open | warning text | `pkg/plugin/datasource_snapshot.go:15` |
| Metric namespace cache | `msCache[orgID]` | 1 hour | empty string | `pkg/plugin/metric_namespace_snapshot.go:19` |
| Alert rule cache | `orgID + alertName` | 90 s / 30 s miss | no block | `pkg/plugin/alert_rule_snapshot.go:41` |

## Observability

| Signal | Name | Where | Evidence |
|---|---|---|---|
| Log | `datasourceSnapshot: timeout calling list_datasources` | plugin backend log | `pkg/plugin/datasource_snapshot.go:95` |
| Log | `Scout scavenge completed` | plugin backend log | `pkg/plugin/scout.go:229` |
| Span / metric | none | — | `GAP` — no eval score, prefetch latency, or scout counter |

## Evidence Index

- `pkg/plugin/agent_eval_test.go` — `TestScoreAgentRunRewardsEvidenceAndFinalReport`
- `pkg/plugin/agent_eval_test.go` — `TestHandleAgentEvalsReturnsRecentRunScores`
- `pkg/plugin/alert_rule_snapshot_test.go` — `TestAlertRuleSnapshotCache`

## Known Gaps

- No eval score is persisted; a run older than the run TTL cannot be scored.
- Scout has no lock against overlapping scavenges when a run exceeds the interval.
- Prefetch has no metric, so its latency and timeout rate are invisible.
