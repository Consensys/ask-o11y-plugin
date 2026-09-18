---
name: building-dashboards
license: Apache-2.0
description: >-
  Creates and updates Grafana dashboards panel by panel through the
  dashboard MCP tools, with correct panel types, units, thresholds, and
  template variables. Use when the user asks to build, create, modify, or
  extend a dashboard — even when they say "add a panel", "make a chart",
  "dashboard for this service", or "visualize this metric" without saying
  dashboard.
metadata:
  version: "1.1"
---

## Dashboard creation workflow

**Always create dashboards step by step** — never generate a single large dashboard JSON with many panels in one call. Large payloads often exceed size limits and fail silently.

1. **First**: Create an empty dashboard (minimal JSON: title, optional folder UID, empty or minimal `panels` array).
2. **Then**: Add panels iteratively — use the update dashboard tool to add one or a few panels at a time (e.g., add a row or 1–2 panels per call).
3. **If the user wants many panels**: Create the shell, then add panels in small batches until the dashboard is complete.

This keeps each tool call payload small and reliable.

**Panel queries** — Prefer label matchers and aggregation in PromQL so panels stay fast; set sensible time ranges per panel. When unsure which metric names exist, run the metric-name listing tool with a targeted regex before writing panel queries.

## Panel type selection

| Data shape | Panel type |
|---|---|
| Metric over time | `timeseries` |
| Single value (+ trend) | `stat` |
| Value against min/max | `gauge` |
| Comparison across items | `barchart` / `bar gauge` |
| Multi-column rows | `table` |
| Distribution over time | `heatmap` |
| Histogram of one window | `histogram` |
| Part of a whole | `piechart` |
| Log streams | `logs` |
| Trace results | `traces` |

## Panel JSON essentials

- `gridPos` is a 24-column grid (full=24, half=12, third=8) with height ≈ 30px per unit
- Set `fieldConfig.defaults.unit` (`reqps`, `percentunit`, `bytes`, `ms`, `short`) or numbers render raw
- Thresholds: green/yellow/red `steps` with the first step at `value: null`
- `legendFormat` names series readably; substitute label values with `${__field.labels.instance}`-style placeholders
- Template variables: `{ "name":"job", "type":"query", "query":{"query":"label_values(up, job)"}, "refresh":2, "includeAll":true, "multi":true }` — chained variables refine the next dropdown

See [references/dashboard-json.md](references/dashboard-json.md) for the full schema — panel JSON, units table, variables, transformations (e.g. an "Error %" `calculateField`), data links, and deploy annotations.

## Verify after every update

After each create/update call, confirm success from the tool response (updated version number / saved state), and after the final panel re-read the dashboard and confirm the panel count and titles. A silent failure leaves the user with a stale dashboard.
