# Retro-Spec: Telemetry — Spans, Metrics, Dashboards

**Capability ID**: `124-telemetry`

**Status**: Retrospective

**Last verified**: `6c09d13`

**Owner**: Ask O11y maintainers

**Module**: `pkg/plugin/metrics.go`, `pkg/mcp/trace_propagation.go`, `pkg/agent/`, `pkg/plugin/plugin.go`

---

## Purpose

Record every LLM token per user, model, and org in one Prometheus counter.
Join asko11y, mcp-grafana, and Grafana core spans into one trace.
Show token usage and cost in one provisioned dashboard.

## Actors and RBAC

| Capability | Admin | Editor | Viewer | Evidence |
|---|---|---|---|---|
| Start a run that records tokens | yes | yes | yes | `pkg/plugin/plugin.go:871` (no role gate) |
| Read the token dashboard | yes | yes | yes | `provisioning/dashboards/agent-usage.json:560`; Grafana datasource permissions govern |

## Contract

### HTTP endpoints

| Method | Path | Handler | Evidence |
|---|---|---|---|
| POST | `/api/plugins/consensys-asko11y-app/resources/api/agent/run` | `handleAgentRun` | `pkg/plugin/plugin.go:871` |
| GET | `/metrics` | none. The route is deliberately absent | `pkg/plugin/metrics_test.go:11` |

### SSE events

| Event | Payload fields | Evidence |
|---|---|---|
| `done` | `PromptTokens`, `CompletionTokens`, `TotalTokens`, `UsageByModel[model]` | `pkg/agent/types.go:173` |

### Configuration keys

| Key | Location | Default | Evidence |
|---|---|---|---|
| `GF_TRACING_OPENTELEMETRY_OTLP_ADDRESS` | Grafana container | `tempo:4317` (dev) | `docker-compose.dev.yaml:51` |
| `GF_TRACING_OPENTELEMETRY_OTLP_PROPAGATION` | Grafana container | `w3c` | `docker-compose.dev.yaml:52` |
| `GF_TRACING_OPENTELEMETRY_SAMPLER_*` | Grafana container | `const`, `1` | `docker-compose.dev.yaml:53` |
| `GF_PLUGIN_CONSENSYS_ASKO11Y_APP_TRACING` | Grafana container | `true` (dev only) | `docker-compose.dev.yaml:55` |

### MCP tool names

| Tool | Read-only | Evidence |
|---|---|---|
| None. This capability only injects trace context on MCP calls. | n/a | `pkg/mcp/trace_propagation.go:77` |

## Behaviour Rules

1. The `agent_run` span starts at the run handler entry and ends when the handler returns. `VERIFIED` — `pkg/plugin/plugin.go:877`
2. The `agent_run` span carries `org_id`, `user_role`, and `session_id`. `VERIFIED` — `pkg/plugin/plugin.go:1115`
3. The `agent_run` span carries no `run_id` and no model attribute. `GAP` — `pkg/plugin/plugin.go:1115` sets only three attributes
4. The `llm_call` span starts per LLM request and records `llm.model`, `llm.message_count`, `llm.tool_count`, `llm.max_completion_tokens`, `llm.request_bytes`. `VERIFIED` — `pkg/agent/llm_client.go:150`
5. `llm_call` records `llm.http_status`, `llm.request_id`, `llm.retryable` on a non-OK status. `VERIFIED` — `pkg/agent/llm_client.go:192`
6. `llm_call` records `llm.prompt_tokens` and `llm.completion_tokens` when usage is present. `VERIFIED` — `pkg/agent/llm_client.go:235`
7. `mcp_tool_call` starts in `executeTool` with attribute `mcp.tool_name`. `VERIFIED` — `pkg/agent/loop.go:961`
8. `mcp_tool_call` records `mcp.is_error`, and `mcp.error_kind` when the kind is non-empty. `VERIFIED` — `pkg/agent/loop.go:964`
9. The `mcp_tool_call` span is not the parent of the MCP request. `executeTool` discards the span context, so the HTTP span parents onto `agent_run`. `GAP` — `pkg/agent/loop.go:961` drops the context that `pkg/agent/loop.go:988` passes on
10. The MCP client injects W3C `traceparent` and `tracestate` headers. `VERIFIED` — test `TestTracePropagationTransport_InjectsTraceparent`
11. The transport uses a direct W3C propagator, not the global one. `VERIFIED` — `pkg/mcp/trace_propagation.go:51`
12. The transport wraps the MCP SDK HTTP client. `VERIFIED` — `pkg/mcp/client.go:277`
13. A caller span survives `mergeUserCtx`, and the context is enriched for inner middleware. `VERIFIED` — tests `TestTracePropagationTransport_MergedContextCallerSpan`, `TestTracePropagationTransport_EnrichesContextForInnerMiddleware`
14. A request with no span passes through unmodified. `VERIFIED` — test `TestTracePropagationTransport_NoSpan`
15. All three spans come from `tracing.DefaultTracer()`. The repo never calls `InitDefaultTracer`. `VERIFIED` — `pkg/plugin/plugin.go:877`, `pkg/agent/llm_client.go:134`, `pkg/agent/loop.go:961`
16. The SDK exports those spans to the OTel endpoint that the Grafana host passes to the plugin. `ASSUMED` — `go.mod:6`; the only address in the repo is `docker-compose.dev.yaml:51`
17. Production gives the plugin no tracing configuration of its own. Export depends on host settings outside this repo. `GAP` — `deploy/helm/grafana-values-ask-o11y-ha.yaml:12` sets no tracing key
18. The only plugin metric is `asko11y_agent_user_tokens_total`, a counter vector with labels `user`, `login`, `model`, `type`, `org`, `org_name`. `VERIFIED` — `pkg/plugin/metrics.go:19`
19. Label `type` is `prompt` or `completion`; label `model` is a usage-map key, that is `base` or `large`. `VERIFIED` — `pkg/plugin/plugin.go:1236`, test `TestAgentLoop_FallbackAttributesUsageToBaseModel`
20. The counter increments once per run at the `done` event, per model entry. A run without a usage map falls back to the effective model, then to `base`. `VERIFIED` — `pkg/plugin/plugin.go:1240`, `pkg/plugin/plugin.go:1232`
21. Startup creates four zero series: `base` and `large`, each `prompt` and `completion`. `VERIFIED` — `pkg/plugin/metrics.go:57`
22. `org_name` is trimmed, stripped of control characters, capped at 64 runes, and set to `unknown` when empty. `VERIFIED` — test `TestSanitizeOrgNameLabelTruncatesByRune`
23. The `user` and `login` labels both identify the same person, so each user creates two label dimensions. `ASSUMED` — `pkg/plugin/plugin.go:1236`; no test states the intent
24. `org_name` accepts any caller string up to 64 runes, so distinct values create unbounded series. `ASSUMED` — `pkg/plugin/metrics.go:13`; the frontend sends `bootData.user.orgName` (`src/components/Chat/hooks/useChat.ts:593`)
25. The counter writes to the process default registry. No route in this repo exposes that registry. `GAP` — `pkg/plugin/metrics.go:17`, `pkg/plugin/metrics_test.go:11`
26. Token totals also persist per session as Redis hash fields that expire with the session TTL. `VERIFIED` — `pkg/plugin/sessionstore_redis.go:484`
27. `Usage` has `prompt_tokens`, `completion_tokens`, and `total_tokens` only. `VERIFIED` — `pkg/agent/types.go:65`
28. Prompt-cache tokens are not parsed and not recorded. No `cache_read_tokens` field exists. `GAP` — `pkg/agent/types.go:65`
29. The dashboard `asko11y-agent-usage` holds four panels (two stats, one pie chart, one table), queries only the token counter, and varies on `tenant` (all `org_name` values), `datasource`, and four price text boxes. `VERIFIED` — `provisioning/dashboards/agent-usage.json:610`
30. The dev stack mounts the dashboard JSON and a file provider for it. `VERIFIED` — `docker-compose.dev.yaml:32`, `dev/provisioning/dashboards/dashboards.yaml:9`
31. The root compose stack and the Helm values provision no dashboard provider for this JSON. `GAP` — `docker-compose.yaml:3` extends `.config/docker-compose-base.yaml:23` (no dashboards path); `deploy/helm/grafana-values-ask-o11y-ha.yaml:8` configures plugins only

## Invariants

- Every span comes from the SDK default tracer, never from a private provider. `VERIFIED` — `pkg/plugin/plugin.go:877`
- An MCP request carries the caller span context when one exists. `VERIFIED` — `pkg/mcp/trace_propagation_test.go:88`
- `org_name` is never longer than 64 runes and never carries control characters. `VERIFIED` — `pkg/plugin/metrics_test.go:30`
- The plugin exposes no Prometheus scrape route. `VERIFIED` — `pkg/plugin/metrics_test.go:23`

## Failure Modes

| Condition | User-visible result | Evidence |
|---|---|---|
| LLM returns a non-OK status | Span records status and request ID; run emits an SSE `error` event | `pkg/agent/llm_client.go:189` |
| Request carries no span | MCP receiver roots its own trace; no error | `pkg/mcp/trace_propagation.go:71` |
| Host tracing is disabled | Spans are dropped silently; no user-visible change | `deploy/helm/grafana-values-ask-o11y-ha.yaml:12` |
| Registry is never scraped | Counter stays invisible to Prometheus | `pkg/plugin/metrics_test.go:11` |

## Data and Persistence

| Store | Key or table | TTL | Fallback | Evidence |
|---|---|---|---|---|
| Prometheus default registry | `asko11y_agent_user_tokens_total` | process lifetime | none | `pkg/plugin/metrics.go:17` |
| Redis hash | session stats `promptTokens`, `completionTokens`, `totalTokens` | session TTL, default 90 days | in-memory store when Redis is unset | `pkg/plugin/sessionstore_redis.go:487`, `pkg/plugin/plugin.go:367` |

## Observability

| Signal | Name | Where | Evidence |
|---|---|---|---|
| Span | `agent_run` | Host OTel pipeline | `pkg/plugin/plugin.go:877` |
| Span | `llm_call` | Host OTel pipeline | `pkg/agent/llm_client.go:134` |
| Span | `mcp_tool_call` | Host OTel pipeline | `pkg/agent/loop.go:961` |
| Metric | `asko11y_agent_user_tokens_total` | `asko11y-agent-usage` dashboard | `pkg/plugin/metrics.go:19` |
| Log field | `traceId` | LLM error log | `pkg/agent/llm_client.go:200` |

## Evidence Index

- `pkg/plugin/plugin.go:877` — the `agent_run` span start
- `pkg/plugin/plugin.go:1115` — `agent_run` attributes
- `pkg/agent/loop.go:961` — `mcp_tool_call` span start
- `pkg/mcp/trace_propagation.go:77` — W3C header injection
- `pkg/plugin/metrics.go:22` — counter label set
- `pkg/plugin/metrics_test.go` — `TestSanitizeOrgNameLabelTruncatesByRune` — rune cap

## Known Gaps

- `mcp_tool_call` has no child span. Forward spec: "Trace parentage repair".
- Prompt-cache tokens are invisible. Forward spec: "Prompt-cache accounting".
- The metric has no scrape path. Forward spec: "Plugin metrics export".
- Production trace export is unset. Forward spec: "Production self-observability".
- The dashboard is dev-only. Forward spec: "Usage dashboard provisioning".
