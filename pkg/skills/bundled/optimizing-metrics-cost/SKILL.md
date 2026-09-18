---
name: optimizing-metrics-cost
license: Apache-2.0
description: Diagnose and reduce Prometheus/Mimir metrics cost and cardinality — active-series triage, per-metric and per-label drill-down, histogram 14x multiplier, churn diagnosis, label-strategy audits, and Adaptive Metrics recommendations. Use when investigating a high metrics bill, "too many series", "reduce cardinality", "Mimir is expensive", "which metrics cost the most", "label blowup", "series churn", "histogram is killing us", or "should I drop the pod label" — even when the user says "why is my bill so high" without naming cardinality.
metadata:
  version: "1.0"
  triggers: 'cardinality|too many series|metrics (cost|spend|bill)|active series|adaptive metrics|series churn|label blowup|mimir bill'
---

Diagnose metrics cardinality/cost problems, then recommend the *safe* fix. You can run diagnostic queries yourself via the Prometheus datasource tools; remediation (Adaptive Metrics rules, source fixes) usually belongs to the user.

## The One Rule: never drop a label that makes a series unique

Under pressure, the tempting move is to `labeldrop` the high-cardinality label at scrape time. **Do not recommend it.** Removing `pod`, `instance`, or any label that distinguishes real series silently breaks the data: counter resets from different series interleave → `rate()`/`increase()` return garbage (often absurdly high), duplicate samples inflate DPM instead of reducing it, and there is no evidence left of where it broke.

The only safe remediations, in order of preference:

1. **Fix the source** — stop emitting the bad label (the real fix for unbounded `path`, `user_id`).
2. **Adaptive Metrics** — aggregates *correctly* (counter-reset-aware, audited, reversible). For Grafana Cloud: portal → Adaptive Metrics → review auto-recommendations sorted by series-reduction impact. Rules apply within ~5 minutes; verify with the queries below.
3. **Drop an entire unwanted metric** — `action: drop` on `__name__` is safe because it discards whole series, not labels.

## Investigation playbook (run these yourself)

```promql
# Headline: total active series (Grafana Cloud billed unit)
grafanacloud_instance_active_series
# Self-hosted Prometheus / Mimir:
prometheus_tsdb_head_series

# Growth rate over 7d — more than a few %/day on a stable fleet is a red flag
deriv(prometheus_tsdb_head_series[7d]) * 86400

# Top 10 metrics by series count — usually the whole answer
topk(10, count by (__name__)({__name__=~".+"}))

# Per-metric drill-down: unique values per label on the suspect metric
count by (label_name) (count by (__name__, label_name) (<metric>))

# Top label values inside one label
topk(20, count by (path) (http_requests_total))

# Series-per-instance breakdown — if uneven, one instance is misbehaving
count by (instance) (<metric>)

# Recent change: what did a deploy add? Compare offset 1d/7d, correlate with build_info
count by (__name__)({__name__=~".+"}) - count by (__name__)({__name__=~".+"} offset 1d)
```

Read the results:
- A histogram (`_bucket`) on top is almost always the answer — histograms multiply base cardinality by **(bucket count + 3)**, typically 14x. Fix = trim labels on the histogram at the source, or move to native histograms.
- Any label with >10K unique values is a bug: `trace_id`, `request_id`, `session_id`, `path`, `url`, `email` belong in logs/traces/exemplars, never labels.
- Same metric in multiple variants (`_bucket`, `_sum`, `_count`, `_created`) — count all together for true impact.
- **DPM spiked but active series flat?** That's scrape interval or duplicate `remote_write`, not cardinality — check scrape configs before hunting labels.

## Label-strategy audit

Score each label on the suspect metric:

| Label | Verdict |
|---|---|
| `env`, `job`, `cluster`, `region` | good — low, stable values |
| `namespace`, `service`, `container` | acceptable |
| `instance` | fine per-instance, risky on aggregated metrics |
| `pod` | required for K8s uniqueness — keep; reduce cost with Adaptive Metrics, never scrape-time drop |
| `path`/`route` | only if templated (`/users/:id`); raw URLs = unbounded |
| `version`, `git_sha` | churny — use an info metric (`app_build_info{version="..."} 1`) instead of stamping every metric |
| `user_id`, `trace_id`, `error_message` | never — unbounded |

Key math: total series ≈ *product* of per-label cardinalities. Adding one high-cardinality label can 10-100x a metric. Check consistency too: `status` vs `status_code` vs `http_status` splits label families and breaks joins.

## Verify a fix

```promql
# Series dropped by Adaptive Metrics rules
grafanacloud_instance_active_series_dropped_by_aggregation_rules
```

Before/after: capture `count by (__name__)({__name__="<metric>"})` before the change, re-run 10-15 minutes after, expect a large drop. For dashboards/alerts referencing the metric, confirm queries don't depend on a dropped label first (`grep`-level check via the user, or search dashboards via the search tools).

## Escalation

Point the user at: Adaptive Metrics UI (portal), `write_relabel_config` in their collector config for dropping whole metrics, and instrumentation changes for source fixes. For bills driven by logs/traces (not metrics), that's a different investigation — say so explicitly rather than stretching this playbook.

Reference for label strategy deep-dives: grafana.com/docs/grafana-cloud/cost-management-and-billing/reduce-costs/metrics-costs/adaptive-metrics/
