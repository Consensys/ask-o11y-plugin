# Using Ask O11y through GCX

`gcx api` is a raw passthrough to the Grafana instance configured in GCX. It can therefore call Ask O11y's plugin API, which is served under:

```text
/api/plugins/consensys-asko11y-app/resources
```

This is useful for automation or coding agents that need to start and continue Ask O11y investigations without the Grafana UI.

## Prerequisites

- Grafana 12.1.1+ with the `consensys-asko11y-app` plugin installed and configured.
- GCX installed.
- A Grafana service-account token (`glsa_...`) with permission to use the plugin and the underlying observability actions. A Viewer can only run read-only MCP tools; Editor/Admin can access write-capable tools too.

## Configure GCX

Create a named GCX context for the Grafana instance:

```bash
gcx login ask-o11y \
  --server https://grafana.example.com \
  --token glsa_REPLACE_WITH_SERVICE_ACCOUNT_TOKEN \
  --yes
```

Check that the context can authenticate:

```bash
gcx --context ask-o11y config check
```

For non-interactive environments, use environment variables instead of persisting a login:

```bash
export GRAFANA_SERVER=https://grafana.example.com
export GRAFANA_TOKEN=glsa_REPLACE_WITH_SERVICE_ACCOUNT_TOKEN
```

All commands below use the active GCX context. Add `--context ask-o11y` if it is not active.

## Check the plugin

```bash
PLUGIN=/api/plugins/consensys-asko11y-app/resources

gcx api "$PLUGIN/health"
gcx api "$PLUGIN/openapi.json"
gcx api "$PLUGIN/api/mcp/tools"
```

The last command returns the MCP tools available to the identity behind the token, after Ask O11y's RBAC filtering.

## Start a session

Sessions are created automatically by the first agent run; there is no separate empty-session creation request.

```bash
gcx api "$PLUGIN/api/agent/run" -X POST \
  -d '{"message":"Investigate elevated error rate in the last hour"}'
```

Save the `sessionId` and `runId` returned in the response. The run normally starts in detached mode and returns promptly with a status such as `running`.

## List and inspect sessions

```bash
# Sessions visible to the current Grafana identity and organization
gcx api "$PLUGIN/api/sessions"

# One complete session
gcx api "$PLUGIN/api/sessions/SESSION_ID"
```

Sessions are scoped to the authenticated user/service account and Grafana organization. A service-account token will generally see the sessions it created, not sessions created by a person in the Grafana UI.

## Continue a session

Pass the stored `sessionId` with the next message:

```bash
gcx api "$PLUGIN/api/agent/run" -X POST \
  -d '{
    "sessionId":"SESSION_ID",
    "message":"Focus on the checkout service and propose the likely cause"
  }'
```

## Follow or stop an agent run

```bash
# Poll the current status and final result
gcx api "$PLUGIN/api/agent/runs/RUN_ID"

# Reconnect to its server-sent event stream
gcx api "$PLUGIN/api/agent/runs/RUN_ID/events"

# Cancel a run
gcx api "$PLUGIN/api/agent/runs/RUN_ID/cancel" -X POST
```

For simple agent automation, polling the status endpoint is usually easier than parsing the SSE event stream.

## Call an Ask O11y MCP tool directly

First discover the exact tool name and input schema through `/api/mcp/tools`, then call it:

```bash
gcx api "$PLUGIN/api/mcp/call-tool" -X POST \
  -d '{
    "name":"query_prometheus",
    "arguments":{"query":"up"}
  }'
```

Ask O11y applies RBAC both when listing and executing tools. Do not assume a tool returned for an Admin service account will be available to a Viewer token.

## References

- [GCX raw API access](https://github.com/grafana/gcx#raw-api-access)
- [Ask O11y API reference](https://github.com/Consensys/ask-o11y-plugin#api-reference)
