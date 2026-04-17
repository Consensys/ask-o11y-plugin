# Ask O11y - AI-Powered Observability Assistant

[![Grafana](https://img.shields.io/badge/Grafana-%3E%3D12.1.1-orange)](https://grafana.com)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/Consensys/ask-o11y-plugin/blob/main/LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/Consensys/ask-o11y-plugin)](https://github.com/Consensys/ask-o11y-plugin/releases)

## Overview

Ask O11y is an AI-powered Grafana app that lets you query metrics, analyze logs, create dashboards, and troubleshoot issues through natural language conversations—no need to write PromQL, LogQL, or TraceQL.

Simply ask questions like:
- "Show me CPU usage across all servers in the last hour"
- "Find error logs from the payment service"
- "Create a dashboard to monitor Kubernetes cluster health"
- "What's causing the spike in response times?"

---

## Prerequisites

**Before installing Ask O11y, you must have:**

### 1. Grafana LLM Plugin (Required)

Ask O11y requires the [Grafana LLM plugin](https://grafana.com/grafana/plugins/grafana-llm-app/) to be installed and configured with an AI provider.

**Setup:**
1. Install the Grafana LLM plugin from the Grafana catalog
2. Enable it in **Configuration → Plugins → Grafana LLM**
3. Configure your AI provider (OpenAI, Anthropic, etc.) with a valid API key

### 2. Enable Service Account Feature (Self-Hosted Grafana)

If you're running Grafana on-premises or in Docker, you need to enable external service accounts:

```yaml
# In your docker-compose.yaml or Grafana configuration
environment:
  - GF_FEATURE_TOGGLES_ENABLE=externalServiceAccounts
  - GF_AUTH_MANAGED_SERVICE_ACCOUNTS_ENABLED=true
```

**Note for Grafana Cloud users:** Service accounts are enabled by default. Skip this step.

### 3. Grafana MCP Server (Required)

**Important:** Ask O11y requires a configured Grafana MCP server that provides the tools that allow Ask O11y to interact with your Grafana instance (query datasources, create dashboards, manage alerts, etc.).

**Setup Steps:**

There are two ways to set this up:

**Option A: Use the Built-in Grafana MCP toggle (RECOMMENDED)**

1. Go to **Configuration → Plugins → Ask O11y → Configuration**
2. Enable the **Use Built-in Grafana MCP** toggle
3. Click **Save**

This automatically uses the MCP server provided by grafana-llm-app.

**Option B: Configure an external MCP server (only required for multi-org grafana deployments )**

Use this option if you are on a multi-org Grafana instance:
1. deploy [Grafana MCP](https://github.com/grafana/mcp-grafana) and configure it to point at your grafana instance, *without* setting GRAFANA_ORG_ID
2. Go to **Configuration → Plugins → Ask O11y → Configuration**
3. Under **MCP Servers**, add a new server:
   - **Name**: `grafana` (or any descriptive name)
   - **URL**: Your Grafana MCP endpoint
     - Self-hosted / Docker: `http://mcp-grafana-host:mcp-grafana-port/mcp`
   - **Type**: `streamable-http`
   - **Enabled**: ✓ (checked)
4. Click **Save**
5. Verify the server shows as **Healthy** in the status indicators

---

## Installation

1. In Grafana, go to **Administration → Plugins and data → Plugins**
2. Search for "Ask O11y"
3. Click **Install**
4. Navigate to **Apps → Ask O11y**

For manual installation, download from [GitHub Releases](https://github.com/Consensys/ask-o11y-plugin/releases) and extract to your Grafana plugins directory.

---

## Quick Start

1. Navigate to **Apps → Ask O11y**
2. Click **New Chat**
3. Ask a question: *"Show me CPU usage in the last hour"*

---

## Features

### Natural Language Queries

- **Metrics**: "Show me HTTP request rate grouped by endpoint"
- **Logs**: "Find all timeout errors in the last 15 minutes"
- **Traces**: "Show traces for the checkout API with duration > 500ms"
- **Dashboards**: "Create a dashboard to monitor Kubernetes cluster health"

### Visualizations

8 chart types with on-the-fly switching: Time Series, Stats, Gauge, Table, Pie Chart, Bar Chart, Heatmap, Histogram.

### Role-Based Access Control

- **Admin/Editor**: Full access to all tools
- **Viewer**: Read-only access

Permissions are enforced on every operation.

### Session Management

- Auto-save conversations
- Browse and resume history
- Share with expiration dates (1h, 1d, 7d, 30d, 90d, or never)
- Import shared sessions to your own account

### Alert Investigation

Add investigation links to alert notifications for one-click root cause analysis:

```
/a/consensys-asko11y-app?type=investigation&alertName={alertName}
```

---

## Configuration

Access at **Configuration → Plugins → Ask O11y → Configuration** (Admin only).

### LLM Settings

Configure maximum tokens for LLM requests (default: 128,000, range: 1,000–200,000).

### MCP Server Management

Add external MCP servers with per-server name, URL, type, authentication headers, and enable/disable toggles. Health status is shown for each server.

### Prompt Templates

Customize three prompts: **System Prompt** (base AI instructions), **Investigation Prompt** (alert investigation template), and **Performance Prompt** (performance analysis template). Each can be edited or reset to defaults.

### Display Settings

- **Kiosk Mode**: Hide Grafana navigation bars in embedded pages (on by default)
- **Chat Panel Position**: Left or right (right by default)

---

## REST API

Ask O11y exposes a REST API for programmatic access. The OpenAPI 3.0.3 spec is served at `/api/plugins/consensys-asko11y-app/resources/openapi.json`.

For the full endpoint reference, see the [REST API Reference](https://github.com/Consensys/ask-o11y-plugin/blob/main/CONTRIBUTING.md#rest-api-reference) in the contributing guide.

---

## Troubleshooting

See [TROUBLESHOOTING.md](https://github.com/Consensys/ask-o11y-plugin/blob/main/TROUBLESHOOTING.md) for help with:

- Grafana Cloud issues
- Self-hosted / Docker issues
- Common problems (plugin not responding, permissions, visualizations, session sharing)

---

## Getting Help

- **Bug Reports**: [GitHub Issues](https://github.com/Consensys/ask-o11y-plugin/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Consensys/ask-o11y-plugin/discussions)
- **Security Issues**: Use GitHub Security Advisory (private disclosure)

---

## License

MIT License - see [LICENSE](https://github.com/Consensys/ask-o11y-plugin/blob/main/LICENSE) for details.
