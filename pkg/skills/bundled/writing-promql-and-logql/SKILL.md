---
name: writing-promql-and-logql
description: >-
  Writes efficient PromQL for Prometheus/Mimir metrics and LogQL for Loki
  logs, including label discovery for unfamiliar clusters. Use when the user
  asks for queries, graph data, metric analysis, or log searches, or before
  building panel or alert queries.
metadata:
  version: "1.0"
---

## PromQL

- Use `rate()` for counters, never raw counter values
- Aggregate before `rate()` for efficiency
- Use label matchers to reduce cardinality
- Start with short time ranges, expand if needed

See [references/promql.md](references/promql.md) for the full guide — counter, gauge, and histogram patterns, aggregation pitfalls, and worked examples.

## LogQL

- Start with label filters, add line filters second
- Use JSON parsing only when needed

See [references/logql.md](references/logql.md) for the full guide, including the label-discovery workflow for unfamiliar clusters.

## Choosing signal

Prefer the cheapest signal that answers the question: metrics for trends and aggregates, logs for events and errors, traces for request-level latency and causality. Do not query all three when one answers the question directly.
