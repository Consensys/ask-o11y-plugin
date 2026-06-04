# Ask O11y - Agentic Observability for Grafana

[![Grafana](https://img.shields.io/badge/Grafana-%3E%3D12.3.0-orange)](https://grafana.com)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/Consensys/ask-o11y-plugin/blob/main/LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/Consensys/ask-o11y-plugin)](https://github.com/Consensys/ask-o11y-plugin/releases)

Ask O11y brings an AI investigation agent directly into Grafana. It queries telemetry, calls MCP tools, builds evidence, gates risky actions, and turns live observability data into incident-ready answers.

Instead of jumping between dashboards, Explore, alert rules, runbooks, and service maps, operators can ask a question in plain language and get a traceable investigation with metrics, logs, traces, topology, approvals, and a final RCA report.

![Ask O11y agent overview](https://raw.githubusercontent.com/Consensys/ask-o11y-plugin/v0.2.29/src/img/screenshots/home-page.png)

## Why Teams Use Ask O11y

- **Root cause analysis without tab switching**: investigate alerts, regressions, and performance issues from one Grafana-native workspace.
- **Evidence-first AI answers**: every run records tool calls, telemetry evidence, approval state, and final report context.
- **MCP-powered Grafana automation**: use built-in Grafana MCP tools or connect external MCP servers for multi-org and custom tool setups.
- **Approval-gated writes**: read-only investigations run quickly, while dashboard writes, annotations, destructive operations, and risky tools require explicit approval.
- **Service topology memory**: Graphiti-backed service graph context helps the agent reason about dependencies and incident blast radius.
- **Grafana-aligned controls**: RBAC, plugin settings, secure secrets, theme-safe UI, and backend resource handlers keep the agent inside Grafana's app-plugin model.

## Product Tour

### Live RCA Workspace

Ask O11y plans the investigation, gathers evidence in parallel, and keeps the operator in control when a write action needs approval.

![Live RCA workspace with evidence and approval gate](https://raw.githubusercontent.com/Consensys/ask-o11y-plugin/v0.2.29/src/img/screenshots/chat-interface.png)

### MCP And Service Graph Settings

Admin settings are organized into Grafana-native tabs for general limits, agent runtime, MCP servers, service graph controls, and prompts.

![MCP settings and service graph controls](https://raw.githubusercontent.com/Consensys/ask-o11y-plugin/v0.2.29/src/img/screenshots/mcp-configuration.png)

### Tool Selection Controls

Choose exactly which MCP tools the agent can call. Tool names stay scannable, risk is shown in its own column, and long tool descriptions live behind hover help.

![MCP tool selection modal](https://raw.githubusercontent.com/Consensys/ask-o11y-plugin/v0.2.29/src/img/screenshots/tool-selection.png)

### Service Graph Context

The Service Graph tab shows Graphiti connection status, scan controls, backend-enforced graph limits, and the embedded service topology view used during RCA.

![Service graph settings](https://raw.githubusercontent.com/Consensys/ask-o11y-plugin/v0.2.29/src/img/screenshots/service-graph-settings.png)

### Run Trace And Evidence History

Reopen past investigations with their plan, evidence references, approval events, final report, and operational metrics.

![Run history and traceable evidence](https://raw.githubusercontent.com/Consensys/ask-o11y-plugin/v0.2.29/src/img/screenshots/session-history.png)

## What You Can Ask

- "Investigate the checkout p95 latency alert and tell me if the last deploy is involved."
- "Find error logs for the payment service and link the traces with the longest spans."
- "Show CPU saturation by Kubernetes node for the last two hours."
- "Create an incident annotation for this outage window."
- "Map the checkout service dependencies and identify the most likely blast radius."
- "Build a dashboard panel for the API SLO burn rate."

## Core Capabilities

### Agentic Investigation Loop

Ask O11y runs a planner, step executor, tool scheduler, evidence ledger, approval gate, and final-report synthesizer in the Go backend plugin. Runs stream progressively into the UI with plan, step, evidence, approval, and final-report events.

### Grafana And MCP Tooling

Use the Grafana LLM app and MCP tool ecosystem to query Prometheus, Loki, Tempo, Pyroscope, dashboards, alerting, annotations, folders, RBAC metadata, and other Grafana resources. External MCP servers can be added for multi-org or specialized tools.

### Safe Automation

Viewer, Editor, and Admin access is enforced through Grafana RBAC and Ask O11y's tool risk policy. Read-only tools can run automatically. Write, destructive, open-world, untrusted-server, and external-communication actions can require approval before execution.

### Topology And Memory

Ask O11y can use Graphiti-backed topology and historical incident memory to enrich RCA. The service graph lives in plugin settings with scan controls, connection status, graph limits, and backend-enforced trimming for large graphs.

### Sessions And Sharing

Conversations are saved with history, import, and sharing workflows. Investigation sessions can be reopened with their trace and evidence so teams can audit what the agent saw and decided.

## Requirements

Ask O11y requires:

1. **Grafana 12.3.0 or newer**
2. **Grafana LLM app** installed and configured with an AI provider
3. **Grafana MCP tools**, either through the built-in Grafana MCP integration or an external `mcp-grafana` deployment
4. **Grafana permissions** for the users and service accounts that will run investigations or approve writes

For self-hosted Grafana deployments using managed service accounts, enable the relevant Grafana feature toggles:

```yaml
environment:
  - GF_FEATURE_TOGGLES_ENABLE=externalServiceAccounts
  - GF_AUTH_MANAGED_SERVICE_ACCOUNTS_ENABLED=true
```

Grafana Cloud users generally do not need this self-hosted service-account configuration.

## MCP Setup

### Recommended: Built-In Grafana MCP

1. Open **Administration -> Plugins and data -> Plugins -> Ask O11y -> Configuration**.
2. Go to the **MCP** tab.
3. Enable **Use Built-in Grafana MCP**.
4. Open **Manage tools** to choose which Grafana tools the agent may use.
5. Save the MCP settings.

The built-in Grafana MCP path is best for simple single-org deployments.

### Multi-Org Or Custom Tools: External MCP

Use an external [mcp-grafana](https://github.com/grafana/mcp-grafana) sidecar when you need multi-org behavior, explicit org headers, custom auth, or additional MCP servers.

1. Deploy `mcp-grafana` and point it at your Grafana instance.
2. Add the server in the **MCP** settings tab.
3. Choose `streamable-http`.
4. Add secure headers only through plugin settings.
5. Mark servers as trusted only when you control them.
6. Save and verify the health status.

## Configuration Highlights

- **General**: LLM token budget, kiosk mode, chat panel placement.
- **Agent Runtime**: workflow version, approval policy, max parallel tool calls, eval capture.
- **MCP**: built-in Grafana MCP, external servers, trusted-server controls, secure headers, tool selection.
- **Service Graph**: Graphiti status, topology scan interval, graph build action, max node and edge limits.
- **Prompts**: system, investigation, and performance prompt templates.

Unsaved changes are shown per settings tab so admins know exactly what still needs to be saved.

## High Availability

Ask O11y supports Grafana OSS and does not require Grafana Enterprise for the chat workflow. For multiple Grafana replicas, configure Redis in the Ask O11y plugin provisioning:

```yaml
apps:
  - type: consensys-asko11y-app
    org_id: 1
    jsonData:
      useBuiltInMCP: true
    secureJsonData:
      redisURL: redis://redis:6379/0
```

Redis shares sessions, detached agent runs, share metadata, rate limits, and approval coordination between replicas. If Redis is not configured, in-memory state is local to each Grafana process and users may intermittently see `Agent detached request failed (404): session not found` when load balancing sends related requests to different replicas.

Sticky sessions are an acceptable short-term mitigation, but Redis is the recommended production configuration. See `deploy/helm/` in the repository for Grafana Helm chart examples and optional Graphiti MCP wiring.

## Alert Investigation Links

Add Ask O11y investigation links to Grafana alert notifications for one-click RCA:

```text
/a/consensys-asko11y-app?type=investigation&alertName={alertName}
```

Operators can jump from an alert to a guided investigation, then return to Grafana context such as dashboards, Explore, Alerting, and incident views.

## Security And Operations

- Secrets belong in `secureJsonData`, never in the browser.
- Plugin settings use Grafana-managed configuration.
- Grafana RBAC controls access to read, run, approve, write, memory, and settings actions.
- Tool risk policy separates read-only, write, destructive, untrusted, and externally communicating tools.
- Agent observability can be captured through run traces, tool errors, approval waits, and eval results.

## Troubleshooting

See [TROUBLESHOOTING.md](https://github.com/Consensys/ask-o11y-plugin/blob/main/TROUBLESHOOTING.md) for help with Grafana Cloud, self-hosted deployment, permissions, MCP connection issues, service accounts, and common plugin problems.

## Support

- [GitHub Issues](https://github.com/Consensys/ask-o11y-plugin/issues)
- [GitHub Discussions](https://github.com/Consensys/ask-o11y-plugin/discussions)
- Security issues: use GitHub Security Advisory for private disclosure

## License

MIT License. See [LICENSE](https://github.com/Consensys/ask-o11y-plugin/blob/main/LICENSE).
