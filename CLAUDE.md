# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Ask O11y** is a Grafana app plugin that provides AI-powered observability assistance through natural language conversations. Users can query metrics, logs, traces, manage dashboards, and troubleshoot issues without writing PromQL/LogQL or navigating complex UIs.

**Tech Stack:**
- Frontend: React 18 + TypeScript (strict mode), Grafana UI components, Tailwind CSS
- Backend: Go 1.21+, Grafana Plugin SDK
- Integration: Model Context Protocol (MCP) for extensible tool capabilities
- State: React Context + localStorage (via Grafana UserStorage API)

**Core Architecture:**
- Clean Architecture pattern with Repository Pattern (frontend)
- MCP proxy aggregates multiple MCP servers (Grafana, Alertmanager, custom)
- Multi-tenant organization isolation with per-user session storage
- RBAC enforcement at tool listing AND execution

## Available MCP Tools for Development

**Context7 Plugin (Documentation Lookup):**

When working on this codebase, you have access to the Context7 MCP server for retrieving up-to-date library documentation:

- **Use case**: Query documentation for libraries used in this project (React, Grafana SDK, Go packages, etc.)
- **Tools available**:
  - `resolve-library-id`: Resolve package names to Context7-compatible library IDs
  - `query-docs`: Retrieve documentation and code examples for any library
- **Example workflow**:
  1. If you need to understand how a Grafana UI component works, use Context7 to query the latest documentation
  2. If implementing a new feature with an unfamiliar library, use Context7 to get examples
  3. When debugging issues, check library docs via Context7 for API changes or best practices

**Important**: Always use Context7 when you need documentation for:
- `@grafana/ui` components
- `@grafana/data` types and utilities
- `@grafana/runtime` APIs
- React patterns and hooks
- Go Grafana Plugin SDK
- Any other library dependencies in `package.json` or `go.mod`

## Definition of Done

**CRITICAL: Feature development is NOT complete until:**

1. ✅ **Tests are written** for the new feature
   - Unit tests for business logic and utilities
   - E2E tests for user-facing features

2. ✅ **All tests pass**, including:
   - Frontend unit tests: `npm run test:ci`
   - Backend tests: `go test ./pkg/...`
   - E2E tests: `npm run e2e`
   - Linting: `npm run lint`

3. ✅ **Code is reviewed** for:
   - RBAC compliance (if applicable)
   - Theme integration (no hardcoded colors)
   - Security (input validation, XSS prevention)
   - Performance (memoization, efficient queries)

**Never consider a feature "done" if tests are failing or missing.**

## Commands

**IMPORTANT: Use Node.js version 22**
```bash
# Ensure you're using Node.js 22 before running any npm commands
nvm use 22
```

**Note for Claude Code**: When using the Bash tool, shell state doesn't persist between calls. Always chain commands with `nvm use 22 &&` to ensure the correct Node version is used:
```bash
# ✅ CORRECT: Chain with nvm use 22
nvm use 22 && npm run lint

# ❌ WRONG: Separate commands (will use default Node version)
nvm use 22
npm run lint
```

### Development Setup
```bash
# Initial setup
nvm use 22 && npm install

# Start full development environment (Docker: Grafana + Redis + MCP servers + Alertmanager)
nvm use 22 && npm run server

# Access: http://localhost:3000 (admin/admin)
```

### Building
```bash
# Full production build (frontend + backend for all platforms)
nvm use 22 && npm run build:prod

# Frontend only (production build)
nvm use 22 && npm run build:frontend:prod

# Backend only (current platform)
nvm use 22 && npm run build:backend

# Backend only (all platforms: darwin/linux, amd64/arm64)
nvm use 22 && npm run build:backend:all
# OR using Mage directly:
mage build        # Current platform
mage buildAll     # All platforms
```

**Backend binary naming:** `gpx_consensys-asko11y-app_{GOOS}_{GOARCH}`
Example: `gpx_consensys-asko11y-app_linux_arm64`

### Testing
```bash
# Frontend unit tests (watch mode)
nvm use 22 && npm test

# Frontend unit tests (CI mode)
nvm use 22 && npm run test:ci

# E2E tests with Playwright (requires running server)
nvm use 22 && npm run e2e

# Backend Go tests
go test ./pkg/...
# OR:
mage test

# Type checking
nvm use 22 && npm run typecheck
```

**Important testing notes:**
- Unit tests use Jest + React Testing Library in `tests/` directory
- E2E tests use Playwright against running Grafana instance
- Always use `data-testid` attributes from `src/components/testIds.ts`
- Test RBAC with different roles (Admin, Editor, Viewer)

### Linting & Code Quality
```bash
# Check linting
nvm use 22 && npm run lint

# Auto-fix linting + format with Prettier
nvm use 22 && npm run lint:fix
```

### Development Workflow

**Frontend Development:**
The `npm run server` command starts the full Docker development environment with automatic hot reload for frontend changes:
- Frontend code changes are automatically detected and rebuilt
- Browser auto-refreshes via Docker volume mounts
- No need to manually restart or rebuild for frontend changes
- Includes all required services: Grafana, Redis, MCP servers, Alertmanager

**Note:** For frontend-only changes, the Docker environment provides the best development experience with hot reload. There is no separate `npm run dev` command.

### Backend Development Workflow
```bash
# 1. Make Go code changes
# 2. Rebuild backend
nvm use 22 && npm run build:backend

# 3. Restart Grafana to load new binary
docker compose restart grafana

# 4. View logs
docker compose logs -f grafana

# 5. Run tests (REQUIRED - feature is not done until tests pass)
go test ./pkg/...
```

### Complete Feature Development Workflow
```bash
# 1. Implement feature (frontend/backend)
# 2. Write tests
#    - Unit tests for business logic
#    - E2E tests for user flows

# 3. Run ALL tests to verify (REQUIRED before considering work done)
nvm use 22 && npm run test:ci           # Frontend unit tests
go test ./pkg/...                        # Backend tests
nvm use 22 && npm run e2e                # E2E tests (requires npm run server in another terminal)
nvm use 22 && npm run lint               # Code quality

# 4. Fix any failing tests
# 5. Only after all tests pass is the feature considered complete
```

### Running a Single Test
```bash
# Jest (frontend unit tests)
nvm use 22 && npm test -- path/to/test.test.ts

# Playwright (E2E tests)
nvm use 22 && npm run e2e -- --grep "test name pattern"

# Go (backend tests)
go test ./pkg/plugin -run TestFunctionName
```

## Architecture

### High-Level System Design

```
┌─────────────────────────────────────────────────────────────┐
│                    Grafana Frontend                          │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  React App (Ask O11y Plugin)                           │ │
│  │  ├─ Chat Interface (streaming responses)               │ │
│  │  ├─ Session Management (localStorage via UserStorage)  │ │
│  │  ├─ Configuration UI                                    │ │
│  │  └─ Visualization Components                            │ │
│  └────────────────────────────────────────────────────────┘ │
│                           ↕ HTTP                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Go Backend Plugin                                      │ │
│  │  ├─ HTTP Routes (/api/mcp/*, /health)                  │ │
│  │  ├─ RBAC Enforcement (Admin/Editor/Viewer)             │ │
│  │  ├─ Session Sharing (in-memory or Redis)               │ │
│  │  ├─ OAuth Flow Management (PKCE)                       │ │
│  │  └─ MCP Proxy (aggregates multiple servers)            │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                           ↕ MCP Protocol
┌─────────────────────────────────────────────────────────────┐
│  External MCP Servers                                        │
│  ├─ mcp-grafana (56+ Grafana tools)                         │
│  ├─ mcp-alertmanager (alerting tools)                       │
│  └─ Custom MCP servers (extensible)                         │
└─────────────────────────────────────────────────────────────┘
```

### Frontend Architecture (Clean Architecture)

```
src/
├── components/          # React UI components
│   ├── App/            # Main app shell, routing
│   ├── Chat/           # Chat interface with streaming, visualization
│   └── AppConfig/      # MCP server configuration, OAuth config
├── core/               # Domain layer (Clean Architecture)
│   ├── models/         # Domain models (ChatSession, Message)
│   ├── repositories/   # Data access interfaces (ISessionRepository)
│   │   └── GrafanaUserStorageRepository.ts  # Uses Grafana UserStorage API
│   └── services/       # Business logic (SessionService)
├── services/           # Application services
│   ├── backendMCPClient.ts    # Backend MCP proxy client
│   ├── mcpClient.ts           # Direct MCP client
│   ├── sessionShare.ts        # Session sharing client
│   ├── oauthService.ts        # OAuth flow handling
│   ├── tokenizer.ts           # Token counting utilities
│   └── queue.ts               # Request queue management
├── pages/              # Top-level page components
├── tools/              # MCP tool implementations
└── utils/              # Utility functions
```

### Backend Architecture (Go)

```
pkg/
├── main.go             # Backend entry point
├── plugin/             # Plugin implementation
│   ├── plugin.go       # Main plugin logic, HTTP routes, RBAC
│   │                   # - Lines 140-191: isReadOnlyTool() (RBAC config)
│   │                   # - Lines 192-233: filterToolsByRole() + canAccessTool()
│   │                   # - Lines 600-850: Session sharing API endpoints
│   ├── shares.go       # In-memory share store
│   ├── shares_redis.go # Redis-backed share store
│   ├── ratelimit.go    # Rate limiting (50 shares/hour/user)
│   └── config.go       # Plugin configuration
└── mcp/                # MCP client & proxy
    ├── client.go       # MCP client implementation
    │                   # - Lines 49-75: Multi-tenant header injection
    ├── proxy.go        # MCP proxy (aggregates servers)
    ├── health.go       # Health monitoring
    ├── oauth_*.go      # OAuth PKCE flow implementation
    └── types.go        # MCP types
```

### Key Design Patterns

**Frontend:**
- Functional components with hooks (no class components)
- Custom hooks for business logic: `useChat`, `useSessionManager`, `useMCPManager`
- Repository Pattern for data access abstraction
- Service Layer for business logic
- Async/await (not .then()/.catch())

**Backend:**
- Interface-based design (`ShareStoreInterface` for pluggable storage)
- Context-based request handling
- Clean separation: routes → services → MCP clients
- Middleware pattern for RBAC enforcement

### Multi-Tenancy & Isolation

**Session Storage (Frontend):**
- Uses Grafana UserStorage API (per-user storage, not per-org)
- Sessions are private to each user (not visible to other users)
- Keys include orgId: `grafana-o11y-chat-org-{orgId}-*`
- 5MB quota per user (auto-cleanup at limit)
- Max 50 sessions per user per organization

**MCP Server Communication (Backend):**
- Forwards org context via headers:
  - `X-Grafana-Org-Id`: numeric org ID
  - `X-Scope-OrgID`: tenant name (scopeOrgId > orgName)
- Implemented in `pkg/mcp/client.go:49-75`

**Session Sharing:**
- Scoped to organization where created
- In-memory (default) or Redis (optional, production)
- Rate limited: 50 shares per hour per user
- Cryptographically secure share IDs (32-byte random tokens)

### RBAC System

**Role Hierarchy:**
- Admin/Editor: Full access (56 tools: read + write)
- Viewer: Read-only access (45 tools: get*, list*, query*, search*, find*, generate*)

**Enforcement Points:**
1. Tool listing (filtered by role)
2. Tool execution (permission check before execution)

**Implementation:**
- `pkg/plugin/plugin.go:140-191`: `isReadOnlyTool()` - defines read-only tools
- `pkg/plugin/plugin.go:192-233`: `filterToolsByRole()` + `canAccessTool()`
- Double-check pattern (list AND execute)

### OAuth Integration (New in Current Branch)

The plugin supports OAuth 2.0 authentication flows for MCP servers that require OAuth:

**Backend (Go):**
- PKCE flow implementation in `pkg/mcp/oauth_*.go`
- OAuth storage abstraction with Redis backend
- State management for OAuth flows

**Frontend (TypeScript):**
- OAuth configuration panel in `src/components/AppConfig/OAuthConfigPanel.tsx`
- OAuth status badge component
- OAuth service for flow management in `src/services/oauthService.ts`

**Configuration:**
- OAuth server config in MCP server settings
- Encryption key via `MCP_OAUTH_ENCRYPTION_KEY` env var
- Generate key: `npm run generate:oauth-key`

## Critical Implementation Details

### Theme Integration (CRITICAL)

**ALWAYS use Grafana's theme system - NEVER hardcode colors:**

```tsx
// ✅ CORRECT: Use semantic Tailwind classes
<div className="bg-background text-primary border-weak">

// ❌ WRONG: Never hardcode colors
<div className="bg-gray-900 text-white border-gray-700">
```

**Semantic Tailwind classes (defined in tailwind.config.js):**
- Backgrounds: `bg-background`, `bg-secondary`, `bg-surface`, `bg-canvas`, `bg-elevated`
- Text: `text-primary`, `text-secondary`, `text-disabled`, `text-link`
- Borders: `border-weak`, `border-medium`, `border-strong`
- Status: `text-success`, `text-warning`, `text-error`, `text-info`

**Always prefer `@grafana/ui` components over custom implementations.**

### Adding a New MCP Tool

1. **Backend RBAC Configuration:**
   - If read-only: Add tool name to `isReadOnlyTool()` in `pkg/plugin/plugin.go:140-191`
   - If write operation: No changes needed (auto-restricted to Admin/Editor)
   - Viewers automatically get: `get*`, `list*`, `query*`, `search*`, `find*`, `generate*`

2. **Frontend Tool Implementation:**
   - Follow existing patterns in `src/tools/` directory
   - Include schema validation, error handling, TypeScript types

3. **Testing:**
   - Verify RBAC: Viewer cannot access write operations
   - Test with different org contexts
   - Validate error handling

### Adding a New MCP Server

1. **Add configuration** to `provisioning/plugins/apps.yaml`:
```yaml
mcpServers:
  - id: 'server-id'
    name: 'Display Name'
    url: 'http://server:8000/endpoint'
    enabled: true
    type: 'streamable-http'  # openapi | standard | sse | streamable-http
```

2. **Update docker-compose.yaml** if running locally (add service)

3. **Headers automatically forwarded:**
   - `X-Grafana-Org-Id`: numeric org ID
   - `X-Scope-OrgID`: tenant name

### Session Management Implementation

**Storage Layer** (`src/core/repositories/GrafanaUserStorageRepository.ts`):
- Uses Grafana UserStorage API (per-user, not per-org)
- Keys MUST include orgId: `grafana-o11y-chat-org-{orgId}-*`
- 5MB quota per user (not per org)
- Auto-cleanup at quota limit (removes 10 oldest)

**Business Logic** (`src/core/services/SessionService.ts`):
- Always validate org context
- Auto-save when streaming completes (immediate, no debounce)
- Maintain org isolation within user's storage

### Session Sharing Implementation

**Backend** (`pkg/plugin/shares.go`, `pkg/plugin/shares_redis.go`):
- Storage: In-memory (default) or Redis (optional)
- Interface: `ShareStoreInterface` for pluggable backends
- Rate limiting: 50 shares per hour per user
- Secure share IDs: 32-byte random tokens (base64 URL-safe)

**Frontend** (`src/services/sessionShare.ts`, `src/components/Chat/components/ShareDialog/`):
- Create, view, revoke share links
- Expiration options: 1h, 1d, 7d, 30d, 90d, never
- Import functionality (copy shared session to user's account)

**API Endpoints** (`pkg/plugin/plugin.go`):
- `POST /api/sessions/share` - Create share link
- `GET /api/sessions/shared/:shareId` - Get shared session (read-only)
- `DELETE /api/sessions/share/:shareId` - Revoke share
- `GET /api/sessions/:sessionId/shares` - List shares for session

## Code Style & Conventions

**Formatting:**
- Linter: `@grafana/eslint-config` with Prettier
- Indentation: 2 spaces, semicolons required, single quotes preferred

**Naming:**
- Components: PascalCase (`ChatMessage`, `MessageList`)
- Files: camelCase for components (`ChatMessage.tsx`), kebab-case for configs
- Variables/functions: camelCase (`executeQuery`, `isValidQuery`)
- Constants: SCREAMING_SNAKE_CASE (`MAX_TOKEN_LIMIT`)

**TypeScript:**
- Strict mode enabled
- Strong typing: interfaces, generics, strict null checks
- No `any` types (use `unknown` if needed)

## Security Considerations

**Input Validation (CRITICAL):**
- JSON schema validation for all tool arguments
- XSS prevention: HTML sanitization for user input
- URL validation for external requests
- Query validation at `pkg/plugin/plugin.go` before execution

**SQL Operations:**
- NEVER allow: DROP, DELETE, TRUNCATE, ALTER
- Always validate SQL queries before execution
- Use parameterized queries

**Authentication & Authorization:**
- Grafana session-based auth (automatic)
- RBAC enforcement at tool listing AND execution
- Org-level data isolation

**Rate Limiting:**
- Queue-based request management
- 50 shares per hour per user
- Backpressure handling in MCP proxy

## Testing Guidelines

From `.cursor/rules/jest-unit-testing.md`:
- Focus on critical functionality (business logic, utilities)
- Mock dependencies before imports with `jest.mock()`
- Test valid inputs, invalid inputs, edge cases
- Limit to 3-5 focused tests per file
- Use descriptive test names in `describe` blocks

From `.cursor/rules/playwright-e2e-testing.md`:
- Test critical user flows (login, chat, session management)
- Use `data-testid` or semantic selectors (not CSS/XPath)
- Mock external dependencies with `page.route`
- Leverage Playwright's auto-waiting
- Limit test files to 3-5 focused tests

## Common Workflows

### Modifying HTTP Routes (Backend)

All routes under: `/api/plugins/consensys-asko11y-app/resources/`

```go
// In pkg/plugin/plugin.go
func (p *App) registerRoutes(mux *http.ServeMux) {
    mux.HandleFunc("/api/mcp/tools", p.handleMCPTools)
    mux.HandleFunc("/api/mcp/call-tool", p.handleMCPCallTool)
    // etc.
}
```

RBAC checking pattern:
1. Extract role from `req.Context()`
2. Call `canAccessTool(role, toolName)`
3. Return 403 if unauthorized

### Debugging Common Issues

**Frontend build issues:**
```bash
# Verify Node version (should show v22.x.x)
nvm use 22 && node --version

# Clear and rebuild
nvm use 22 && rm -rf node_modules package-lock.json dist && npm install && npm run build:prod
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

# Test from Grafana container
docker compose exec grafana curl http://mcp-grafana:8000/mcp
```

**Session storage issues:**
```bash
# Check browser console for localStorage errors
# Verify quota (5MB per user)
# Manual cleanup: localStorage.clear() (dev tools)
```

## Configuration Files

- `provisioning/plugins/apps.yaml` - Plugin & MCP server config
- `.env` - Environment variables (not committed, see `.env.example`)
- `docker-compose.yaml` - Local development environment
- `webpack.config.ts` - Frontend build config
- `.config/` - DO NOT EDIT (scaffolded by `@grafana/create-plugin`)

## Commit Guidelines

Use conventional commit format:
```bash
feat(chat): add message export functionality
fix(mcp): resolve connection timeout issue
docs(readme): update installation instructions
refactor(session): extract validation logic
test(chat): add streaming message tests
```
