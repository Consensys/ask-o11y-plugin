---
name: querying-profiles
description: >-
  Analyzes continuous profiling data — CPU, memory, goroutines, block and
  mutex contention — from Grafana Pyroscope datasources to find the hottest
  code paths and leak suspects. Use when the user asks about flame graphs,
  CPU or memory hot spots, profiling, or which functions consume the most
  resources.
metadata:
  version: "1.0"
---

## Profiling analysis workflow

**Discover the datasource and profile types first** — never guess:

1. List datasources once to find the Pyroscope datasource UID; reuse it for every call.
2. Call `list_pyroscope_profile_types` with the datasource UID — the returned values (e.g., `process_cpu:cpu:nanoseconds:cpu:nanoseconds`, `memory:alloc_space:bytes`) are the exact `profile_type` values to query.
3. Narrow the scope with `list_pyroscope_label_names` / `list_pyroscope_label_values` (e.g., `service_name`) before filtering; verify that values exist before matching on them.

## Querying profiles

Call `query_pyroscope` with:

- `data_source_uid` and `profile_type` (required — from the discovery steps above)
- `matchers` — Prometheus-style matchers, e.g. `{service_name="checkout"}`
- `query_type`: `both` (default) returns the profile table **and** metrics series; `metrics` gives time-series only; `profile` gives the profile only
- `format`: `table` (default) ranks functions by flat (self) and cumulative cost; `dot` returns a call graph for parent→child relationships
- `group_by` — labels to group metrics series by (e.g., `["service_name"]`)
- `start_rfc_3339` / `end_rfc_3339` — window of interest (e.g., `now-1h`, `now`)
- `max_node_depth` — caps the table/call-graph size (default 100)

## Interpreting results

- **High flat cost** — the function itself is the hot spot; optimization there pays off directly.
- **High cumulative but low flat** — the cost is in its callees; expand with `format: "dot"` to find the responsible child.
- **Memory profiles** — `alloc_space` growth combined with rising process memory points at allocation hot spots; compare two windows (before/after a deploy) rather than a single snapshot.
- **Correlate with metrics** — pair profile findings with the service's CPU/memory/latency metrics in the same window to confirm impact before recommending changes.

**Final answer shape** — Name the top consuming functions with their flat/cumulative values, the suspected cause, and one verification step.
