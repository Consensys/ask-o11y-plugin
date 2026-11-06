---
name: building-dashboards
license: Apache-2.0
description: >-
  Creates and updates Grafana dashboards panel by panel through the
  dashboard MCP tools, with correct panel types, units, thresholds, and
  template variables, and verifies that every panel query runs before
  claiming success. Use when the user asks to build, create, modify, fix, or
  extend a dashboard — even when they say "add a panel", "make a chart",
  "dashboard for this service", "this dashboard is broken", or "visualize
  this metric" without saying dashboard.
metadata:
  version: "1.2"
---

## Dashboard creation workflow

**Always create dashboards step by step** — never generate a single large dashboard JSON with many panels in one call. Large payloads often exceed size limits and fail silently.

1. **First**: Create an empty dashboard (minimal JSON: title, optional folder UID, empty or minimal `panels` array).
2. **Then**: Add panels iteratively — use the update dashboard tool to add one or a few panels at a time (e.g., add a row or 1–2 panels per call).
3. **If the user wants many panels**: Create the shell, then add panels in small batches until the dashboard is complete.

This keeps each tool call payload small and reliable.

**Panel queries** — Prefer label matchers and aggregation in PromQL so panels stay fast; set sensible time ranges per panel. When unsure which metric names exist, run the metric-name listing tool with a targeted regex before writing panel queries. Never invent metric names, label names, or recording-rule prefixes: confirm each one exists, or the panel fails with `bad_data`.

## Before you update an existing dashboard

Read the current object first with `get_dashboard_by_uid`. Record `uid`, `title`, `folderUid`, `schemaVersion`, and the panel IDs. Then:

- Keep `uid`, `folderUid`, `title`, and panel IDs unchanged unless the user asks for a change.
- **Never delete, recreate, move, or re-save in another schema to escape a permission error.** That loses folder placement and user permissions. Recreate only when the user asks.
- If the save changes `folderUid` or `schemaVersion`, revert the save and report the change. Do not continue.
- Copy query patterns from a dashboard that is known to work when one exists, instead of writing a new variant.

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

## Verify before you claim success

A saved version is not a working dashboard. After each write, run these checks. Report the result of each one.

1. **Read back the object.** `get_dashboard_by_uid`: confirm `uid`, `title`, `folderUid`, and `schemaVersion` match the intended state.
2. **Check every datasource.** Each panel's `datasource.uid` must exist in the datasource list. A panel with a missing UID renders blank.
3. **Run every panel query.** Execute the panel's query through its datasource, over the dashboard's default time range. The version fails if any query returns a parse error (`bad_data`, `invalid parameter "query"`), an unknown metric, or an empty series where data must exist. Fix the failing query, then re-run the check.
4. **Name the URL you verified.** Give the exact dashboard link. If the user reports `403`, the save path or schema is wrong — report that as a permission defect, not as a successful fix.
5. **Claim only what passed.** Do not write "✅", "fixed", or "should now work" when a check failed, was skipped, or returned an error. State the failed check, the evidence, and the next change.

An update is complete only when all of steps 1–3 pass, or when the remaining failure needs user action (missing permission, missing datasource, missing data).

## Stop rule

Two failed fix cycles mean the hypothesis is wrong, not the wording.

1. Fetch the live dashboard JSON.
2. Run the exact failing query and show the raw result.
3. Name one root cause with evidence.
4. Change only that cause.

If the user reports the same error after a fix, do not write another version on a guess. Do not tell the user the dashboard is fixed without a new passing check from the current turn.
