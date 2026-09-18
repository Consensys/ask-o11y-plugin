---
name: analyzing-traces
license: Apache-2.0
description: >-
  Analyzes distributed traces in Tempo with TraceQL — errors, latency, and
  call paths between services. Use when the user asks about traces, spans,
  request flows, service dependencies, latency across services, or debugging
  "no traces showing" — even when they say "find slow requests", "what called
  this", or "show the service graph" without naming TraceQL.
metadata:
  version: "1.1"
---

## Trace analysis workflow

1. **Discover the schema first** — List available trace attribute names and values with the trace attribute tools before constructing TraceQL queries; never guess attribute names.
2. **Scope by service** — Anchor queries on `resource.service.name` for the affected services; add narrow attribute filters from there.
3. **Pick the slice** — Error traces (`status=error`), slow traces (`duration > 1s`), or a specific route/operation — one hypothesis per query.
4. **Bound the search** — Always pass explicit time bounds on search to limit scope; add `with(most_recent=true)` when you need deterministic recent results.

## TraceQL quick reference

**Attribute scopes and intrinsics:**
- `resource.*` for resource attributes (e.g., `resource.service.name`, `resource.deployment.environment`)
- `span.*` for span attributes (e.g., `span.http.method`, `span.db.statement`)
- `event.*` for events
- Intrinsics: `name`, `status` (ok/error/unset), `duration`, `kind` (server/client/producer/consumer/internal), `traceDuration`, `rootServiceName`, `rootName`

**Structural operators (root-cause patterns):**
- `{ kind = server } >> { status = error }` — server span with a downstream error (descendant)
- `{ span.db.system = "redis" } && { span.db.system = "postgresql" }` — both present anywhere in the trace
- `{ !resource.service.name="healthcheck" }` — NOT

**Pipelines and metrics:**
- `{ status = error } | count() >= 2` — traces with at least two error spans
- `{ status = error } | rate() by (resource.service.name)` — error rate per service (metrics from traces)
- `{ kind = server } | quantile_over_time(duration, .99) by (resource.service.name)` — p99 latency
- `{ status = error } | select(span.http.url, duration)` — project specific fields

See [references/traceql.md](references/traceql.md) for the full cheat sheet — scopes, operators, structural queries, and metric functions.

## Interpreting results

For each matching trace, report the slowest or failing spans and their downstream calls; correlate timing with metrics spikes and log lines for the same window before concluding. Structural queries (`>>`, `&&`) are the fastest way to separate "this service failed" from "this service observed a downstream failure".
