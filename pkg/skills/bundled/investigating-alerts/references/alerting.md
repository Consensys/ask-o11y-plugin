# Alerting reference — rule anatomy and failure modes

<!-- Adapted from grafana/skills (Apache-2.0): https://github.com/grafana/skills/tree/0519662/skills/grafana-core/alerting-irm -->

## Alert rule anatomy

Grafana supports three rule types — Grafana-managed rules (data pipeline: query → reduce → math condition), Prometheus/Mimir ruler rules (PromQL with a threshold), and Loki ruler rules (LogQL).

```yaml
# Prometheus / Mimir ruler rule
groups:
  - name: service-alerts
    interval: 1m
    rules:
      - alert: HighErrorRate
        expr: |
          sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
          /
          sum(rate(http_requests_total[5m])) by (service)
          > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate: {{ $labels.service }}"
          runbook_url: "https://runbooks.example.com/high-error-rate"
```

```yaml
# Grafana-managed rule (provisioning YAML): query A → reduce B → math condition C
rules:
  - uid: high-error-rate
    title: High Error Rate
    condition: C
    data:
      - refId: A
        datasourceUid: prometheus
        relativeTimeRange: { from: 300, to: 0 }
        model:
          expr: sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
      - refId: B
        datasourceUid: __expr__
        model: { type: reduce, refId: B, expression: A, reducer: last }
      - refId: C
        datasourceUid: __expr__
        model: { type: math, refId: C, expression: "$B > 0.05" }
    noDataState: NoData
    execErrState: Alerting
    for: 5m
```

Key fields when investigating a firing alert:
- `expr` / query — the exact condition that fired; reuse its label matchers when scoping queries
- `for` — how long the condition held before firing (a rule with `for: 15m` fired means the problem existed at least that long)
- `labels` — routing and scoping metadata (`severity`, `team`); `alertname` is the rule name
- `annotations` — human context; `runbook_url` is the investigation entry point
- `noDataState` / `execErrState` — what happens when the query returns nothing or errors (`NoData`, `Alerting`, `Error`, `OK`) — a common source of surprise pages or silence

## Multi-window multi-burn-rate alerts

The SRE best practice for error-budget SLOs: alert on burn rate over paired windows to catch fast and slow burns with few false positives.

```promql
# Fast burn (page): 5m rate at 14.4x budget, held 2m... 1h rate confirms
(
  sum(rate(http_requests_total{status_code=~"5.."}[5m]))
    / sum(rate(http_requests_total[5m]))
) / (1 - 0.999) > 14.4
and
(
  sum(rate(http_requests_total{status_code=~"5.."}[1h]))
    / sum(rate(http_requests_total[1h]))
) / (1 - 0.999) > 14.4
```

Slow burn (ticket) uses the same shape with `[30m]`/`[6h]` windows and a 6x factor.

## Why is this alert not firing (or firing too much)?

Checklist, in order:

1. **Window vs scrape interval** — a `[2m]` range with a 30s scrape borderline; rate needs ≥ 4x scrape interval
2. **`for` duration** — condition must hold continuously; transient spikes reset it
3. **Divide-by-zero** — a ratio with an empty denominator yields no data, not zero; add the `> 0` guard
4. **`noDataState`** — `NoData` silences missing-series failures; a down exporter may never fire
5. **Label mismatch** — the rule aggregates away the label the notification shows, or a `labeldrop` at scrape time removed the matcher
6. **Firing too much** — missing `for`, no multi-window confirmation, or `absent()`-style flapping; consider pairing 5m + 1h windows

## Contact points and notification routing

Notifications flow: rule (labels) → notification policy (matchers route to contact points) → contact point (PagerDuty, Slack, email, webhook, ...) → on-call schedule. When a user says "nobody got paged", check the matcher chain: rule labels vs policy matchers (exact match, `=~`/`!~` regex), group/mute timings, and the contact point's receiver settings.
