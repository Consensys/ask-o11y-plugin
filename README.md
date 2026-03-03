# Ask O11y - AI-Powered Observability Assistant for Grafana

**Ask O11y** is a Grafana app plugin that brings AI assistance into your observability workflow. Query metrics, analyze logs, create dashboards, and troubleshoot issues through natural language—no need to write PromQL, LogQL, or navigate complex UIs.

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Grafana](https://img.shields.io/badge/Grafana-%3E%3D12.1.1-orange.svg)](https://grafana.com)
[![CI](https://github.com/Consensys/ask-o11y-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/Consensys/ask-o11y-plugin/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/Consensys/ask-o11y-plugin)](https://github.com/Consensys/ask-o11y-plugin/releases)

---

## Prerequisites

**Ask O11y requires:**

1. **Grafana LLM Plugin** — installed and configured with an AI provider (OpenAI, Anthropic, etc.)
2. **Grafana Service Account** — used to authenticate LLM calls and MCP tool execution
3. **Grafana MCP Server** — either the built-in toggle (Org 1 only) or an external mcp-grafana instance

Without these, the plugin will not work. See [User Guide](src/README.md) for setup instructions.

---

## Quick Start

### For End Users

See the [User Guide](src/README.md) for installation and configuration.

### For Developers

```bash
git clone https://github.com/Consensys/ask-o11y-plugin.git
cd ask-o11y-plugin
npm install
npm run server
# Access Grafana at http://localhost:3000 (admin/admin)
```

See [AGENTS.md](AGENTS.md) for detailed development documentation.

---

## Features

- **Natural Language Queries**: Prometheus (PromQL), Loki (LogQL), Tempo (TraceQL)
- **8 Visualization Types**: Time Series, Stats, Gauge, Table, Pie Chart, Bar Chart, Heatmap, Histogram
- **MCP Integration**: 56+ built-in Grafana tools, dynamic tool discovery, custom server support
- **RBAC**: Admin/Editor (full access) vs Viewer (read-only), enforced per operation
- **Session Management**: Auto-save, history, sharing with expiration, import shared sessions
- **Alert Investigation**: One-click RCA from alert notifications
- **Organization Isolation**: Sessions and data scoped per Grafana org

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   React UI      │────▶│   Go Backend     │────▶│  MCP Servers    │
│   (Frontend)    │◀────│   (Plugin)       │◀────│  (Grafana API)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │  Grafana LLM     │
                        │  (AI Provider)   │
                        └──────────────────┘
```

**Frontend:** React + TypeScript, real-time streaming, interactive visualizations

**Backend:** Go plugin, MCP aggregation, RBAC, multi-tenant support

**Integration:** Multiple MCP transport types with dynamic tool discovery

---

## API Reference

OpenAPI 3.0.3 spec available at: `/api/plugins/consensys-asko11y-app/resources/openapi.json`

Key endpoints:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/agent/run` | Start AI conversation (SSE streaming) |
| GET | `/api/sessions` | List user sessions |
| GET | `/api/mcp/tools` | List available MCP tools (RBAC-filtered) |
| POST | `/api/mcp/call-tool` | Execute MCP tool |
| POST | `/api/sessions/share` | Create share link |

All endpoints require Grafana session authentication. See the OpenAPI spec for the full list.

---

## Development

### Prerequisites

- Node.js >= 22
- Go >= 1.21
- Docker & Docker Compose
- [Mage](https://magefile.org/)

### Commands

```bash
npm run build                # Full production build
npm run build:frontend:prod  # Frontend only
npm run build:backend        # Backend only (current platform)
mage buildAll                # Backend all platforms

npm test                     # Frontend tests (watch)
npm run test:ci              # Frontend tests (CI)
go test ./pkg/...            # Backend tests
npm run e2e                  # E2E tests

npm run lint                 # Lint
npm run lint:fix             # Lint + format
```

### Workflow

1. **Frontend changes**: Auto-reload via Docker volume mounts when using `npm run server`
2. **Backend changes**: Rebuild and restart:
   ```bash
   npm run build:backend
   docker compose restart grafana
   ```

See [AGENTS.md](AGENTS.md) for detailed development documentation.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code standards, testing guidelines, and PR process.

---

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for:

- Grafana Cloud issues
- Self-hosted / Docker issues
- Common problems across all deployments

---

## Support

- **User Guide**: [src/README.md](src/README.md)
- **Developer Guide**: [AGENTS.md](AGENTS.md)
- **Bug Reports**: [GitHub Issues](https://github.com/Consensys/ask-o11y-plugin/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Consensys/ask-o11y-plugin/discussions)
- **Security**: GitHub Security Advisory (private disclosure)

---

## License

MIT License - see [LICENSE](LICENSE) for details.
