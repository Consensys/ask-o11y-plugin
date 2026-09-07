# PromQL reference

## Contents
- Value types and when to use them
- Counters
- Gauges
- Histograms
- Aggregation pitfalls
- Worked examples

## Value types and when to use them

- **Counter** (monotonically increasing): always `rate()` / `increase()` — never the raw value
- **Gauge** (point-in-time): query directly; use `avg_over_time` / `max_over_time` for smoothing
- **Histogram** (buckets): `histogram_quantile()` over `le` buckets for percentiles

## Counters

```
# Request rate per service over 5m windows
rate(http_requests_total[5m])

# Total errors in the last hour
increase(errors_total[1h])
```

Aggregate before `rate()` when the raw series is high-cardinality (one series per pod):

```
sum by (service) (rate(http_requests_total[5m]))
```

## Gauges

```
# Current memory usage per pod
container_memory_working_set_bytes{pod=~"checkout.*"}

# Peak memory over the window
max_over_time(container_memory_working_set_bytes[1h])
```

## Histograms

```
# p99 latency per service
histogram_quantile(0.99, sum by (le, service) (rate(http_request_duration_seconds_bucket[5m])))
```

## Aggregation pitfalls

- `sum(rate(x[5m]))` and `rate(sum(x)[5m])` differ for counters — always `rate()` first, then aggregate
- `avg` across instances hides single-instance outliers; add `max` or `topk` when hunting a bad pod
- `topk(5, ...)` is per-evaluation-step — wrap with a subquery for a stable "top 5 over the window": `topk(5, max_over_time(rate(x[5m])[1h:5m]))`
- Unbounded `sum` without `by` merges everything into one line — usually a mistake

## Worked examples

```
# Error ratio per service
sum by (service) (rate(http_requests_total{status=~"5.."}[5m]))
  / sum by (service) (rate(http_requests_total[5m]))

# CPU saturation: usage vs limit per container
sum by (pod) (rate(container_cpu_usage_seconds_total[5m]))
  / sum by (pod) (kube_pod_container_resource_limits{resource="cpu"})
```
