---
name: analyzing-traces
description: >-
  Analyzes distributed traces in Tempo with TraceQL — errors, latency, and
  call paths between services. Use when the user asks about traces, spans,
  request flows, service dependencies, or latency across services.
metadata:
  version: "1.0"
---

## Trace analysis workflow

1. **Discover the schema first** — Discover available attribute names and values with the trace attribute listing tools before constructing TraceQL queries; use attribute discovery to find the exact schema before filtering.
2. **Scope by service** — Anchor queries on `resource.service.name` for the affected services; add narrow attribute filters from there.
3. **Pick the slice** — Error traces (`status=error`), slow traces (`duration > 1s`), or a specific route/operation — one hypothesis per query.

## TraceQL quick reference

**Basic attributes:**
- Use `resource.*` for resource attributes (e.g., `resource.service.name`, `resource.deployment.environment`)
- Use `span.*` for span attributes (e.g., `span.http.method`, `span.db.statement`)
- Filter by `status` (ok, error, unset) to find errors: `{status=error}`
- Filter by `duration` to find slow traces: `{duration > 1s}`

**Structural queries:**
- Use `&&` for AND conditions: `{resource.service.name="api" && duration > 500ms}`
- Use `||` for OR conditions: `{status=error || duration > 2s}`
- Use `!` for NOT: `{!resource.service.name="healthcheck"}`

**Interpreting results** — For each matching trace, report the slowest or failing spans and their downstream calls; correlate timing with metrics spikes and log lines for the same window before concluding.
