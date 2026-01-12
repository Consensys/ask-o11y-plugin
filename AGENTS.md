# AGENTS.md

This file provides context and instructions to help AI agents work effectively on this project.

## Project Overview

**Consensys Ask O11y Assistant** is a Grafana plugin providing AI-powered observability through natural language conversations. It uses Model Context Protocol (MCP) to integrate with observability tools for querying metrics, logs, and managing Grafana resources.

**Key Architecture:**

- **Frontend:** React 18.2 + TypeScript (strict), Grafana UI components, Tailwind CSS
- **Backend:** Go 1.21+, Grafana Plugin SDK, MCP server integration
- **Pattern:** Clean Architecture with Repository Pattern (frontend), standard Grafana plugin architecture (backend)

**Core Features:**

- Conversational interface for observability data
- MCP integration for extensible tool capabilities
- Role-based access control (Admin, Editor, Viewer)
- Multi-tenant organization isolation
- Real-time streaming LLM responses
- Session persistence in localStorage

## Build and Test Commands

### Setup & Development

```bash
# Initial setup
npm install

# Frontend development (hot reload)
npm run dev

# Backend development
mage build                    # Current platform
npm run build:backend:all     # All platforms

# Start environment
npm run server                # Docker: Grafana + MCP servers + Alertmanager

# After backend changes
docker compose restart grafana
docker compose logs -f grafana
```

### Building

```bash
# Full build (frontend + backend, all platforms)
npm run build

# Component builds
npm run build:frontend        # Frontend only
npm run build:backend         # Backend (current platform)
mage buildAll                 # Backend (all platforms)

# Backend binary naming: gpx_consensys-asko11y-app_{os}_{arch}
# Example: gpx_consensys-asko11y-app_linux_arm64
```

### Testing & Quality Checks

```bash
# Tests
npm test                      # Unit tests (watch mode)
npm run test:ci              # Unit tests (CI mode)
npm run e2e                  # E2E tests (requires running server)
go test ./pkg/...            # Go tests
mage test                    # Go tests via Mage

# Code quality
npm run lint                 # Check linting
npm run lint:fix             # Auto-fix linting issues
npm run typecheck            # TypeScript type checking
```

**Testing guidelines:**

- Unit tests: Jest + React Testing Library in `/tests` directory
- E2E tests: Playwright against running Grafana instance
- Use data-testid attributes from `src/components/testIds.ts`
- Test RBAC with different roles (Admin, Editor, Viewer)

## Code Style Guidelines

### Formatting & Conventions

- **Linter:** `@grafana/eslint-config` with Prettier
- **Indentation:** 2 spaces, semicolons required, single quotes preferred
- **Components:** PascalCase (`ChatMessage`, `MessageList`)
- **Files:** camelCase for components (`ChatMessage.tsx`), kebab-case for configs (`docker-compose.yaml`)
- **Variables/functions:** camelCase (`executeQuery`, `isValidQuery`)
- **Constants:** SCREAMING_SNAKE_CASE (`OPENAI_API_KEY`)

### Architecture Patterns

**Frontend (React + TypeScript):**

- Functional components with hooks (no class components)
- Custom hooks for business logic: `useChat`, `useSessionManager`, `useMCPManager`
- Use memoization: `useMemo`, `useCallback` for performance
- Strong typing: interfaces, generics, strict null checks
- Async/await pattern (not .then()/.catch())
- No external state management library (use React state + context)

**Backend (Go):**

- Standard Grafana plugin patterns
- Clean separation: routes → services → MCP clients
- Interface-based design for testability
- Context-based request handling

### File Organization

```
src/
├── components/          # React UI components
│   ├── App/            # Main app shell
│   ├── Chat/           # Chat interface
│   └── AppConfig/      # Configuration UI
├── core/               # Domain layer (Clean Architecture)
│   ├── models/         # Domain models
│   ├── repositories/   # Data access interfaces
│   └── services/       # Business logic
├── services/           # Application services (MCP clients)
├── pages/              # Top-level page components
├── tools/              # MCP tool implementations
└── utils/              # Utility functions

pkg/
├── main.go             # Backend entry point
├── plugin/             # Plugin implementation, HTTP routes, RBAC
└── mcp/                # MCP client, proxy, health monitoring
```

## Critical Development Patterns

### Theme Integration (CRITICAL)

**Always use Grafana's theme system** - never hardcode colors:

```tsx
// ✅ CORRECT: Use semantic Tailwind classes
<div className="bg-background text-primary border-weak">

// ❌ WRONG: Never hardcode colors
<div className="bg-gray-900 text-white border-gray-700">
```

**Semantic classes:**

- Backgrounds: `bg-background`, `bg-secondary`, `bg-surface`, `bg-canvas`, `bg-elevated`
- Text: `text-primary`, `text-secondary`, `text-disabled`, `text-link`
- Borders: `border-weak`, `border-medium`, `border-strong`
- Status: `text-success`, `text-warning`, `text-error`, `text-info`

**CSS Custom Properties:** All theme values available as `--grafana-*` variables

**Grafana UI Components:** Always prefer `@grafana/ui` components over custom implementations. Only create custom components when Grafana UI lacks the functionality.

### Adding a New MCP Tool

1. **Backend RBAC Configuration:**

   - If read-only: Add tool name to `isReadOnlyTool()` in `pkg/plugin/plugin.go:140-191`
   - If write operation: No changes needed (auto-restricted to Admin/Editor)
   - Viewers get: get*, list*, query*, search*, find*, generate* operations only

2. **Frontend Tool Implementation:**

   - Follow existing patterns in `src/tools/` directory
   - Include schema validation, error handling, TypeScript types
   - Add proper error messages for user feedback

3. **Testing:**
   - Verify RBAC: Viewer cannot access write operations
   - Test with different org contexts
   - Validate error handling

### Adding a New MCP Server

1. Add configuration to `provisioning/plugins/apps.yaml`:

```yaml
- id: 'server-id'
  name: 'display-name'
  url: 'http://server:8000/endpoint'
  enabled: true
  type: 'streamable-http' # openapi | standard | sse | streamable-http
```

2. Server automatically receives headers:

   - `X-Grafana-Org-Id`: numeric org ID
   - `X-Scope-OrgID`: tenant name (priority: scopeOrgId > orgName)

3. Update `docker-compose.yaml` if running locally

### Session Management Modifications

**Storage Layer** (`src/core/repositories/LocalStorageSessionRepository.ts`):

- All keys MUST include orgId: `grafana-o11y-chat-org-{orgId}-*`
- Respect 5MB quota per org
- Automatic cleanup triggers at quota limit (removes 10 oldest)
- Max 50 sessions per org

**Business Logic** (`src/core/services/SessionService.ts`):

- Always validate org context
- Implement 2s debounce for auto-save
- Maintain org isolation (no cross-org data access)

### Backend Development Workflow

1. Make Go code changes
2. Build: `mage build` or `npm run build:backend:all`
3. Restart Grafana: `docker compose restart grafana`
4. Test: `go test ./pkg/...`
5. For distribution: `mage buildAll` (builds all platforms)

**Binary naming:** `gpx_consensys-asko11y-app_{GOOS}_{GOARCH}`

## Security Considerations

### Input Validation (CRITICAL)

**SQL Operations:**

- NEVER allow: DROP, DELETE, TRUNCATE, ALTER operations
- Always validate SQL queries before execution
- Use parameterized queries (prevent SQL injection)

**General:**

- JSON schema validation for all tool arguments
- XSS prevention: HTML sanitization for user input
- URL validation for external requests
- Query validation at `pkg/plugin/plugin.go` before execution

### Authentication & Authorization

- Grafana session-based authentication (automatic)
- Role extraction from plugin context
- RBAC enforcement at tool listing AND execution (double-check)
- Org-level data isolation (localStorage keys, HTTP headers)
- Backend filtering: `filterToolsByRole()` and `canAccessTool()` in `pkg/plugin/plugin.go:192-233`

### Rate Limiting

- Queue-based request management
- Concurrent request limits
- Backpressure handling in MCP proxy

### Environment Variables

- Use `.env` file for sensitive configuration
- Never commit: `OPENAI_API_KEY`, `GRAFANA_SERVICE_ACCOUNT_TOKEN`
- Follow Grafana's security guidelines

## Common Workflows & Patterns

### Adding a New React Component

1. Create in appropriate directory (`src/components/`, `src/pages/`)
2. Use functional components with hooks
3. Add TypeScript interface for props
4. Use semantic Grafana theme classes
5. Prefer `@grafana/ui` components
6. Add data-testid for testing
7. Export from parent directory index

### Modifying HTTP Routes (Backend)

**All routes under:** `/api/plugins/consensys-asko11y-app/resources/`

```go
// In pkg/plugin/plugin.go
func (p *App) registerRoutes(mux *http.ServeMux) {
    mux.HandleFunc("/api/mcp/tools", p.handleMCPTools)         // List tools (RBAC filtered)
    mux.HandleFunc("/api/mcp/call-tool", p.handleMCPCallTool)  // Execute tool (RBAC checked)
    mux.HandleFunc("/api/mcp/servers", p.handleMCPServers)     // Health status
    mux.HandleFunc("/health", p.handleHealth)                  // Backend health
    mux.HandleFunc("/mcp", p.handleMCP)                        // JSON-RPC endpoint
}
```

**RBAC checking:**

1. Extract role from `req.Context()`
2. Call `canAccessTool(role, toolName)`
3. Return 403 if unauthorized

### Multi-Tenancy Testing

```bash
# Test with different orgs
# 1. Add org config to provisioning/plugins/apps.yaml
apps:
  - type: consensys-asko11y-app
    org_id: 2  # Different org
    jsonData:
      mcpServers: [...]

# 2. Verify isolation:
# - Sessions don't leak between orgs
# - Headers forwarded correctly (X-Grafana-Org-Id, X-Scope-OrgID)
# - RBAC works per org
```

### Debugging Common Issues

**"Tool execution failed":**

```bash
# Check RBAC permissions
# Location: pkg/plugin/plugin.go:326-330
# Verify user role has tool access
# Check logs: docker compose logs -f grafana
```

**Backend not loading:**

```bash
# Verify binary name matches platform
ls dist/
# Should see: gpx_consensys-asko11y-app_{GOOS}_{GOARCH}
# Rebuild: mage build
```

**MCP server unreachable:**

```bash
# Check Docker network
docker compose ps
docker compose logs -f mcp-grafana

# Verify provisioning/plugins/apps.yaml config
# Check URL accessibility from Grafana container
docker compose exec grafana curl http://mcp-grafana:8000/mcp
```

**Session storage issues:**

```bash
# Check browser console for localStorage errors
# Verify quota: each org has 5MB limit
# Manual cleanup: localStorage.clear() (dev tools console)
# Auto-cleanup: triggers at quota limit
```

## Key Files Reference

### Entry Points

- `src/module.tsx` - Frontend plugin registration
- `pkg/main.go` - Backend entry point
- `pkg/plugin/plugin.go` - Main plugin implementation

### Critical Implementation Files

- `pkg/plugin/plugin.go:140-191` - RBAC read-only tool list (`isReadOnlyTool()`)
- `pkg/plugin/plugin.go:192-233` - RBAC filtering (`filterToolsByRole()`, `canAccessTool()`)
- `pkg/mcp/client.go:49-75` - Multi-tenant header injection
- `src/core/services/SessionService.ts` - Session business logic
- `src/core/repositories/LocalStorageSessionRepository.ts` - Session persistence
- `src/services/backendMCPClient.ts` - MCP proxy client

### Configuration

- `provisioning/plugins/apps.yaml` - Plugin & MCP server configuration
- `.env` - Environment variables (not committed)
- `docker-compose.yaml` - Local development environment
- `webpack.config.ts` - Build configuration
- `.config/` - DO NOT EDIT (scaffolded by `@grafana/create-plugin`)

## Commit Guidelines

Use conventional commit format:

```bash
feat(chat): add message export functionality
fix(mcp): resolve connection timeout issue
docs(readme): update installation instructions
refactor(session): extract validation logic
test(chat): add streaming message tests
chore(deps): update @grafana/ui to 10.4.0
```

- Include scope when relevant
- Keep commits focused and atomic
- Reference issues: `fixes #123`

## Dependencies Management

```bash
# Add frontend dependency
npm install <package>
# Always commit package-lock.json

# Check compatibility:
# - Grafana React version: 18.2.0
# - Node.js: >=22
# - Grafana: >=10.4.0

# Consider bundle size impact
npm run build:frontend
# Check dist/ size
```

## Plugin Compliance

- Test in both development and signed modes
- Follow Grafana plugin publishing guidelines
- Test against multiple Grafana versions (see CI config)
- Ensure `plugin.json` metadata is accurate
- Plugin must work without backend if backend fails

## Additional Documentation

For more information, see:

- `README.md` - Quick start and overview
- `src/README.md` - Feature documentation
- `CONTRIBUTING.md` - Development setup and contribution guidelines
- `CHANGELOG.md` - Version history and release notes
