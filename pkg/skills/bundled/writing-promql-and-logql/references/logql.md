# LogQL reference

## Contents
- Label discovery workflow
- Query building order
- JSON and logfmt parsing
- Metrics-from-logs
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

## JSON and logfmt parsing

```
{service="checkout"} | json | level="error" | line_format "{{.msg}}"
{service="checkout"} | logfmt | msg=~"timeout.*"
```

## Metrics-from-logs

Count or rate over a filtered stream when a metric does not exist:

```
sum by (service) (count_over_time({namespace="prod"} |= "timeout" [5m]))
sum by (level) (rate({service="checkout"} | json [5m]))
```

## Worked examples

```
# Errors for a service in an incident window
{namespace="prod", service="checkout"} |= "error" | json | level="error"

# Slow-request log lines alongside a latency spike
{service="api"} | json | duration > 1000

# Restart loops: crash messages per pod
sum by (pod) (count_over_time({namespace="prod"} |= "CrashLoopBackOff" [10m]))
```
