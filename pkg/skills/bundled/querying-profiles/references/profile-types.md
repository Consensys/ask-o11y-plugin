# Profile types and interpretation

<!-- Adapted from grafana/skills (Apache-2.0): https://github.com/grafana/skills/tree/0519662/skills/grafana-lgtm/pyroscope -->

## Profile type format

`<type>:<value_type>:<value_unit>:<span_name>:<span_unit>`

Common profile types:

- `process_cpu:cpu:nanoseconds:cpu:nanoseconds` — CPU time (on-CPU)
- `memory:inuse_space:bytes:space:bytes` — heap in use (live memory)
- `memory:alloc_space:bytes:space:bytes` — heap allocations (cumulative churn)
- `goroutine:goroutine:count::` — goroutine count (Go)
- `mutex:contentions:count::` — mutex contention
- `block:contentions:count::` — blocking waits

## Choosing a profile type

Symptom → profile type:

- High CPU → `process_cpu`
- OOM / memory growth → `memory:inuse_space`
- GC pressure / high allocation rate → `memory:alloc_space`
- Slow or hung goroutines → `goroutine`, then `block` / `mutex`
- Latency with low CPU → `mutex` or `block` (contention, not computation)

## Reading flame graphs

- **Flat (self) time** — time spent in the function itself; a wide flat block at the top of a branch is where work happens
- **Cumulative time** — time including callees; wide lower blocks point at the subtree to zoom into
- Compare the same profile type across two windows (before/after a deploy, or peak vs baseline) rather than reading a single flame graph — deltas localize regressions
- A flat flame graph for CPU with high latency means the service is waiting (I/O, locks), not computing — switch to block/mutex or look at traces
