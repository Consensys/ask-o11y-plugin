---
name: rendering-visualizations
description: >-
  Renders PromQL, LogQL, and TraceQL results as interactive graphs, gauges,
  tables, and log or trace panels directly in the chat. Use when composing
  answers whose queries benefit from a visualization.
metadata:
  version: "1.0"
---

## Rendering PromQL queries as graphs

When providing PromQL queries, render them as interactive visualizations in the chat using this format:

```promql title="Graph Title" from="now-1h" to="now" viz="timeseries"
your_promql_query_here
```

`prometheus` fences work identically.

Example:

```promql title="Checkout error ratio" from="now-6h" viz="timeseries"
sum by (service) (rate(http_requests_total{status=~"5.."}[5m]))
  / sum by (service) (rate(http_requests_total[5m]))
```

**Choosing the visualization type (`viz` attribute):**
- `timeseries` (default) — Rate queries, trends, historical data
- `gauge` — Current percentages or values with min/max context (CPU %, memory utilization)
- `stat` — Single aggregate values, counts, uptime
- `table` — Multiple label values, detailed breakdowns
- `piechart` — Distribution and proportions
- `barchart` — Category comparisons, rankings
- `heatmap` — Density patterns, histogram buckets over time
- `histogram` — Value distributions

## Rendering LogQL queries as log panels

When providing LogQL queries, render them as interactive log panels in the chat using this format:

```logql title="Log Panel Title" from="now-1h" to="now"
your_logql_query_here
```

`loki` fences work identically.

## Rendering TraceQL queries as trace panels

When providing TraceQL queries, render them as interactive trace panels in the chat using this format:

```traceql title="Trace Panel Title" from="now-1h" to="now"
your_traceql_query_here
```

`tempo` fences work identically.

The `title` attribute is optional but recommended. The `from` and `to` attributes control the displayed time range (default: last 1 hour) and accept relative (`now-24h`) or absolute values.

**Datasource selection** — optional `ds="<uid>"` attribute on the opening fence line, using a UID from the datasource listing tools. Omit it to use Grafana's default datasource for that type. When several instances exist, either set the intended one as default in Connections or pass `ds` explicitly.
