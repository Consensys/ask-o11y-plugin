# Ask O11y - Prometheus Metrics Collection with Grafana Alloy & Mimir

This document outlines the architecture and Grafana Alloy configuration required to automatically scrape LLM token usage metrics from the **Ask O11y** Grafana plugin (`consensys-asko11y-app`) and ingest them into Grafana Mimir TSDB for dashboard visualization.

The plugin registers its counter on the process-wide default Prometheus registry, which the Grafana plugin SDK already gathers via the backend `CollectMetrics` diagnostics call and folds into Grafana core's own `/metrics` endpoint. There is no separate plugin-owned scrape endpoint — scrape the Grafana instance itself.

---

## 1. Architecture Overview

```
 ┌─────────────────────────────────────────────────────────┐
 │                   Grafana Instance                      │
 │                                                         │
 │ ┌─────────────────────────────────────────────────────┐ │
 │ │ Ask O11y Plugin (consensys-asko11y-app)             │ │
 │ │                                                     │ │
 │ │  • Emits token metrics on agent completion          │ │
 │ │  • Registered on the process default Prometheus    │ │
 │ │    registry (collected via the plugin SDK's        │ │
 │ │    CollectMetrics diagnostics call)                 │ │
 │ └──────────────────────────┬──────────────────────────┘ │
 │                             │ (folded into Grafana's own │
 │                             │  /metrics output)          │
 │ ┌──────────────────────────▼──────────────────────────┐ │
 │ │ Grafana core HTTP server — GET /metrics             │ │
 │ └──────────────────────────┬──────────────────────────┘ │
 └────────────────────────────┼────────────────────────────┘
                              │
                              │ (Scrapes /metrics)
                              ▼
 ┌─────────────────────────────────────────────────────────┐
 │                     Grafana Alloy                       │
 │                                                         │
 │  • Scrapes asko11y_agent_user_tokens_total              │
 │  • Applies relabeling rules (job, env, instance)        │
 │  • Pushes metrics via Remote Write                      │
 └────────────────────────────┼────────────────────────────┘
                              │
                              │ (Remote Write push over TLS)
                              ▼
 ┌─────────────────────────────────────────────────────────┐
 │                     Grafana Mimir                       │
 │                                                         │
 │  • Stores time-series data in TSDB                      │
 │  • Evaluates PromQL increase(...[$__range]) queries     │
 └─────────────────────────────────────────────────────────┘
```

---

## 2. Metric Details

The Ask O11y plugin backend registers the following Prometheus counter metric, which is exposed through Grafana core's own `/metrics` endpoint (see above):

| Metric Name | Type | Labels | Description |
| :--- | :--- | :--- | :--- |
| `asko11y_agent_user_tokens_total` | Counter | `user`, `login`, `model`, `type`, `org`, `org_name` | Total LLM prompt and completion tokens consumed per user, model (`base`/`large`), and type (`prompt`/`completion`). |

---

## 3. Grafana Alloy Configuration (`config.alloy`)

To enable metric scraping and pushing, add the following configuration block to your `/etc/alloy/config.alloy` file. If your Grafana instance has `[metrics]` basic auth enabled in `grafana.ini`, add matching `basic_auth` credentials to the `prometheus.scrape` block below.

```river
// 1. Scrape Grafana's own metrics endpoint (includes asko11y_* counters
//    folded in via the plugin SDK's CollectMetrics diagnostics call)
prometheus.scrape "asko11y_plugin" {
  targets = [
    { "__address__" = "grafana.internal:3000" },
  ]
  metrics_path = "/metrics"
  scheme       = "http"
  forward_to   = [prometheus.relabel.asko11y_job_labels.receiver]
}

// 2. Relabeling Rules
prometheus.relabel "asko11y_job_labels" {
  rule {
    target_label = "job"
    replacement  = "ask-o11y"
  }
  forward_to = [prometheus.relabel.add_common_labels.receiver]
}

prometheus.relabel "add_common_labels" {
  rule {
    target_label = "env"
    replacement  = "prod"
  }
  forward_to = [prometheus.remote_write.mimir.receiver]
}

// 3. Remote Write to Grafana Mimir TSDB
prometheus.remote_write "mimir" {
  endpoint {
    url = "https://metrics.your-domain.com/api/v1/push"
    headers = {
      "X-Scope-OrgID" = "ask-o11y",
    }
  }
}
```

---

## 4. Verification

1. **Verify Alloy Scrape Health**:
   - Access Alloy's internal UI at `http://<alloy-host>:12345`.
   - Ensure the target `prometheus.scrape.asko11y_plugin` status is `UP`.

2. **Test PromQL Query in Grafana**:
   - Open Grafana Explore or the **Ask O11y LLM Token Usage & Cost** dashboard.
   - Query the active counter:
     ```promql
     sum(increase(asko11y_agent_user_tokens_total[$__range]))
     ```
