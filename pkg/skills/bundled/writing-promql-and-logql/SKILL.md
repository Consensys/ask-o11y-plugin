---
name: writing-promql-and-logql
license: Apache-2.0
description: >-
  Writes efficient PromQL for Prometheus/Mimir metrics and LogQL for Loki
  logs, including label discovery for unfamiliar clusters. Use when the user
  asks for queries, graph data, metric analysis, or log searches, or before
  building panel or alert queries — even when they say "error rate", "p99",
  "how many errors", "log query", or "show me latency" without naming a
  query language.
metadata:
  version: "1.1"
---

## Golden rules

- `rate()` / `increase()` need a range vector at least 4x the scrape interval — 60s scrape means `[5m]` minimum
- `rate()` first, then aggregate — never `sum()` a raw counter and then `rate()` it
- Keep `le` in the inner aggregation of `histogram_quantile` or the result is NaN
- Guard ratios against divide-by-zero: `sum(rate(errs[5m])) / (sum(rate(reqs[5m])) > 0)`
- Use label matchers to cut cardinality; start with short time ranges and expand

## PromQL

See [references/promql.md](references/promql.md) for the full pattern library — counters, gauges, histograms, ratios, absence and staleness (`absent`, `changes`), offsets and `predict_linear`, recording rules, SLO burn-rate math, and cardinality investigation queries.

## LogQL

- Start with label filters, add line filters second, parse last

See [references/logql.md](references/logql.md) for the full guide, including the label-discovery workflow for unfamiliar clusters, the parser matrix (`json`, `logfmt`, `pattern`, `regexp`, `unpack`), `label_format`, metrics-from-logs, and unwrapped range aggregations such as `quantile_over_time` over unwrapped durations.

## Discovering the schema first

For an unfamiliar datasource, run label/metric discovery tools before writing queries — never guess label names or metric names. Verify values exist before filtering on them.

## Choosing signal

Prefer the cheapest signal that answers the question: metrics for trends and aggregates, logs for events and errors, traces for request-level latency and causality. Do not query all three when one answers the question directly.
