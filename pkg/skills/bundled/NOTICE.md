# NOTICE

Portions of the bundled skills in this directory are adapted from
[grafana/skills](https://github.com/grafana/skills) (commit `0519662`),
copyright Grafana Labs, licensed under the Apache License, Version 2.0.

Skill content adapted (in whole or in part) from upstream skills:

| Bundled skill / file | Upstream source |
|---|---|
| `writing-promql-and-logql/SKILL.md` + `references/promql.md` | `grafana-core/promql` (SKILL.md, references/patterns.md) |
| `writing-promql-and-logql/references/logql.md` | `grafana-lgtm/loki` (SKILL.md) |
| `analyzing-traces/SKILL.md` + `references/traceql.md` | `grafana-lgtm/tempo` (SKILL.md, references/traceql.md) |
| `querying-profiles/SKILL.md` + `references/profile-types.md` | `grafana-lgtm/pyroscope` (SKILL.md, references/ebpf-and-query.md) |
| `investigating-alerts/references/alerting.md` | `grafana-core/alerting-irm` (SKILL.md, references/alerting.md) |
| `building-dashboards/SKILL.md` + `references/dashboard-json.md` | `grafana-core/dashboarding` (SKILL.md, references/json-schema.md) |
| `optimizing-metrics-cost/SKILL.md` | `grafana-cloud/adaptive-metrics`, `grafana-cloud/cost-management`, `grafana-cloud/dpm-finder`, `grafana-cloud/prometheus-cardinality-troubleshooter`, `grafana-cloud/prometheus-label-strategy` |
| `writing-k6-tests/SKILL.md` | `grafana-k6/k6` (SKILL.md), `grafana-cloud/synthetic-monitoring-checks` (SKILL.md) |
| `analyzing-performance/SKILL.md`, `rendering-visualizations/SKILL.md` | methodology (USE/RED, panel selection) informed by upstream skills |

Upstream files carry a `license: Apache-2.0` frontmatter field or an
`Adapted from grafana/skills` HTML-comment header pointing at the exact
upstream path.

Remaining bundled skills (`analyzing-cloudwatch`, the original workflows in
`investigating-alerts`, `building-dashboards`, `querying-profiles`) are
original to this repository, licensed under its MIT license (see the repo
root LICENSE).

Apache License, Version 2.0: http://www.apache.org/licenses/LICENSE-2.0
