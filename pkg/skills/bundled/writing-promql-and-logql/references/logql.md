# LogQL reference

<!-- Adapted in part from grafana/skills (Apache-2.0): https://github.com/grafana/skills/tree/0519662/skills/grafana-lgtm/loki -->

## Contents

- Label discovery workflow
- Query building order
- Stream selectors and line filters
- Parsers
- Label and label-value filters
- line_format and label_format
- Metrics from logs
- Unwrapped range aggregations
- Worked examples

## Label discovery workflow

Before writing Loki queries for an unfamiliar cluster or namespace:

1. Use the Loki label names discovery tool to inspect the actual label schema
2. Never assume label names — `pod`, `k8s_pod_name`, `service`, and similar names vary by deployment; confirm them before querying
3. Use label value discovery tools to verify that specific values (pod names, service names) exist before filtering on them

## Query building order

1. **Label filters first** — `{namespace="prod", service="checkout"}` — they are index-backed and cheap
2. **Line filters second** — `|= "error"` — they scan lines, so narrow the stream first
3. **Parsing only when needed** — extract structured fields only when the answer needs them

Loki indexes only labels, not log content — a wide stream selector is what makes queries slow.

## Stream selectors and line filters

```logql
{app="nginx"}                          # exact match
{app!="nginx"}                         # not equal
{app=~"nginx|apache"}                  # regex match (RE2, fully anchored)
{app!~"debug.*"}                       # regex not match
{app="nginx", env="prod"}              # AND across labels

{app="nginx"} |= "error"               # contains
{app="nginx"} != "info"                # does not contain
{app="nginx"} |~ "error|warn"          # regex match
{app="nginx"} !~ "health.*check"       # regex not match
```

## Parsers

```logql
{app="api"} | json                                          # all fields
{app="api"} | json status="http_status", path="request.path" # with renames

{app="api"} | logfmt                                          # key=value
{app="api"} | logfmt --keep-empty

{app="nginx"} | pattern `<ip> - - <_> "<method> <uri> <_>" <status> <bytes>`  # positional; `_` discards

{app="nginx"} | regexp `(?P<method>\w+) (?P<path>\S+) HTTP/(?P<version>\S+)`  # named capture groups

{app="api"} | unpack                        # unwrap Promtail packed labels
```

## Label and label-value filters (after a parser)

```logql
{app="api"} | json | status >= 500
{app="api"} | json | status == 200 and method != "OPTIONS"
{app="api"} | logfmt | duration > 1s
{app="api"} | json | level =~ "error|warn"
{app="api"} | json | bytes > 20MB
{app="api"} | json | path != "/healthz"
```

## line_format and label_format

```logql
{app="api"} | json | line_format "{{.method}} {{.path}} -> {{.status}} ({{.duration}})"

{app="api"} | logfmt | label_format severity=level, svc=app
{app="api"} | logfmt | label_format msg=`{{.level}}: {{.message}}`
```

## Metrics from logs

Count or rate over a filtered stream when a metric does not exist:

```logql
sum by (service) (count_over_time({namespace="prod"} |= "timeout" [5m]))
sum by (level) (rate({service="checkout"} | json [5m]))
```

```logql
rate({app="nginx"}[5m])                          # lines per second
bytes_over_time({app="nginx"}[1h])               # total bytes in window
absent_over_time({app="nginx"}[5m])              # 1 when no logs — absence alerting
sum(count_over_time({env="prod"} |= "error" [5m]))   # total errors across services
```

## Unwrapped range aggregations

Extract numeric values from log lines and aggregate them:

```logql
# Average request duration from logfmt
avg_over_time({app="api"} | logfmt | unwrap duration [5m])

# p95 latency per app
quantile_over_time(0.95, {app="api"} | logfmt | unwrap duration [5m]) by (app)

# Sum of bytes from JSON logs
sum_over_time({app="api"} | json | unwrap bytes [5m])
```

## Worked examples

```logql
# Errors for a service in an incident window
{namespace="prod", service="checkout"} |= "error" | json | level="error"

# Slow-request log lines alongside a latency spike
{app="api"} | logfmt | duration > 1s | line_format "SLOW: {{.method}} {{.path}} {{.duration}}"

# HTTP 5xx with status extracted via pattern
{app="nginx"} | pattern `<ip> - - <_> "<method> <uri> <_>" <status> <bytes>` | status >= 500

# Restart loops: crash messages per pod
sum by (pod) (count_over_time({namespace="prod"} |= "CrashLoopBackOff" [10m]))

# Error ratio per service from logs alone
sum(rate({env="prod"} |= "error" [5m])) by (service)
  / sum(rate({env="prod"}[5m])) by (service)
```
