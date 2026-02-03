# Ask O11y - AI-Powered Observability Assistant for Grafana

**Ask O11y** transforms how you interact with your observability data. Query metrics, analyze logs, create dashboards, and troubleshoot issues through natural language conversations—no need to write PromQL, LogQL, or navigate complex UIs.

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Grafana](https://img.shields.io/badge/Grafana-%3E%3D12.1.1-orange.svg)](https://grafana.com)
[![CI](https://github.com/Consensys/ask-o11y-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/Consensys/ask-o11y-plugin/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/Consensys/ask-o11y-plugin)](https://github.com/Consensys/ask-o11y-plugin/releases)

---

## What Does This Do?

Ask O11y is a Grafana app plugin that brings AI assistance directly into your observability workflow. Instead of learning complex query languages or navigating multiple dashboards, simply ask questions in plain English:

- "Show me CPU usage across all servers in the last hour"
- "Find error logs from the payment service"
- "Create a dashboard to monitor Kubernetes cluster health"
- "What's causing the spike in response times?"

The assistant understands your Grafana environment, executes the right queries, and presents results with interactive visualizations—all through natural conversation.

---

## Why Is This Useful?

**For SREs and DevOps Engineers:**
- Troubleshoot faster with natural language queries
- No need to memorize PromQL, LogQL, or TraceQL syntax
- Get instant visualizations without building dashboards

**For Platform Teams:**
- Democratize access to observability data across your organization
- Reduce training time for new team members
- Enable non-technical stakeholders to explore metrics and logs

**For Engineering Teams:**
- Reduce mean time to resolution (MTTR) during incidents
- Query multiple data sources (metrics, logs, traces) in one conversation
- Automate common dashboard and alerting tasks

---

## Key Features

### 🤖 Natural Language Observability

**Query Your Data Without Writing Code:**
- Ask questions in plain English and get instant answers
- Support for Prometheus metrics (PromQL), Loki logs (LogQL), and Tempo traces (TraceQL)
- Real-time streaming responses with live tool execution status
- Context-aware suggestions based on your Grafana environment

**Example Queries:**
```
"Show me HTTP request rate grouped by endpoint as a bar chart"
"Find all timeout errors in the last 15 minutes"
"Display memory utilization as a gauge with thresholds"
"Compare CPU usage between production and staging"
```

### 📊 Rich Interactive Visualizations

Get automatic visualizations with every query—no manual dashboard building required:

- **Time Series**: Line graphs for metrics over time
- **Stats**: Single-value statistics with sparklines and trends
- **Gauge**: Visual indicators with configurable thresholds
- **Table**: Sortable, filterable tabular data
- **Pie Chart**: Proportional distributions
- **Bar Chart**: Comparative visualizations (horizontal/vertical)
- **Heatmap**: Density patterns and distributions
- **Histogram**: Value distribution analysis

**Interactive Controls:**
- Switch visualization types on-the-fly (time series → gauge → pie chart)
- Adjust time ranges with built-in time picker
- Configure auto-refresh intervals (5s to 1h)
- Expand charts for detailed analysis
- Copy queries (PromQL/LogQL/TraceQL) to clipboard for reuse
- Automatic light/dark theme support

### 📎 Side Panel Preview

When the assistant generates links to Grafana dashboards or Explore pages, they can be displayed inline in a side panel for seamless navigation.

**Requirements:**
To enable this feature, Grafana must allow embedding. Set the following environment variable:

```bash
GF_SECURITY_ALLOW_EMBEDDING=true
```

See [Grafana documentation on allow_embedding](https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/#allow_embedding) for more details.

### 🔧 Model Context Protocol (MCP) Integration

**Extensible Tool Architecture:**
- **56+ Built-in Grafana Tools**: Complete dashboard, datasource, alerting, and query management
- **Dynamic Tool Discovery**: Automatically detects available tools from configured MCP servers
- **Multiple Transport Types**: Supports standard MCP, OpenAPI/REST, SSE streaming, and HTTP streamable
- **Custom Server Support**: Add your own MCP servers for internal tools and APIs
- **Combined Mode**: Use built-in and external MCP servers simultaneously for maximum flexibility

**Available Tool Categories:**
- **Datasource Operations**: Query, list, test connectivity
- **Dashboard Management**: Create, update, delete, search dashboards
- **Alert Management**: Configure alerts, silences, notification channels
- **Query Execution**: Run PromQL, LogQL, TraceQL queries with visualization
- **Resource Discovery**: Search and explore Grafana resources

### 🔐 Enterprise-Ready Security

**Role-Based Access Control (RBAC):**
- **Admin/Editor**: Full access to all 56 tools (read + write operations)
- **Viewer**: Restricted to 45 read-only tools (query, list, get, search only)
- Automatic permission enforcement on every tool execution
- Granular control over who can modify dashboards, datasources, and alerts

**Multi-Tenant Organization Isolation:**
- Chat sessions stored per-user using Grafana's UserStorage API
- Sessions organized by Grafana organization within each user's storage
- Complete data isolation between users (sessions are private to each user)
- Seamless context switching when changing organizations
- Organization-specific MCP server configurations

**Security Best Practices:**
- Comprehensive input validation and schema validation
- SQL injection and XSS prevention
- Secure credential handling
- Audit logging for all operations

### 💾 Smart Session Management

**Never Lose Your Work:**
- **Auto-Save**: All conversations saved automatically when streaming completes
- **Session History**: Browse, resume, and manage previous conversations
- **Organization Scoping**: Sessions organized by Grafana organization within each user's storage (sessions are private to each user)
- **Import/Export**: Backup sessions as JSON or share with team members
- **Automatic Cleanup**: Oldest sessions removed when storage quota reached
- **Session Metadata**: Auto-generated titles, timestamps, message counts

**Quick Actions:**
- Start new conversations instantly
- Delete individual sessions or clear all
- Search through conversation history
- Export important conversations for documentation

### 🔗 Session Sharing

**Share Conversations with Your Team:**
- **Shareable Links**: Create secure, shareable links for any chat session
- **Flexible Expiration**: Set expiration times (1 hour, 1 day, 7 days, 30 days, 90 days, or never)
- **Read-Only Viewing**: Recipients can view shared sessions in read-only mode
- **Import to Account**: Import shared sessions into your own account for continued conversation
- **Revoke Access**: Revoke share links at any time
- **Rate Limited**: 50 shares per hour per user to prevent abuse
- **Organization Isolation**: Shares are scoped to the organization where they were created

**How It Works:**
1. Click the share button on any session
2. Choose an expiration time (or set to never expire)
3. Copy the generated share link
4. Share the link with team members
5. Recipients can view the session or import it to continue the conversation

### 🔔 Alert Investigation Mode

**One-Click RCA from Alert Notifications:**

Add investigation links to your alert notifications (Slack, OpsGenie, email) for instant root cause analysis.

**URL Format:**
```
/a/consensys-asko11y-app?type=investigation&alertName={alertName}
```

**Slack/Alertmanager Template:**
```go
{{ range .Alerts }}
<{{ $.ExternalURL }}/a/consensys-asko11y-app?type=investigation&alertName={{ .Labels.alertname }}|🔍 Investigate>
{{ end }}
```

When clicked, the plugin automatically creates a new session and starts an AI-powered investigation with the alert context.

### ⚙️ Customizable Configuration

- **System Prompts**: Customize AI behavior (default, replace, or append mode)
- **Token Limits**: Configure maximum tokens for LLM requests
- **MCP Server Management**: Add, configure, enable/disable servers
- **Health Monitoring**: Real-time health checks with status indicators

### ⚡ Performance & Reliability

- Streaming responses with real-time updates
- Efficient storage with smart caching
- Type-safe TypeScript frontend + Go backend
- JSON Schema validation for all operations
- Comprehensive test coverage

---

## Getting Started

### Prerequisites

- **Grafana**: Version 12.1.1 or later
- **Grafana LLM Plugin**: [grafana-llm-app](https://grafana.com/grafana/plugins/grafana-llm-app/) configured with an AI provider
- **Datasources** (recommended):
  - Prometheus for metrics
  - Loki for logs
  - Tempo for traces (optional)

## Installation

### Option 1: Install from Grafana Catalog (Recommended)

Once published to the Grafana plugin catalog, install with one command:

```bash
grafana-cli plugins install consensys-asko11y-app
```

Then restart your Grafana instance.

### Option 2: Manual Installation

#### From GitHub Releases

1. Download the latest release from [GitHub Releases](https://github.com/Consensys/ask-o11y-plugin/releases)
2. Extract to your Grafana plugins directory:
   - Linux: `/var/lib/grafana/plugins/`
   - macOS (Homebrew): `/opt/homebrew/var/lib/grafana/plugins/`
   - Docker: Mount as volume to `/var/lib/grafana/plugins/`
   - Windows: `C:\Program Files\GrafanaLabs\grafana\data\plugins\`
3. Restart Grafana

#### From Source

```bash
git clone https://github.com/Consensys/ask-o11y-plugin.git
cd ask-o11y-plugin
npm install
npm run build
# Copy dist/ to your Grafana plugins directory
```

---

## Configuration

### Quick Setup (5 Minutes)

#### 2. Install & Configure Grafana LLM Plugin

```bash
grafana-cli plugins install grafana-llm-app
```

In Grafana UI:
- Navigate to **Configuration → Plugins → Grafana LLM**
- Click **Enable**
- Configure your AI provider:
  - **OpenAI**: Add API key, select model (gpt-4, gpt-3.5-turbo)
  - **Anthropic**: Add API key, select model (claude-3-opus, claude-3-sonnet)
  - **Other providers**: Follow provider-specific instructions

#### 3. Configure MCP Servers

- Go to **Configuration → Plugins → Ask O11y → Configuration**
- Add MCP Grafana server:
  - **Name**: `grafana`
  - **URL**: Your mcp-grafana endpoint (e.g., `http://mcp-grafana:8000/mcp`)
  - **Type**: `streamable-http`
  - **Enabled**: ✓
- Click **Save**

#### 4. Start Using!

- Navigate to **Apps → Ask O11y**
- Type your first question: "Show me CPU usage in the last hour"
- Watch the magic happen!

---

## Usage Examples

### Metrics & Monitoring

```
"Show me CPU usage across all servers in the last hour"
"Create a gauge showing memory utilization percentage"
"Display HTTP request rate as a bar chart grouped by endpoint"
"Show me a heatmap of response times over the last 24 hours"
```

### Logs & Troubleshooting

```
"Find all error logs from the payment service in the last 15 minutes"
"Show me logs containing 'timeout' from production namespace"
"What are the most common error messages in the last hour?"
"Display recent failed authentication attempts"
```

### Traces & Performance

```
"Show me traces for the checkout API with duration > 500ms"
"Find slow database queries in the last 30 minutes"
"Display a histogram of request latencies"
"Which services have the highest error rates?"
```

### Dashboard Management

```
"Create a dashboard to monitor Kubernetes cluster health"
"Add a time series panel showing 95th percentile latency"
"List all dashboards in the 'Production' folder"
"Search for dashboards related to payments"
```

---

## Architecture

**Frontend:** React + TypeScript with real-time streaming, interactive visualizations, and session management

**Backend:** Go plugin with MCP server aggregation, OpenAPI validation, RBAC, and multi-tenant support

**Integration:** Supports multiple MCP transport types with dynamic tool discovery and health monitoring

---

## Development Setup

Want to contribute or customize the plugin?

### Prerequisites

- Node.js >= 22
- Go >= 1.21
- Docker & Docker Compose
- [Mage](https://magefile.org/) (Go build tool)

### Quick Start

```bash
# Install dependencies
npm install

# Build the plugin
npm run build

# Start development environment
npm run server

# Access Grafana at http://localhost:3000 (admin/admin)
```

### Development Workflow

**Full Development Environment (with hot reload):**
```bash
npm run server
# Starts Docker stack with Grafana + MCP servers + Redis + Alertmanager
# Frontend changes auto-reload via Docker volume mounts
# Backend changes require rebuild (see below)
```

**Backend Development:**
```bash
# Build for current platform
npm run build:backend

# Restart Grafana to load new binary
docker compose restart grafana
```

**Testing:**
```bash
# Frontend unit tests
npm test

# Backend tests
go test ./pkg/...

# E2E tests (requires running server)
npm run e2e
```

**Linting:**
```bash
npm run lint
npm run lint:fix
```

For detailed development documentation, see [AGENTS.md](AGENTS.md).

---

## Configuration

Configure the plugin in **Configuration → Plugins → Ask O11y → Configuration**:

- **System Prompts**: Customize AI behavior (default/replace/append modes)
- **MCP Servers**: Add servers with name, URL, and transport type
- **Health Monitoring**: Automatic health checks every 30 seconds

For self-hosted deployments, see [.env.example](.env.example) for environment variables.

---

## Contributing

We welcome contributions from the community! Whether you're fixing bugs, adding features, improving documentation, or enhancing UI/UX, your help is appreciated.

**Want to contribute?** Please read our [Contributing Guide](CONTRIBUTING.md) for:
- Development setup and workflow
- Code standards and testing guidelines
- Pull request process
- Commit message conventions

**Quick Start for Contributors:**
```bash
# Fork and clone the repository
git clone https://github.com/YOUR_USERNAME/ask-o11y-plugin.git
cd ask-o11y-plugin

# Install dependencies and build
npm install
npm run build

# Start development environment
npm run server
```

**Reporting Issues:**
- Bug reports: [GitHub Issues](https://github.com/Consensys/ask-o11y-plugin/issues)
- Security vulnerabilities: Use GitHub Security Advisory feature (private disclosure)

For detailed contribution guidelines, see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Support & Community

### Getting Help

- **Documentation**: Start with this README and [AGENTS.md](AGENTS.md)
- **Issues**: Report bugs or request features on [GitHub Issues](https://github.com/Consensys/ask-o11y-plugin/issues)
- **Discussions**: Join conversations on [GitHub Discussions](https://github.com/Consensys/ask-o11y-plugin/discussions)

### Troubleshooting

**Common Issues:**

- **"I don't see visualizations"**: Check datasource configuration and time range
- **"Tool execution failed"**: Verify RBAC permissions and MCP server health
- **"Session not loading"**: Ensure correct organization and browser storage is enabled
- **"LLM plugin not found"**: Install and configure grafana-llm-app plugin

For detailed troubleshooting, see the [Troubleshooting Guide](src/README.md#troubleshooting).

---

## Troubleshooting

### Plugin Not Appearing in Grafana

**Issue**: After installation, plugin doesn't appear in Apps menu

**Solutions**:
1. Verify plugin is in the correct directory:
   ```bash
   ls -la /var/lib/grafana/plugins/consensys-asko11y-app/
   ```
2. Check Grafana logs for errors:
   ```bash
   tail -f /var/log/grafana/grafana.log
   ```
3. Ensure plugin signature is valid (for signed plugins):
   ```bash
   grafana-cli plugins ls
   ```
4. Restart Grafana after installation
5. Clear browser cache and hard reload (Cmd/Ctrl + Shift + R)

### LLM Not Responding

**Issue**: Chat interface loads but doesn't respond to queries

**Solutions**:
1. Verify Grafana LLM plugin is installed and enabled
2. Check LLM API key is configured correctly in Grafana LLM settings
3. Verify API key has sufficient quota/credits
4. Check browser console for errors (F12 → Console tab)
5. Ensure network connectivity to LLM provider (OpenAI, Anthropic, etc.)

### MCP Server Connection Errors

**Issue**: "MCP server unavailable" or connection timeout errors

**Solutions**:
1. Verify MCP server URL is accessible from Grafana:
   ```bash
   curl http://mcp-grafana:8000/mcp/health
   ```
2. Check MCP server is running:
   ```bash
   docker ps | grep mcp-grafana
   ```
3. Verify network connectivity between Grafana and MCP server
4. Check MCP server logs for errors
5. Ensure correct transport type is selected (streamable-http, stdio, etc.)

### Visualization Not Displaying

**Issue**: Query executes but chart doesn't render

**Solutions**:
1. Check query returned data (view raw response in browser console)
2. Try switching visualization type (Time Series → Table → Stat)
3. Verify time range includes data
4. Check datasource permissions (user must have query access)
5. Ensure datasource is healthy (test in Grafana Explore)

### Permission Errors

**Issue**: "Insufficient permissions" or "Access denied" errors

**Solutions**:
1. Verify user role:
   - Admin/Editor: Full access (56 tools)
   - Viewer: Read-only access (45 tools)
2. Check datasource permissions in Grafana settings
3. Ensure organization context is correct
4. Review Grafana RBAC policies if using Enterprise

### Session Sharing Issues

**Issue**: Share link not working, expired, or access denied

**Solutions**:
1. **Check Expiration**: Verify the share link hasn't expired (check expiration date)
2. **Organization Context**: Ensure accessing from the same Grafana organization where created
3. **Rate Limit**: Maximum 50 shares per hour per user - wait if limit reached
4. **Share Revoked**: Creator may have revoked the share link
5. **Backend Storage**: If using in-memory storage, shares are lost on Grafana restart (use Redis for persistence)
6. Check Grafana logs: `docker compose logs -f grafana | grep -i share`

### Build or Development Issues

**Issue**: Plugin fails to build or run in development

**Solutions**:
1. Verify Node.js version: `node --version` (requires >= 22)
2. Verify Go version: `go version` (requires >= 1.23)
3. Clear and reinstall dependencies:
   ```bash
   rm -rf node_modules package-lock.json dist
   npm install
   npm run build
   ```
4. Check for port conflicts (dev server uses port 3000)
5. Ensure Mage is installed: `go install github.com/magefile/mage@latest`

### Getting Help

If you're still experiencing issues:

1. **Search Existing Issues**: Check [GitHub Issues](https://github.com/Consensys/ask-o11y-plugin/issues) for similar problems
2. **Enable Debug Logging**: Set `GF_LOG_LEVEL=debug` in Grafana config
3. **Collect Information**:
   - Grafana version
   - Plugin version
   - Browser and OS
   - Error messages from browser console and Grafana logs
4. **Open an Issue**: [Create a new issue](https://github.com/Consensys/ask-o11y-plugin/issues/new) with details

---

## Support

### Community Support

- **GitHub Issues**: [Report bugs and request features](https://github.com/Consensys/ask-o11y-plugin/issues)
- **GitHub Discussions**: [Ask questions and share ideas](https://github.com/Consensys/ask-o11y-plugin/discussions)
- **Contributing**: See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute

### Documentation

- **User Guide**: [src/README.md](src/README.md) - Comprehensive feature documentation
- **Developer Guide**: [AGENTS.md](AGENTS.md) - Architecture and development patterns
- **API Reference**: [Grafana Plugin Documentation](https://grafana.com/developers/plugin-tools/)
- **MCP Protocol**: [Model Context Protocol Specification](https://modelcontextprotocol.io/)

### Security

Found a security vulnerability? Please **do not** open a public issue. Instead:
- Email: security@consensys.net
- See: [CONTRIBUTING.md - Security](CONTRIBUTING.md#security) for our security policy

---

## License

Licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

Built with [Grafana](https://grafana.com/), [Model Context Protocol](https://modelcontextprotocol.io/), [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), and [Go](https://go.dev/).

---

## Additional Resources

- **[CONTRIBUTING.md](CONTRIBUTING.md)**: Contribution guidelines, development setup, and PR process
- **[AGENTS.md](AGENTS.md)**: Comprehensive developer guide with architecture patterns
- **[src/README.md](src/README.md)**: Detailed feature documentation and user guide
- **[CHANGELOG.md](CHANGELOG.md)**: Version history and release notes
- **[.env.example](.env.example)**: Environment variable configuration template
- **[Grafana Plugin Development](https://grafana.com/developers/plugin-tools/)**: Official Grafana documentation

---

**Made with ❤️ by the Consensys Platform Engineering Team**

Got questions or feedback? We'd love to hear from you! Open an issue, join our community, or contribute to make Ask O11y even better.
