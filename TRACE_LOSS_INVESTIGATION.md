# Ask-O11y Trace Loss — Investigation Report

**Date:** 2026-09-08 · **Scope:** run traces from ask-o11y sessions vanishing between the plugin and Tempo
**Clusters:** traces emitted in `w3f-o11y-prod-us` → Alloy tail sampler → meta Tempo (`w3f-o11y-prod-us-meta`, ns `tempo`, monolithic ×3, tenant `o11y`)

## What we were chasing
Complete ask-o11y session traces (grafana-frontend → agent_run → mcp_tool_call → mcp-grafana → grafana core) missing from Tempo, while tiny traces from the same seconds were always queryable.

## Root causes found & fixed (layer by layer)

| # | Layer | Problem | Fix | Status |
|---|---|---|---|---|
| 1 | **mcp-grafana** | No OTel export at all — zero spans emitted | Added `OTEL_EXPORTER_OTLP_ENDPOINT` (Alloy receiver) + `OTEL_SERVICE_NAME`; image → 1.3.0 (≥1.2.0 needed for inbound `traceparent`, [#1084](https://github.com/grafana/mcp-grafana/pull/1084)) | ✅ PR #638, deployed, verified |
| 2 | **asko11y plugin** | MCP calls sent no `traceparent` → mcp-grafana rooted every call as a disjoint trace | Trace propagation transport on the MCP client chain ([plugin PR #212](https://github.com/Consensys/ask-o11y-plugin/pull/212), v0.3.13/14) — verified: 3-service stitched traces | ✅ deployed |
| 3 | **asko11y plugin** | CallTool context rebuilt by `mergeUserCtx` dropped the caller's span → traceparent injection was a no-op (Bugbot HIGH) | Caller SpanContext re-attached via `WithCallerSpanContext` | ✅ in v0.3.14 |
| 4 | **Traefik ingress** | `body-limit-5m` middleware rejected multi-MB OTLP pushes with 413 (verified by size ladder: 4MB=200, 6MB=413) — decided run traces export as multi-MB pushes | Limit raised to 25MB, middleware renamed `body-limit-25m` (PR #638) | ✅ merged, deployed |
| 5 | **Tail sampler** | `decision_wait=60s` with **no decision cache** → spans arriving after the decision were dropped, truncating run traces at ~21–55s | `decisionWait: 300s` + `decisionCache` (100k/100k) (PR #637) | ✅ deployed |
| 6 | **Sampler stale config** | The 13:14 reload had loaded a pre-#637 config (60s, no cache) — the 300s config never actually ran until the StatefulSet was bounced | Restarted both pods; 300s + cache verified in the running config | ✅ fixed 15:04 |

## Verified working end-to-end
- Session-open traces stitched across **3 services** (`grafana` → `consensys-asko11y-app` → `mcp-grafana`) — served 200 by Tempo
- Access-log traceID continuous across the run POST and every LLM inference call (grafana core ↔ grafana-llm-app)
- 6MB/8MB pushes accepted (413 gone)
- Plugin v0.3.14 + mcp-grafana 1.3.0 + sampler 300s/cache + grafana 8Gi all live and verified

## The one remaining blocker
**Complete run traces are accepted by the meta Tempo, then silently never become queryable.** Reproduced across 6 controlled sessions (0.3.13/0.3.14, mcp-grafana 1.0.0/1.3.0):

- Run trace by-ID: **404 on all three Tempo pods**, 10–40+ min post-run
  (`8aa90396d50da52784151992c93b454f`, `16ea212516edcf6f6f3e841ab501e550`, `38bdb6729ec4fce18a18602a7d41a90b`, `8e290a5dc773505bd5063c91b3911b6e`)
- Search (`agent_run`, `llm_call`, `tools/call`, `session_id`): **0**
- Simultaneously, **small traces from the same seconds are served normally** (200, stitched)
- Sampler: sampled + **sent successfully** (no failed-span delta beyond the explained 14:03 transient), ~190 spans/s flowing
- Tempo: `tempo_discarded_spans_total` all **zero** (live_traces_exceeded / trace_too_large / rate_limited / unknown_error), logs clean at info

## Key evidence
- Trace `5e35fddf…` (session-open, 10:27) **grew 3 → 517 spans** over hours — Tempo merges late-arriving spans into existing traces, so the merge path works
- Landed run traces are **truncated at the old decision boundary** (21s / 55s for multi-minute runs) — confirming the decision-window drop mechanism
- Sampler-1 failure counter delta (+2,597) matches exactly the 4× 404 drops at 14:03:40–43 during the middleware-rename Argo sync (transient, recovered)
- Access-log traceIDs (`8e290a5d…`, `5fc07590…`) prove grafana core ↔ grafana-llm-app continuity

## Handoff for the Tempo team
- Tenant `o11y`, monolithic Tempo 2.10.1 ×3 (ns `tempo`, meta cluster), ingester `max_block_bytes: 1MB`, `max_block_duration: 5m`, `complete_block_timeout: 15m`
- OTLP ingest via Traefik (`tempo-meta.o11y-private.web3factory.consensys.net`, body-limit now 25MB)
- Missing trace IDs to hunt: `8aa90396d50da52784151992c93b454f`, `16ea212516edcf6f6f3e841ab501e550`, `38bdb6729ec4fce18a18602a7d41a90b`, `8e290a5dc773505bd5063c91b3911b6e`
- **Decisive next step:** live-tail tempo-0/1/2 at debug **during** a run's +300s export moment and watch the ingester accept/reject the push; also check the Traefik access logs for 413/429 on `/otlp/v1/traces` (Traefik tier is not reachable from the checked kubeconfigs)

## Notes
- Debug logging (`-log.level=debug`) is currently **enabled** on tempo-0/1/2 for the investigation — revert with `-log.level=info` after
- Test sessions created during verification (safe to ignore/delete): `6bKYvkrj…`, `Zj81F-oP…`, `bq9a4wtE…`, `yEz53nVU…`, `HdsAKdxV…`, `-WshLjXk…`, `8tvopJcn…`
- Reference PRs: [ask-o11y-plugin #209](https://github.com/Consensys/ask-o11y-plugin/pull/209), [#212](https://github.com/Consensys/ask-o11y-plugin/pull/212), [#214](https://github.com/Consensys/ask-o11y-plugin/pull/214), [w3f-observability #635](https://github.com/Consensys/w3f-observability/pull/635), [#637](https://github.com/Consensys/w3f-observability/pull/637), [#638](https://github.com/Consensys/w3f-observability/pull/638)

---

# Tempo team findings — 2026-09-08 evening (post-handoff)

## Headline: the "missing" traces were never missing — they are in storage but the read path returns them EMPTY

All 4 "missing" trace IDs **plus** a fresh controlled run (`88bee15bccebc374c8474ac650028070`, triggered via gcx/mmcx at 18:10Z, 2.5-min multi-tool run) now return:

```
200 {"trace":{},"metrics":{"inspectedBytes":"4219876"}}   ← run trace (4.2MB inspected)
```
from **all three pods**, and each of the 4 original IDs returns 200-empty with 2.4–8.6MB inspected. The bloom filter + column index + row-group bytes for these trace IDs are present and scanned — the trace data was ingested and flushed — but `findTraceByID` reconstructs **zero spans** with **no error** (`tempodb.go:398 found=true` → `block_findtracebyid.go` returns nil trace, nil err → `TraceByIDResponse{Trace: nil, Metrics: {InspectedBytes}}` → frontend's `TraceByIDCombiner` substitutes an empty trace → 200). The earlier "404 on all three pods" was this same empty result (rendered as 404 by whatever endpoint/path was used at the time).

## Ruled out (with live evidence)

| # | Suspect | Evidence |
|---|---|---|
| 1 | Traefik tier | **Reachable after all** — Traefik runs as `deploy/traefik` in ns `ingress-nginx` (meta cluster). Access log (`accesslog=true`, filters 200-599) shows every `/otlp/v1/traces` push as **200**, zero 413/429. Note: path is externally `/otlp/v1/traces` but the `replace-path-otlp` middleware rewrites to **`/v1/traces`** (Tempo 2.10.1 serves the stock collector receiver). Log retention only ~30s (high traffic) — archaeology impossible, live-tail worked. |
| 2 | Alloy sampler | Since 15:05 restart: receiver refused/failed = **0**, exporter send_failed = **0**, dropped_too_early = **0**, 9.8k traces in memory (cap 100k), asko11y policy sampled 789 traces, 1,564 early-releases via decision cache (PR #637 working). |
| 3 | Tempo OTLP ingest | Direct size-ladder (synthetic single traces pushed straight to tempo-0:4318): **1–12MB all land, immediately queryable, still queryable hours later**. 20MB → clean visible 400 "http: request body too large" (collector `confighttp` default `max_request_body_size` = 20MiB). **No silent-loss zone on direct ingest.** |
| 4 | Ingester `max_bytes_per_trace` (default 5MB, overrides.yaml is empty `{}`) | Active per `tempo_limits_defaults{max_bytes_per_trace}=5e+06` but **NOT enforced at the ingester write path** — a 12MB single-push trace and a 3×2MB cumulative multi-push trace both stored fully. Enforcement is asymmetric across components (querier/frontend/compactor read it; ingester write path doesn't bite). |
| 5 | Compactor "Trace too large to compact" (keep rows[0], discard rest — the code that would explain the 21s/55s truncation pattern) | **Never fired**: zero `max size of trace exceeded` warn logs on any pod since the 15:04 restart, zero discard counters (reason `compactor_discarded_spans` series never created). |
| 6 | Discard counters | All `tempo_discarded_spans_total` = 0 — but note the 15:0x pod restarts **reset** these counters, so the original report's "all zero" observations after 15:04 say nothing about the earlier session windows. |

## Live config facts (meta cluster, ns tempo)

- **Ring anomaly**: all 3 ingesters register at **`127.0.0.1:9095`**. Distributors accidentally write to their own pod's ingester (works), but **querier live-trace lookups resolve 127.0.0.1 = the local pod only** — live traces held by another pod's ingester are invisible until their blocks flush to S3. The compactor ring, meanwhile, sees real pod IPs (`owning_addr=10.20.32.240` vs `this_addr=10.20.86.161`). This makes by-ID results eventually-consistent and pod-dependent in the minutes after a run.
- Cut→flush cadence is far faster than the config suggests (`max_block_bytes: 1MB`, `max_block_duration: 5m`, `complete_block_timeout: 15m`): blocks cut ~every 30s and flush within seconds. A multi-minute run trace therefore lands as **multiple rows across multiple blocks**.
- Fresh controlled run reproduced the blocker with the current stack (plugin 0.3.14, mcp-grafana 1.3.0, sampler 300s+cache, body-limit-25m) — so this is **not** an artifact of the pre-15:04 misconfig era.

## The one remaining question

Why does `findTraceByID` return nil for these rows? Either:
(a) the row-group iterator can't find the trace-ID row that bloom+index point at (index/data mismatch), or
(b) the row exists but is a span-less **stub row** and `ParquetTraceToTempopbTrace` returns nil for it.

**Decisive next step:** S3 block forensics on the block(s) holding `88bee15b…` (start with `7acf7c79-d654-4270-875f-8bebc4120b64`) using `tempo-cli` built from the v2.10.1 tag (source already cloned; go 1.26 present; AWS needs the correct SSO profile from the kubeconfig authinfo — the default profile is broken). If the row is a stub, walk the ingester flush path (`wal_block.go` → `CompleteBlock`) for where a >1MB-per-row trace can lose its spans at flush time — the `max_block_bytes: 1MB` interaction with multi-MB single rows is the prime suspect.

## Artifacts from tonight (tenant `o11y`, 7d retention — safe to ignore/delete)

- `service.name=ladder-test` synthetic traces: ~10 traces, 1–20MB single-span (`blob` attribute), plus `150e46a0157cbcf975d84778688aecf6` (3×2MB same-ID fragments — note its by-ID result fluctuated 3→1→3 spans / 4.2MB→70MB inspected over ~40min, i.e. searchability is eventually consistent; don't treat early empty/partial results as final)
- gcx/mmcx-triggered session `Nf9L3HkSQkHe7c2f0VZYBEy6X_OFg0LlxiHB7-C-Ykk`, run `bLOb9vCu12JvEi7…`, trace `88bee15bccebc374c8474ac650028070`
- Live-capture bundle (logs + 10s metric snapshots, 18:07–18:3xZ): `/var/folders/wd/qfwb5s5n3lg00jg9m3p947vc0000gn/T/opencode/capture/` — stop any lingering `capture.sh` with `touch …/capture/STOP`
