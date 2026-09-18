---
name: analyzing-performance
description: >-
  Analyzes performance issues — CPU, memory, request latency, throughput,
  and error rates — and identifies bottlenecks by correlating metrics, logs,
  and traces. Use when the user asks about performance, slow services,
  latency, saturation, bottlenecks, or resource constraints — even when they
  say "why is it slow", "the service is struggling", or "check health"
  without the word performance.
metadata:
  model: large
  version: "1.1"
  user-prompt: |
    Analyze performance issues in the system "{{.Target}}".

    **Investigation Steps:**
    1. Query key performance metrics (CPU, memory, request latency, error rates)
    2. Identify performance bottlenecks and resource constraints
    3. Search for error logs and warnings related to performance
    4. Check for traces with high latency or failures
    5. Correlate metrics, logs, and traces to identify root causes
    6. Provide optimization recommendations

    Use the available MCP tools to gather real data.
---

## Performance analysis workflow

1. **Establish scope** — Identify the target system (service, pod, namespace, cluster) and the exact time window from the user's request. Resolve datasource UIDs once and reuse them.
2. **Query key metrics** — CPU and memory usage vs limits, request latency percentiles (p50/p95/p99), error rates, and saturation signals (queue depth, connection pools, thread counts).
3. **Identify bottlenecks** — Compare resource requests/limits against usage; look for throttling, OOM kills, restarts, GC pauses, and slow downstream dependencies.
4. **Search logs** — Warnings and errors for the affected services in the same window; note recurring patterns and their frequency.
5. **Check traces** — Use traces only when the symptom is request-level latency or failures: span durations, downstream call latency, and error spans for the affected services.
6. **Correlate** — Align findings across signals by timestamp to separate cause from symptom (deploy markers, traffic spikes, dependency latency, config changes).
7. **Recommend** — Rank optimization steps by expected impact and confidence, and give one verification query per recommendation.

## Method shortcuts

- **RED first, then USE** — for request-serving services, check Rate, Errors, Duration; for resources (nodes, disks, connections), check Utilization, Saturation, Errors.
- **Percentile caveats** — p99 is per-request, not per-user: on 10 rps, p99 ignores ~1 in 10 seconds of traffic; a latency problem visible in p95 but not p50 means a tail subset (one AZ, one route, one pod) is affected — slice percentiles by route/instance to find it.
- **Triage order** — saturation before latency before errors: a saturated resource (CPU throttling, connection-pool exhaustion, disk I/O) explains downstream latency and errors; fixing the symptom query first wastes the investigation.
- **Compare against baseline** — diff the same window one day or one week earlier (`offset 1d`) rather than judging absolute values.

**Final answer shape** — Lead with the primary bottleneck, then the evidence (queries and samples), then ranked recommendations.
