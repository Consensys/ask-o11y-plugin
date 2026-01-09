# Ask O11y

[![Grafana](https://img.shields.io/badge/Grafana-%3E%3D12.1.1-orange)](https://grafana.com)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/Consensys/ask-o11y-plugin/blob/main/LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/Consensys/ask-o11y-plugin)](https://github.com/Consensys/ask-o11y-plugin/releases)

## Overview

Ask O11y is an AI-powered Grafana plugin that transforms how you interact with your observability data. Through natural language conversations, you can query metrics, analyze logs and traces, create visualizations, and manage dashboards—all without writing a single line of PromQL, LogQL, or TraceQL.

## Key Features

### 🤖 **Conversational Observability**

- **Natural Language Queries**: Ask questions in plain English and get instant answers with visualizations
- **Multi-Signal Support**: Query Prometheus metrics (PromQL), Loki logs (LogQL), and Tempo traces (TraceQL)
- **Real-Time Streaming**: See responses appear as they're generated with live tool execution status
- **Inline Visualizations**: Metrics and queries are automatically rendered with interactive charts
- **Context-Aware**: The assistant understands your Grafana environment and suggests relevant queries

### 📊 **Rich Visualization Support**

The assistant can automatically generate and render 8 different visualization types:

- **Time Series**: Standard line graphs for metrics over time
- **Stats**: Single value statistics with sparklines
- **Gauge**: Visual indicators for current values with thresholds
- **Table**: Tabular data display with sorting and filtering
- **Pie Chart**: Proportional distribution visualization
- **Bar Chart**: Comparative bar graphs (horizontal/vertical)
- **Heatmap**: Density and distribution patterns over time
- **Histogram**: Data distribution across value ranges

You can switch between visualization types on-the-fly using the built-in visualization selector.

### 🔧 **Model Context Protocol (MCP) Integration**

- **Dynamic Tool Discovery**: Automatically detects available tools from configured MCP servers
- **Multiple Transport Types**: Supports standard MCP, OpenAPI/REST, SSE streaming, and HTTP streamable endpoints
- **56+ Grafana Tools**: Comprehensive dashboard, datasource, alerting, and query management
- **Extensible Architecture**: Add custom MCP servers for your internal tools and APIs

### 🔐 **Enterprise-Ready Security**

- **Role-Based Access Control (RBAC)**:
  - **Admin/Editor**: Full access to all 56 Grafana tools (read/write operations)
  - **Viewer**: Restricted to 45 read-only tools (query, list, get, search operations only)
  - Automatic permission enforcement on every tool execution
- **Organization Isolation**:
  - Chat sessions automatically scoped per Grafana organization
  - Seamless context switching when changing organizations
  - Complete data isolation between orgs
- **Input Validation**: Comprehensive schema validation, SQL injection prevention, XSS protection

### 🎨 **Interactive Visualizations**

- **Time Range Control**: Select custom time ranges for all visualizations using the built-in time picker
- **Refresh Intervals**: Configure auto-refresh (5s to 1h intervals) for real-time monitoring
- **Expand/Collapse**: Maximize charts for detailed analysis or minimize to save space
- **Copy to Clipboard**: One-click copy of queries (PromQL, LogQL, TraceQL) for reuse
- **Visualization Switching**: Change chart types without re-querying (timeseries → gauge → pie chart, etc.)
- **Responsive Design**: Charts adapt to your screen size and Grafana theme (light/dark mode)

### 💾 **Smart Session Management**

- **Auto-Save**: All conversations automatically saved every 2 seconds (never lose your work)
- **Organization Scoping**: Sessions automatically isolated per Grafana organization
- **Session History**: Browse, resume, and manage previous conversations
- **Import/Export**: Backup sessions as JSON or share with team members
- **Storage Management**: Automatic cleanup when quota is reached (oldest sessions removed first)
- **Quick Actions**: New chat, clear all sessions, delete individual conversations
- **Session Metadata**: Auto-generated titles, timestamps, and message counts

### ⚙️ **Customizable Configuration**

- **System Prompts**: Customize the AI behavior with three modes:
  - **Default**: Use the built-in system prompt optimized for observability
  - **Replace**: Completely replace with your custom instructions
  - **Append**: Add your custom instructions to the default prompt
- **Token Limits**: Configure maximum tokens for LLM requests (default: 50,000)
- **MCP Server Management**: Add, configure, and enable/disable MCP servers
- **Server Health Monitoring**: Real-time health checks every 30 seconds with status indicators

## Technical Highlights

### **Built for Performance**

- ⚡ **Streaming Responses**: See answers appear in real-time as they're generated
- 🔄 **Auto-Save**: 2-second debounced saves prevent data loss
- 📦 **Efficient Storage**: Smart caching and automatic cleanup
- 🎨 **Smooth UI**: Optimized React components with proper memoization
- 🔌 **Lazy Loading**: Fast initial load times

### **Enterprise-Grade Reliability**

- 🔒 **Type-Safe**: TypeScript frontend (strict mode) + Go backend
- ✅ **Validated**: JSON Schema validation for all tool arguments
- 🛡️ **Secure**: Input sanitization, XSS prevention, SQL injection protection
- 🏗️ **Clean Architecture**: Repository pattern, service layer, domain models
- 🧪 **Tested**: Comprehensive unit and integration tests

## Requirements

- **Grafana**: Version 12.1.1 or later
- **Grafana LLM Plugin**: [grafana-llm-app](https://grafana.com/grafana/plugins/grafana-llm-app/) configured with an AI provider (OpenAI, Anthropic, etc.)
- **Datasources** (recommended):
  - **Prometheus**: For metrics and PromQL queries
  - **Loki**: For log aggregation and LogQL queries
  - **Tempo** (optional): For distributed tracing and TraceQL queries
- **MCP Servers**: At least one MCP server configured (e.g., mcp-grafana for Grafana API access)

## Getting Started

### Quick Start (5 Minutes)

1. **Install the Plugin**:

   ```bash
   grafana-cli plugins install consensys-asko11y-app
   ```

   Or manually upload the plugin directory to your Grafana plugins folder, then restart Grafana.

2. **Install & Configure Grafana LLM Plugin**:

   ```bash
   grafana-cli plugins install grafana-llm-app
   ```

   Then in Grafana UI:

   - Go to **Configuration → Plugins → Grafana LLM**
   - Click **Enable**
   - Configure your AI provider:
     - **OpenAI**: Add API key and select model (gpt-4, gpt-3.5-turbo, etc.)
     - **Anthropic**: Add API key and select model (claude-3-opus, claude-3-sonnet, etc.)
     - **Other providers**: Follow provider-specific setup

3. **Configure Datasources** (if not already done):

   - **Prometheus**: Add URL (e.g., `http://prometheus:9090`)
   - **Loki**: Add URL (e.g., `http://loki:3100`)
   - **Tempo** (optional): Add URL (e.g., `http://tempo:3200`)
   - Test each datasource to ensure connectivity

4. **Configure MCP Servers**:

   - Go to **Configuration → Plugins → Consensys Ask O11y Assistant → Configuration**
   - Add MCP Grafana server:
     - **Name**: `grafana`
     - **URL**: Your mcp-grafana endpoint (e.g., `http://mcp-grafana:8000/mcp`)
     - **Type**: `streamable-http`
     - **Enabled**: ✅
   - Click **Save**

5. **Start Using!**:

   - Navigate to **Apps → Consensys Ask O11y Assistant**
   - Type your first question: "Show me CPU usage in the last hour"
   - Watch the magic happen! ✨

### Usage Examples

#### **Metrics & Monitoring**

```
"Show me CPU usage across all servers in the last hour"
"Create a gauge showing memory utilization percentage"
"Display HTTP request rate as a bar chart grouped by endpoint"
"Show me a heatmap of response times over the last 24 hours"
```

#### **Logs & Troubleshooting**

```
"Find all error logs from the payment service in the last 15 minutes"
"Show me logs containing 'timeout' from production namespace"
"What are the most common error messages in the last hour?"
```

#### **Traces & Performance**

```
"Show me traces for the checkout API with duration > 500ms"
"Find slow database queries in the last 30 minutes"
"Display a histogram of request latencies"
```

#### **Dashboard Management**

```
"Create a dashboard to monitor Kubernetes cluster health"
"Add a time series panel showing 95th percentile latency"
"List all dashboards in the 'Production' folder"
"Search for dashboards related to payments"
```

#### **Custom Visualizations**

```
"Show error rate as a pie chart grouped by service"
"Create a table of top 10 slowest endpoints"
"Display memory usage with gauge visualization and thresholds"
"Show request count as a histogram distribution"
```

#### **Time-Based Queries**

```
"Show me metrics from 2 hours ago to 1 hour ago"
"Display the last 5 minutes of data"
"Show me a comparison between today and yesterday"
```

## Documentation

For detailed information about using and developing Ask O11y:

- **[User Guide](https://github.com/Consensys/ask-o11y-plugin/blob/main/README.md)** - Complete installation and usage guide
- **[Contributing Guide](https://github.com/Consensys/ask-o11y-plugin/blob/main/CONTRIBUTING.md)** - Development setup, code standards, and PR process
- **[Developer Documentation](https://github.com/Consensys/ask-o11y-plugin/blob/main/CLAUDE.md)** - Build commands, architecture, and technical details
- **[Architecture Guide](https://github.com/Consensys/ask-o11y-plugin/blob/main/AGENTS.md)** - Detailed agent architecture and implementation
- **[Changelog](https://github.com/Consensys/ask-o11y-plugin/blob/main/CHANGELOG.md)** - Version history and release notes

For additional help:
- Report issues on [GitHub Issues](https://github.com/Consensys/ask-o11y-plugin/issues)
- Join discussions on [GitHub Discussions](https://github.com/Consensys/ask-o11y-plugin/discussions)

## What You Can Do

### 📊 Query & Visualize (All Users)

- **Metrics**: Query Prometheus with natural language, get instant PromQL queries with visualizations
- **Logs**: Search Loki logs using natural language, see formatted log results
- **Traces**: Find distributed traces in Tempo with simple questions
- **Custom Views**: Switch between 8 visualization types for any metric query
- **Time Control**: Adjust time ranges and refresh intervals for any visualization
- **Export Queries**: Copy generated PromQL/LogQL/TraceQL for use elsewhere

### 🎛️ Manage Dashboards (Admin/Editor)

- **Create Dashboards**: "Create a dashboard for monitoring my API"
- **Add Panels**: "Add a panel showing error rate by endpoint"
- **Update Configurations**: "Change the refresh interval to 5 seconds"
- **Organize**: Create folders, move dashboards, manage permissions
- **Delete**: Remove outdated dashboards and panels

### 🔍 Explore & Discover (All Users)

- **Search**: "Find all dashboards related to Kubernetes"
- **List Resources**: "Show me all available datasources"
- **Get Details**: "What panels are in the 'Production Metrics' dashboard?"
- **Analyze**: "Which datasources are being used the most?"

### ⚙️ Configure (Admin Only)

- **MCP Servers**: Add and configure custom MCP servers for extended functionality
- **System Prompts**: Customize AI behavior for your team's needs
- **Token Limits**: Control LLM usage and costs
- **Health Monitoring**: Monitor MCP server status and performance

## How It Works

### 🗨️ Chat Interface

1. **Ask Anything**: Type your question in natural language
2. **Watch It Work**: See the AI select and execute tools in real-time
3. **Get Results**: Receive answers with embedded visualizations
4. **Iterate**: Refine your query or ask follow-up questions

The assistant automatically:

- Parses your intent
- Selects the appropriate tools (PromQL queries, dashboard operations, etc.)
- Executes them with proper permissions
- Renders results with the best visualization type
- Saves the conversation to your session history

### 💬 Session Management

**Your conversations are automatically saved and organized:**

- ✅ **Auto-Save**: Every message saved automatically (2-second debounce)
- 🏢 **Org Scoped**: Sessions isolated per Grafana organization
- 📚 **History**: Browse and resume any previous conversation
- 📤 **Export/Import**: Backup sessions as JSON files
- 🧹 **Auto-Cleanup**: When storage is full, oldest sessions are removed
- 🔒 **Private**: Each organization has its own isolated storage (5MB limit)

**Managing Sessions:**

- Click "New Chat" to start fresh
- Select from sidebar to resume previous conversations
- Use "Clear All" to delete all sessions (with confirmation)
- Export individual sessions for backup or sharing

## Configuration

### Accessing Configuration (Admin Only)

Navigate to **Configuration → Plugins → Consensys Ask O11y Assistant → Configuration**

### System Prompt Settings

Customize how the AI assistant behaves:

1. **Default Mode** (Recommended): Uses the built-in prompt optimized for observability tasks
2. **Replace Mode**: Replace the default prompt entirely with your custom instructions
3. **Append Mode**: Add your custom instructions to the default prompt

**Example Custom Prompts:**

```
"Always include units in metric queries (e.g., 'bytes', 'requests/sec')"
"Prefer bar charts over time series when comparing discrete values"
"When showing error rates, always calculate as a percentage"
```

### Token Limit Configuration

- **Default**: 50,000 tokens (recommended for most use cases)
- **Minimum**: 1,000 tokens
- Adjust based on conversation length needs and LLM provider limits

### MCP Server Configuration

**Adding a New MCP Server:**

1. Click "Add MCP Server"
2. Enter server details:
   - **Name**: Friendly name (e.g., "Grafana Tools")
   - **URL**: Server endpoint (e.g., `http://mcp-grafana:8000/mcp`)
   - **Type**: Select transport type:
     - `openapi` - OpenAPI 3.1.0 REST endpoints
     - `streamable-http` - HTTP with streaming support
     - `sse` - Server-Sent Events
     - `standard` - Standard MCP protocol
   - **Enabled**: Toggle to enable/disable
3. Save configuration

**Health Monitoring:**

- Servers are checked every 30 seconds
- Status indicators: 🟢 Healthy | 🟡 Degraded | 🔴 Unhealthy | ⚫ Disconnected
- View detailed health metrics in the server list

## For Developers

Want to contribute or customize the plugin? See the development documentation:

- **[CLAUDE.md](https://github.com/Consensys/ask-o11y-plugin/blob/main/CLAUDE.md)**: Complete developer guide with build commands and architecture
- **[agent.md](https://github.com/Consensys/ask-o11y-plugin/blob/main/agent.md)**: Detailed agent architecture and technical implementation
- **[REFACTORING.md](https://github.com/Consensys/ask-o11y-plugin/blob/main/REFACTORING.md)**: Clean architecture patterns and migration guide

**Quick Dev Setup:**

```bash
# Install dependencies
npm install

# Start development environment
npm run dev              # Frontend with hot reload
npm run server           # Full Docker stack (Grafana + MCP servers)

# Build
npm run build            # Full build (frontend + backend)
npm run build:frontend   # Frontend only
mage build               # Backend only

# Test
npm test                 # Frontend tests
go test ./pkg/...        # Backend tests
```

## Troubleshooting

### Common Issues & Solutions

#### "I don't see any visualizations"

**Possible Causes:**

- Query returned no data for the selected time range
- Datasource is not properly configured or unreachable
- MCP Grafana server is not responding

**Solutions:**

1. Check the time range - try expanding it (e.g., "last 24 hours" instead of "last 5 minutes")
2. Verify your datasource is configured in Grafana and accessible
3. Check MCP server health in Configuration page
4. Look at the tool execution results - they may show specific errors

#### "Tool execution failed" or "Permission denied"

**Possible Causes:**

- Your user role doesn't have permission for write operations
- MCP server is unavailable or misconfigured
- Invalid parameters passed to the tool

**Solutions:**

1. **Viewer Role?** You can only use read operations (query, list, get, search). Ask an Admin/Editor to perform write operations.
2. **Check Tool Requirements:** Some tools need specific parameters - the error message will indicate what's missing
3. **Verify MCP Health:** Go to Configuration → check server status indicators

#### "Storage quota exceeded" or "Can't save session"

**Automatic Fix:**

- The system automatically removes the 10 oldest sessions when storage is full
- Max 50 sessions per organization

**Manual Fix:**

1. Go to session sidebar
2. Delete old or unnecessary sessions
3. Export important sessions before deleting
4. Check browser localStorage is not disabled

#### "Grafana LLM plugin not found"

**Solutions:**

1. Install the Grafana LLM plugin: `grafana-cli plugins install grafana-llm-app`
2. Enable the plugin in Grafana UI: Configuration → Plugins → Grafana LLM
3. Configure your AI provider (OpenAI, Anthropic, etc.) with valid API keys
4. Restart Grafana after configuration

#### "Session not loading" or "Chat history disappeared"

**Solutions:**

1. Check you're in the correct Grafana organization (sessions are org-scoped)
2. Verify browser localStorage is enabled and not in private/incognito mode
3. Check browser console (F12) for errors
4. Try refreshing the page
5. Check if session file was accidentally deleted

#### "Visualizations are blank or loading forever"

**Solutions:**

1. Check browser console (F12) for JavaScript errors
2. Verify datasource credentials and connectivity
3. Try a simpler query first (e.g., "show me a simple metric")
4. Check time range - very large ranges can timeout
5. Refresh the page to reset the visualization state

### Getting Help

**Enable Debug Mode:**

1. Open browser DevTools (F12)
2. Go to Console tab
3. Run: `localStorage.setItem('debug', 'grafana-o11y:*')`
4. Reload the page
5. Check console for detailed logs
6. Copy error messages when reporting issues

**Reporting Issues:**

When reporting issues, please include:

- Error message (exact text)
- Your Grafana version
- Your user role (Admin/Editor/Viewer)
- Browser and version
- Steps to reproduce
- Screenshots if applicable
- Debug console logs (if possible)

## Support & Community

### Get Help

- 📖 **Documentation**: Check this README and [CLAUDE.md](https://github.com/Consensys/ask-o11y-plugin/blob/main/CLAUDE.md) for detailed guides
- 🐛 **Bug Reports**: [GitHub Issues](https://github.com/Consensys/ask-o11y-plugin/issues)
- 💬 **Community**: [GitHub Discussions](https://github.com/Consensys/ask-o11y-plugin/discussions)
- 📧 **Security Issues**: Use GitHub Security Advisory feature (private disclosure)

### Contributing

We welcome contributions! Whether it's:

- 🐛 Bug fixes
- ✨ New features
- 📝 Documentation improvements
- 🎨 UI/UX enhancements

Please read our [Contributing Guide](https://github.com/Consensys/ask-o11y-plugin/blob/main/CONTRIBUTING.md) for detailed information on:
- Development setup and workflow
- Code standards and testing guidelines
- Pull request process
- Commit message conventions

For development setup, see [CLAUDE.md](https://github.com/Consensys/ask-o11y-plugin/blob/main/CLAUDE.md).

**Code Standards:**

- TypeScript strict mode (no `any` types)
- Go with `golangci-lint` passing
- Unit tests for new features
- Clear commit messages

## License & Acknowledgments

Licensed under **MIT License** - see [LICENSE](https://github.com/Consensys/ask-o11y-plugin/blob/main/LICENSE) file.

**Built with amazing open source tools:**

- [Grafana](https://grafana.com/) & [Grafana Plugin SDK](https://grafana.com/developers/plugin-tools/)
- [Grafana LLM Plugin](https://grafana.com/grafana/plugins/grafana-llm-app/)
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Go](https://go.dev/)

---

**Made with ❤️ by the Consensys Observability Team**

Got questions or feedback? We'd love to hear from you! Open an issue or join our community.
