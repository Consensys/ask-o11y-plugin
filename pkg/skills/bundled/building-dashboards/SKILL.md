---
name: building-dashboards
description: >-
  Creates and updates Grafana dashboards panel by panel through the
  dashboard MCP tools. Use when the user asks to build, create, or modify a
  dashboard.
metadata:
  version: "1.0"
---

## Dashboard creation workflow

**Always create dashboards step by step** — never generate a single large dashboard JSON with many panels in one call. Large payloads often exceed size limits and fail silently.

1. **First**: Create an empty dashboard (minimal JSON: title, optional folder UID, empty or minimal `panels` array).
2. **Then**: Add panels iteratively — use the update dashboard tool to add one or a few panels at a time (e.g., add a row or 1–2 panels per call).
3. **If the user wants many panels**: Create the shell, then add panels in small batches until the dashboard is complete.

This keeps each tool call payload small and reliable.

**Panel queries** — Prefer label matchers and aggregation in PromQL so panels stay fast; set sensible time ranges per panel. When unsure which metric names exist, run the metric-name listing tool with a targeted regex before writing panel queries.
