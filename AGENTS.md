# AGENTS.md

This file provides context and instructions to help AI agents work effectively on this project.

## Mandatory Agent Workflow

**CRITICAL: The following agent workflow is REQUIRED for every code change.**

After writing or modifying code, agents MUST execute these steps in order:

### 1. LSP Diagnostics (gopls-lsp + typescript-lsp)

- For Go changes (`pkg/`): Check gopls-lsp diagnostics and fix all errors/warnings
- For TypeScript changes (`src/`): Check typescript-lsp diagnostics and fix all errors/warnings
- **Fix ALL critical, major, and medium issues before proceeding**

### 2. Code Review (code-review / pr-review-toolkit:code-reviewer)

- Run code-reviewer on all modified files
- Review output for bugs, logic errors, security vulnerabilities, code quality issues
- **Fix ALL critical, major, and medium severity issues**
- Low/info severity: fix if trivial, otherwise note for future

### 3. Code Simplification (code-simplifier / pr-review-toolkit:code-simplifier)

- Run code-simplifier on recently modified code
- Apply simplifications that improve clarity without changing behavior
- Preserve all existing functionality and project patterns

### 4. Tests & Lint

```bash
nvm use 22 && npm run test:ci    # Frontend unit tests
go test ./pkg/...                 # Backend tests
nvm use 22 && npm run lint        # Linting
nvm use 22 && npm run typecheck   # Type checking
```

- **Fix any failures** - iterate until all pass

### 5. Pre-PR Review (pr-review-toolkit agents)

Before commit or PR creation, run the full review toolkit:
- **code-reviewer**: Style, conventions, bugs
- **silent-failure-hunter**: Error handling gaps, swallowed errors
- **type-design-analyzer**: Type quality for new types/interfaces
- **pr-test-analyzer**: Test coverage completeness

**Fix ALL critical, major, and medium issues from every agent.**

### Issue Severity Policy

| Severity | Action | Examples |
|----------|--------|----------|
| **Critical** | MUST fix immediately | Security vulnerabilities, data loss, crashes |
| **Major** | MUST fix before commit | Logic errors, missing error handling, RBAC violations |
| **Medium** | MUST fix before PR | Code smells, unnecessary complexity, missing validation |
| **Low/Info** | Fix if easy | Style preferences, minor improvements |

---

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
- Session persistence via Grafana UserStorage API

## Build and Test Commands

### Setup & Development

```bash
# Initial setup (ALWAYS use Node.js 22)
nvm use 22 && npm install

# Start full development environment (Docker: Grafana + Redis + MCP servers)
nvm use 22 && npm run server

# Backend development
mage build                    # Current platform
nvm use 22 && npm run build:backend:all     # All platforms

# After backend changes
docker compose restart grafana
docker compose logs -f grafana
```

### Building

```bash
# Full build (frontend + backend, all platforms)
nvm use 22 && npm run build

# Component builds
nvm use 22 && npm run build:frontend        # Frontend only
nvm use 22 && npm run build:backend         # Backend (current platform)
mage buildAll                 # Backend (all platforms)

# Backend binary naming: gpx_consensys-asko11y-app_{os}_{arch}
# Example: gpx_consensys-asko11y-app_linux_arm64
```

### Testing & Quality Checks

```bash
# Tests (ALWAYS prefix npm commands with nvm use 22 &&)
nvm use 22 && npm test                      # Unit tests (watch mode)
nvm use 22 && npm run test:ci              # Unit tests (CI mode)
nvm use 22 && npm run e2e                  # E2E tests (requires running server)
go test ./pkg/...            # Go tests
mage test                    # Go tests via Mage

# Code quality
nvm use 22 && npm run lint                 # Check linting
nvm use 22 && npm run lint:fix             # Auto-fix linting issues
nvm use 22 && npm run typecheck            # TypeScript type checking
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

**Storage Layer** (`src/core/repositories/GrafanaUserStorageRepository.ts`):

- Uses Grafana's UserStorage API (per-user storage, not per-org)
- All keys MUST include orgId: `grafana-o11y-chat-org-{orgId}-*`
- Sessions are private to each user (not visible to other users, even in the same org)
- Respect 5MB quota per user (not per org)
- Automatic cleanup triggers at quota limit (removes 10 oldest)
- Max 50 sessions per user per organization

**Business Logic** (`src/core/services/SessionService.ts`):

- Always validate org context
- Auto-save when streaming completes (immediate save, no debounce)
- Maintain org isolation within user's storage (sessions organized by org, but private to each user)

### Session Sharing

**Backend Implementation** (`pkg/plugin/shares.go`, `pkg/plugin/shares_redis.go`):

- **Storage Options**: In-memory (default) or Redis (optional, for production)
- **Share Store Interface**: `ShareStoreInterface` allows pluggable storage backends
- **Rate Limiting**: 50 shares per hour per user (prevents abuse)
- **Expiration Handling**: Supports expiration in days or hours (hours converted to days internally)
- **Organization Isolation**: Shares are scoped to the organization where created
- **Secure IDs**: Cryptographically secure share IDs (32-byte random tokens, base64 URL-safe encoded)

**API Endpoints** (`pkg/plugin/plugin.go`):

- `POST /api/sessions/share` - Create a share link
- `GET /api/sessions/shared/:shareId` - Get shared session (read-only, org-scoped)
- `DELETE /api/sessions/share/:shareId` - Revoke a share link
- `GET /api/sessions/:sessionId/shares` - List all shares for a session

**Frontend Implementation** (`src/services/sessionShare.ts`, `src/components/Chat/components/ShareDialog/ShareDialog.tsx`):

- `SessionShareService` - Client service for share operations
- `ShareDialog` - UI component for creating and managing shares
- `SharedSession` page (`src/pages/SharedSession.tsx`) - Read-only view for shared sessions
- Expiration options: 1 hour, 1 day, 7 days, 30 days, 90 days, or never
- Import functionality: Users can import shared sessions into their account

**Redis Support** (Optional):

- Configure Redis via environment variables or plugin config
- `RedisShareStore` implements `ShareStoreInterface` for persistent storage
- Automatic TTL handling (Redis manages expiration)
- Session index sets for efficient lookup of all shares for a session
- See `pkg/plugin/shares_redis.go` for implementation details

**Adding Redis Support:**

1. Set Redis connection details in plugin configuration or environment variables
2. Backend automatically detects Redis availability and uses it if configured
3. Falls back to in-memory storage if Redis is unavailable

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
- Org-level data isolation (UserStorage API, HTTP headers)
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
# Check browser console for storage errors
# Verify quota: 5MB per user via Grafana UserStorage API
# Sessions are stored via Grafana's UserStorage API
# Auto-cleanup: triggers at quota limit
```

**Session sharing issues:**

```bash
# Check share link is accessible
# Verify share hasn't expired (check expiration date)
# Check organization context (shares are org-scoped)
# Verify rate limit (50 shares per hour per user)
# Check Redis connection if using Redis backend
docker compose logs -f grafana | grep -i "share\|redis"
```

## Key Files Reference

### Entry Points

- `src/module.tsx` - Frontend plugin registration
- `pkg/main.go` - Backend entry point
- `pkg/plugin/plugin.go` - Main plugin implementation

### Critical Implementation Files

- `pkg/plugin/plugin.go:140-191` - RBAC read-only tool list (`isReadOnlyTool()`)
- `pkg/plugin/plugin.go:192-233` - RBAC filtering (`filterToolsByRole()`, `canAccessTool()`)
- `pkg/plugin/plugin.go:600-850` - Session sharing API endpoints
- `pkg/plugin/shares.go` - In-memory share store implementation
- `pkg/plugin/shares_redis.go` - Redis-backed share store implementation
- `pkg/mcp/client.go:49-75` - Multi-tenant header injection
- `src/core/services/SessionService.ts` - Session business logic
- `src/core/repositories/GrafanaUserStorageRepository.ts` - Session persistence (uses Grafana UserStorage API - per-user storage, organized by organization)
- `src/services/sessionShare.ts` - Session sharing client service
- `src/components/Chat/components/ShareDialog/ShareDialog.tsx` - Share dialog UI component
- `src/pages/SharedSession.tsx` - Shared session read-only view page
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
