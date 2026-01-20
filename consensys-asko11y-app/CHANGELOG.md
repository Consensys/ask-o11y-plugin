# Changelog

All notable changes to the Ask O11y Grafana plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-01-XX

Initial release of Ask O11y - AI-powered observability assistant for Grafana.

### Added

#### Core Features
- **Natural Language Query Interface**: Conversational AI assistant for querying metrics, logs, and traces
- **Real-time Streaming Responses**: Live LLM responses with tool execution status updates
- **Interactive Visualizations**: 8 chart types (time series, stats, gauge, table, pie, bar, heatmap, histogram)
- **On-the-fly Visualization Switching**: Change chart types without re-running queries
- **Session Management**: Persistent chat sessions with localStorage support
- **Quick Suggestions**: Context-aware query suggestions based on Grafana environment

#### MCP Integration
- **Model Context Protocol Support**: Integration with MCP servers for extensible tool capabilities
- **56+ Grafana Tools**: Complete dashboard, datasource, alerting, and query management
- **Multiple Transport Types**: Standard MCP, OpenAPI/REST, SSE streaming, HTTP streamable
- **Dynamic Tool Discovery**: Automatic detection of available tools from configured MCP servers
- **Multi-server Aggregation**: Proxy and aggregate tools from multiple MCP servers

#### Security & Access Control
- **Role-Based Access Control (RBAC)**: Admin/Editor full access (56 tools), Viewer read-only (45 tools)
- **Multi-tenant Organization Isolation**: Secure data isolation per user, with sessions organized by organization
- **Grafana Permission Integration**: Respects existing Grafana datasource permissions
- **Secure Credential Storage**: Integration with Grafana's secure storage mechanisms

#### Visualization Features
- **Time Range Controls**: Built-in time picker with common presets
- **Auto-refresh**: Configurable intervals from 5 seconds to 1 hour
- **Query Export**: Copy PromQL/LogQL/TraceQL queries to clipboard
- **Theme Support**: Automatic light/dark theme integration
- **Expandable Charts**: Full-screen chart analysis mode
- **Responsive Design**: Mobile and desktop optimized layouts

#### Developer Experience
- **TypeScript**: Strict type checking with comprehensive type definitions
- **React 18**: Modern React with hooks and functional components
- **Tailwind CSS**: Utility-first styling with Grafana theme integration
- **Go Backend**: High-performance MCP proxy server
- **Comprehensive Testing**: Unit tests (Jest), E2E tests (Playwright), Go tests
- **Hot Module Reload**: Fast development workflow with webpack dev server

#### Data Source Support
- **Prometheus**: PromQL query execution with metric visualization
- **Loki**: LogQL query execution with log exploration
- **Tempo**: TraceQL query execution with trace analysis
- **Generic Datasources**: Query any Grafana datasource through natural language

#### Tool Categories
- **Datasource Operations**: Query, list, test connectivity, health checks
- **Dashboard Management**: Create, update, delete, search, star, snapshot
- **Alert Management**: Configure alerts, silences, notification channels, contact points
- **Query Execution**: Run queries with automatic visualization
- **Resource Discovery**: Search and explore Grafana resources
- **Panel Operations**: Manage dashboard panels and visualizations
- **Folder Management**: Organize dashboards with folder operations
- **User Management**: Query user information and permissions

### Technical Details

#### Frontend Stack
- React 18.2.0 with TypeScript 5.5.4
- Grafana UI Components (@grafana/ui, @grafana/data, @grafana/scenes)
- Tailwind CSS 4.1.12 for styling
- RxJS 7.8.2 for reactive state management
- Model Context Protocol SDK (@modelcontextprotocol/sdk)

#### Backend Stack
- Go 1.23+ with Grafana Plugin SDK
- MCP Go SDK for server integration
- Multi-transport proxy server
- Health monitoring and connection management

#### Build & CI/CD
- Webpack 5 for frontend bundling
- Mage for Go build automation
- Multi-platform builds (Linux amd64/arm64, macOS amd64/arm64, Windows amd64)
- GitHub Actions CI/CD pipeline
- Automated testing and validation
- Plugin signing support

#### Supported Grafana Versions
- Minimum: Grafana 12.1.1
- Tested: Grafana 12.x and Enterprise editions

### Dependencies

#### Plugin Dependencies
- grafana-llm-app: Required for LLM provider integration

#### Key Libraries
- @grafana/* packages: Core Grafana integration
- @modelcontextprotocol/sdk: MCP client functionality
- js-tiktoken: Token counting for LLM context management
- streamdown: Markdown streaming utilities

### Notes
- This is the initial community release
- Requires LLM API key configuration (OpenAI, Anthropic, or compatible provider)
- MCP server configuration required for full functionality
- MIT License

[0.1.0]: https://github.com/Consensys/ask-o11y-plugin/releases/tag/v0.1.0
