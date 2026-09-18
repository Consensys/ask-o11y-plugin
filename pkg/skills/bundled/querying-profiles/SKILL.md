---
name: querying-profiles
license: Apache-2.0
description: >-
  Queries continuous profiling data in Pyroscope to find CPU, memory, and
  contention hotspots. Use when the user asks what is burning CPU, causing
  high memory, allocations, goroutine leaks, lock contention, or asks for a
  flame graph — even when they say "why is memory so high", "profile this
  service", or "find the hotspot" without naming Pyroscope.
metadata:
  version: "1.1"
---

## Profile query workflow

1. **Identify the datasource UID** — every Pyroscope tool requires `data_source_uid` (the plugin's configured Pyroscope datasource).
2. **Discover profile types** — List available profile types with `list_pyroscope_profile_types` to confirm what this instance collects (CPU, memory, goroutines, mutex, block).
3. **Discover labels and values** — Use label discovery tools to enumerate label names (`service_name`, `env`, `namespace`, ...) and verify concrete values exist before filtering.
4. **Run the profile query** — Call `query_pyroscope` with:
   - `profile_type` — confirmed in step 2
   - `matchers` — label selectors, e.g. `{service_name="payments", env="prod"}` (comma-separated `key="value"` pairs inside braces)
   - `query_type` — `profile` (flamegraph data), `metrics` (time-series of the same profile), or `both` (default; one call, complete analysis)
   - `format` — `table` (default) for the per-function flat/cumulative table, or `dot` for a Graphviz call graph
   - `group_by` — labels to group the `metrics` series by (e.g. `service_name`)
5. **Read the flame graph** — flat (self) vs cumulative interpretation below.
6. **Compare windows** — for regressions, diff the same profile type before/after a deploy or peak vs baseline; deltas localize the offending function.

## Profile types and symptoms

| Symptom | Profile type |
|---|---|
| High CPU | `process_cpu:cpu:nanoseconds:cpu:nanoseconds` |
| OOM / memory growth | `memory:inuse_space:bytes:space:bytes` |
| GC pressure / allocation churn | `memory:alloc_space:bytes:space:bytes` |
| Hung/slow goroutines | `goroutine:goroutine:count::` |
| Lock contention | `mutex:contentions:count::` |

See [references/profile-types.md](references/profile-types.md) for the full taxonomy, symptom→type mapping, and flame-graph reading guide.

## Interpreting results

- Flat time = time in the function itself; cumulative includes callees
- Wide flat blocks at branch tips are where work happens; wide low blocks are subtrees to zoom into
- High latency with a flat CPU flame graph means waiting (I/O, locks), not computing — switch to `mutex`/`block` profiles or correlate with traces

## Correlation

Pair profiling evidence with metrics (CPU/memory panels for the same window) and traces (slow spans in the same timeframe) before naming a culprit; a hotspot that appears in profiles but not in production traffic may be an artifact of sampling rate.
