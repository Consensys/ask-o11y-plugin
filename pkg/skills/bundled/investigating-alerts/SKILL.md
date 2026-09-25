---
name: investigating-alerts
license: Apache-2.0
description: >-
  Investigates firing alerts and incidents and drives root cause analysis
  across metrics, logs, and traces, prioritizing the alert's runbook. Use
  when the user mentions alerts, incidents, firing notifications, outages,
  or asks to find the root cause of a problem — even when they say
  "something is down", "why did we get paged", or "perform root cause
  analysis".
metadata:
  model: large
  max-iterations: "60"
  triggers: '\[FIRING[:\s]|alert investigation:|perform root cause analysis'
  version: "1.2"
  user-prompt: |
    Investigate the alert "{{.AlertName}}" and perform root cause analysis.

    **Efficiency:** Treat this alert name and any labels on its rule or firing instance as the primary scope. Prefer **targeted** metrics and logs for the affected service or namespace over unfocused cluster-wide listing. Combine related queries where one PromQL or LogQL answers several checks.

    **Your first step:** Check your system prompt for an **Alert Context** block. If present, it was prefetched from the actual alert rule — treat its metric names, label matchers, and datasource UIDs as authoritative: fetch the runbook from its annotations (if any), then go straight to querying. Do not re-find the rule via alerting tools and do not list metric names unless you need a metric absent from that block.

    If (and only if) the Alert Context block is absent, find the alert by checking both:
    1. Prometheus datasource alerts (list datasources once to get the Prometheus UID; reuse it)
    2. Grafana-managed alerts

    When listing Prometheus datasource rules, filter with `label_selectors` (e.g. `label_selectors: ["alertname=\"{{.AlertName}}\""]`). Note `label_selectors` matches rule *labels* — datasource-managed rules usually have no `alertname` label (the rule name is the alertname), so a zero result there is expected; fall back to scanning rule titles. On mcp-grafana >= 1.4.0, `search_rule_name` is also safe to use for datasource rules.

    Once you find the alert, check its annotations for a runbook URL (commonly `runbook_url`). If present, **fetch and read the runbook before** broader metrics/logs/trace exploration. Use the appropriate tool for the URL type (e.g., web_fetch for HTTP, confluence_get_page for Confluence). Follow the runbook's steps; use other tools to fill gaps it leaves open.

    Then, scoped to the affected components and time of the incident:
    1. Confirm current alert status and recent state changes
    2. Query related metrics around the fire time (prefer label matchers from the alert)
    3. Search error logs for the affected services (same window and scope)
    4. Use traces only when they add signal for request-level failures or latency (same services)

    **Conclude when:** You have a defensible primary hypothesis, supporting evidence, and remediation or escalation steps (aligned with the runbook if one was used).

    **Final response:** Start with a brief **verdict**, then evidence, then remediation and one or two verification steps. End with the fenced `rca-report` block described in the skill body.

    Use the available MCP tools for real data and actionable conclusions.
---

## Alert investigation priority

For questions about alerts, incidents, or "what's wrong":

1. If an **Alert Context** block was prefetched into the system prompt, skip rule discovery entirely and start from its metrics/matchers/runbook
2. Otherwise, list available datasources to discover their UIDs — reuse these UIDs for the rest of the session
3. Check Prometheus datasource alerts first (pass the Prometheus datasource UID); filter by rule title or label selectors — on mcp-grafana < 1.4.0 `search_rule_name` is ignored on the datasource path and returns all rules (a large token cost)
4. Check Grafana-managed alerts (without a datasource UID filter)
5. Cross-reference with logs, traces, and metrics for context

**Why Prometheus first?** Most alerting rules live in Prometheus datasources, not Grafana-managed alerts.

## Root cause analysis workflow

1. **Triage** — Before deep queries, rank candidates using cheap signals: which alert fired **first**, which fires **most often** or carries the **highest volume**, and which signals (metrics + logs + traces) agree on the same component. Multi-modal agreement beats any single loud signal.
2. **Localize with metrics** — Metrics answer *which component and which resource*: use the alert's exact metrics and label matchers first (the Alert Context block when present)
3. **Identify fault type with logs** — Logs answer *what kind of failure* (OOM, connection refused, 5xx spike, backpressure): search error logs for the component metrics implicated
4. **Confirm the path with traces** — Traces answer *how the failure propagates*: use them only to confirm a specific propagation path you already suspect; do not mine raw traces hunting for a cause
5. **Narrow down** — Use specific label filters once you identify the affected component
6. **Verify** — Confirm the root cause with targeted queries before proposing solutions

### Hypothesis discipline

- **Keep 2–3 competing hypotheses alive early.** Each names a component AND a fault type, plus the one piece of evidence that would falsify it. Do not anchor on the first plausible story (the most common RCA failure mode) and do not chase a single hypothesis with ever-similar queries.
- **Check time ordering** — A plausible cause must start BEFORE its symptoms. Compare first-seen times across metrics and logs; a "cause" that starts after the effect is a symptom, not a cause.
- **Check topology consistency** — When the system prompt includes a **Service Topology** block, a propagation path must follow those edges. Do not invent dependencies that are not listed.
- **Self-critique before concluding** — Before the final answer, ask: what is the strongest piece of evidence AGAINST my leading hypothesis, and did I look at it? If you have not, spend one query on it instead of a fourth confirming query.

### Final report block

End the final response with a machine-readable summary in a fenced `rca-report` block. **Always emit it — never omit it.** Every successful tool result (including evicted/summarized ones) carries an `[evidence id: eN]` header; cite those. If a claim has no citable evidence, lower its confidence and list the missing proof in `gaps` instead of dropping the block:

````
```rca-report
{"hypotheses":[{"rank":1,"component":"payment","faultType":"high error rate","confidence":"high","evidenceIds":["e3","e7"],"propagationPath":["frontend","checkout","payment"],"firstSeen":"2026-09-25T10:05:00Z"}],"gaps":["trace data older than 1h is not retained"]}
```
````

- `hypotheses`: ranked candidates, best first (1–3). `component` is a service/dependency name; `faultType` a short failure description; `confidence` is `low`, `medium`, or `high`; `evidenceIds` are the ids from the `[evidence id: ...]` header of the successful tool results the claim rests on (e.g. `e3`) (never tool names or alert/rule UIDs); `propagationPath` is the ordered component chain (omit if unknown); `firstSeen` is the earliest symptom time for that component (RFC3339, omit if unknown).
- `gaps`: what the investigation could not establish (missing retention, denied tools, empty windows).

## Alert rule anatomy (for interpreting what fired)

When the investigation needs the rule definition itself (why it fired, why it stayed silent, why it doubled), reason from the rule structure: the query's label matchers scope the blast radius, `for` sets how long the condition held, and `noDataState`/`execErrState` decide what a broken query does. See [references/alerting.md](references/alerting.md) for rule YAML examples for all three rule types, multi-window burn-rate patterns, and the "not firing / firing too much" debugging checklist.

## Investigation discipline (this request)

This turn is an alert investigation. Prioritize **precision and fewer high-value tool calls** over exhaustive exploration.

- **Runbook ordering** — The user prompt requires checking the runbook_url annotation before deep investigation. Treat that as binding: fetch and apply the runbook before broad discovery.
- **Anchor on the alert** — Use the alert name, labels (namespace, cluster, service, job, severity), and any text in the notification to choose **narrow** filters. Do not run cluster-wide label enumeration when the alert already identifies a scope.
- **Tight parallel batches** — Parallel tool calls should share the same incident time window and suspected blast radius (e.g., alert row + metrics for the labeled job + logs for that service). Avoid parallel calls that scatter across unrelated systems without a hypothesis.
- **Sufficiency** — When metrics or logs support a likely root cause and you can name a single verification step, conclude. Do not continue investigating every datasource for completeness.
- **Final answer shape** — Lead with a **short verdict** (most likely cause), then evidence (queries, samples), then remediation and follow-up checks, then the `rca-report` block.
