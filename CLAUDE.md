# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Ask O11y** is a Grafana app plugin that provides AI-powered observability assistance through natural language conversations. Users can query metrics, logs, traces, manage dashboards, and troubleshoot issues without writing PromQL/LogQL or navigating complex UIs.

**Tech Stack:**
- Frontend: React 18 + TypeScript (strict mode), Grafana UI components, Tailwind CSS
- Backend: Go 1.21+, Grafana Plugin SDK
- Integration: Model Context Protocol (MCP) for extensible tool capabilities
- State: React Context + Grafana UserStorage API

**Core Architecture:**
- Clean Architecture pattern with Repository Pattern (frontend)
- MCP proxy aggregates multiple MCP servers (Grafana MCP, custom servers)
- Multi-tenant organization isolation with per-user session storage
- RBAC enforcement at tool listing AND execution

## Claude Code Plugins & Workflow

This project uses the following Claude Code plugins. They are configured in `.claude/settings.json` and **must** be used as described below.

### Active Plugins

| Plugin | Purpose |
|--------|---------|
| **gopls-lsp** | Go language server - provides real-time diagnostics, type info, and refactoring for `pkg/` code |
| **typescript-lsp** | TypeScript language server - provides real-time diagnostics, type info, and refactoring for `src/` code |
| **code-review** | Reviews code changes for bugs, style violations, and adherence to project conventions |
| **code-simplifier** | Simplifies and refines code for clarity and maintainability while preserving functionality |
| **pr-review-toolkit** | Comprehensive PR review suite (code-reviewer, silent-failure-hunter, type-design-analyzer, comment-analyzer, pr-test-analyzer) |
| **context7** | Retrieves up-to-date library documentation (Grafana SDK, React, Go packages) |
| **playwright** | Browser automation for E2E testing |
| **feature-dev** | Guided feature development with architecture analysis |

### Mandatory Quality Workflow

**CRITICAL: After every code change (feature, bug fix, refactor), you MUST run the following quality gates before considering work done:**

#### Step 1: LSP Diagnostics
- Check `gopls-lsp` diagnostics for any Go files you modified in `pkg/`
- Check `typescript-lsp` diagnostics for any TypeScript files you modified in `src/`
- **Fix ALL critical, major, and medium severity issues** before proceeding

#### Step 2: Code Review
- Run the `code-review` skill (via Skill tool with `skill: "code-review"`) on your changes
- **Fix ALL critical, major, and medium severity issues** reported by the reviewer
- Only low/info severity issues may be left as-is with justification

#### Step 3: Code Simplification
- Run the `code-simplifier` agent (via Task tool with `subagent_type: "pr-review-toolkit:code-simplifier"`) on modified code
- Apply simplifications that improve clarity without changing behavior

#### Step 4: Remove AI Slop & Excessive Comments
- Review all modified code for AI-generated noise: remove unnecessary comments, redundant docstrings, and obvious explanations
- Delete comments that merely restate the code (e.g., `// increment counter` above `counter++`)
- Remove filler phrases in comments like "Note:", "Important:", "This function...", "Helper to..."
- Strip auto-generated JSDoc/GoDoc that adds no value beyond what types and names already convey
- Do NOT add comments, docstrings, or type annotations to code you didn't change
- Only keep comments where the **why** is non-obvious — never comment the **what**

#### Step 5: Tests & Lint
- Run `nvm use 22 && npm run test:ci` (frontend unit tests)
- Run `go test ./pkg/...` (backend tests)
- Run `nvm use 22 && npm run lint` (linting)
- Run `nvm use 22 && npm run typecheck` (type checking)
- **Fix any failures** - iterate until all pass

#### Step 6: PR Review (before commit/PR)
- Run the full `pr-review-toolkit:review-pr` and the skill for comprehensive analysis
- Fix critical/major/medium issues from: code-reviewer, silent-failure-hunter, type-design-analyzer

**Issue Severity Policy:**
- **Critical**: MUST fix immediately - security vulnerabilities, data loss risks, crashes
- **Major**: MUST fix before commit - logic errors, missing error handling, RBAC violations
- **Medium**: MUST fix before PR - code smells, unnecessary complexity, missing validation
- **Low/Info**: Fix if easy, otherwise document as tech debt

### Context7 (Documentation Lookup)

When working on this codebase, use the Context7 MCP server for up-to-date library documentation:

- **Tools**: `resolve-library-id` then `query-docs`
- **When to use**: Understanding Grafana UI components, implementing features with unfamiliar APIs, checking for API changes
- **Required for**: `@grafana/ui`, `@grafana/data`, `@grafana/runtime`, React hooks, Go Grafana Plugin SDK, any dependency in `package.json` or `go.mod`

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

# Start full development environment (Docker: Grafana + Redis + MCP servers)
nvm use 22 && npm run server

# Start multi-org development environment (uses docker-compose-full.yaml + full.yaml_)
nvm use 22 && npm run server:full

# Access: http://localhost:3000 (admin/admin)
```

**Multi-org testing (`server:full`):**
- Swaps `app.yaml` ↔ `full.yaml_` provisioning (with bash trap for cleanup)
- Uses `docker-compose-full.yaml` with external `mcp-grafana` sidecar + Redis + mcpo
- Provisions two orgs with separate MCP server configs
- Create Org 2 manually in Grafana UI after startup

### Building
```bash
# Full production build (frontend + backend for all platforms)
nvm use 22 && npm run build

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
- Includes all required services: Grafana, Redis, MCP servers

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
│  │  ├─ Session Management (Grafana UserStorage API)       │ │
│  │  ├─ Configuration UI                                    │ │
│  │  └─ Visualization Components                            │ │
│  └────────────────────────────────────────────────────────┘ │
│                           ↕ HTTP                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Go Backend Plugin                                      │ │
│  │  ├─ HTTP Routes (/api/mcp/*, /api/agent/*, /health)    │ │
│  │  ├─ Agentic Loop (LLM ↔ MCP tool-call cycle)          │ │
│  │  ├─ RBAC Enforcement (Admin/Editor/Viewer)             │ │
│  │  ├─ Session Sharing (in-memory or Redis)               │ │
│  │  ├─ OAuth Flow Management (PKCE)                       │ │
│  │  └─ MCP Proxy (aggregates multiple servers)            │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                           ↕ MCP Protocol
┌─────────────────────────────────────────────────────────────┐
│  External MCP Servers                                        │
│  ├─ mcp-grafana (56+ Grafana tools, including alerting)     │
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
├── services/           # Application services
│   ├── agentClient.ts         # Server-side agent loop client (SSE streaming)
│   ├── backendMCPClient.ts    # Backend MCP proxy client (tool listing)
│   ├── backendSessionClient.ts # Backend session API client
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
├── agent/              # Agentic loop (LLM ↔ MCP tool-call cycle)
│   ├── loop.go         # Core agent loop: LLM call → tool calls → repeat
│   ├── llm_client.go   # HTTP client for grafana-llm-app OpenAI endpoint
│   ├── tools.go        # MCP tool ↔ OpenAI function conversion + execution
│   ├── context_window.go # Token-aware message truncation
│   └── types.go        # SSE event types, request/response models
├── plugin/             # Plugin implementation
│   ├── plugin.go       # Main plugin logic, HTTP routes, RBAC
│   ├── shares.go       # In-memory share store
│   ├── shares_redis.go # Redis-backed share store
│   ├── ratelimit.go    # Rate limiting (50 shares/hour/user)
│   └── config.go       # Plugin configuration
├── rbac/               # Role-based access control
│   └── rbac.go         # Annotation-based RBAC using MCP ToolAnnotations
└── mcp/                # MCP client & proxy
    ├── client.go       # MCP client implementation
    │                   # - customRoundTripper: Multi-tenant header injection
    ├── proxy.go        # MCP proxy (aggregates servers)
    ├── health.go       # Health monitoring
    ├── oauth_*.go      # OAuth PKCE flow implementation
    └── types.go        # MCP types
```

### Key Design Patterns

**Frontend:**
- Functional components with hooks (no class components)
- Custom hooks for business logic: `useChat`, `useSessionManager`
- Thin service layer for backend API calls (`services/`)
- Async/await (not .then()/.catch())

**Backend:**
- Interface-based design (`ShareStoreInterface` for pluggable storage)
- Context-based request handling
- Clean separation: routes → services → MCP clients
- Middleware pattern for RBAC enforcement

### Multi-Tenancy & Isolation

**Session Storage (Backend):**
- Stored in Go backend (in-memory or Redis)
- Sessions are private to each user per org
- Max 50 sessions per user per organization (auto-eviction of oldest)
- Frontend communicates via `src/services/backendSessionClient.ts` HTTP API

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
- Admin/Editor: Full access to all tools
- Viewer: Read-only access (tools with `readOnlyHint: true` annotation)

**Annotation-Based Enforcement:**
RBAC uses MCP protocol `ToolAnnotations` (specifically `ReadOnlyHint`) advertised by MCP servers. No hardcoded tool lists — the server is the source of truth. Tools without annotations are treated as not read-only (denied to Viewers).

**Enforcement Points:**
1. Tool listing — `rbac.FilterToolsByRole()` filters by annotations
2. Tool execution — `rbac.CanAccessTool()` double-checks via `proxy.FindToolByName()` annotation lookup
3. Agent loop — execution-time RBAC check in `executeTool()` before calling MCP server

**Implementation:**
- `pkg/rbac/rbac.go`: `IsReadOnlyTool()`, `FilterToolsByRole()`, `CanAccessTool()` — all annotation-based
- `pkg/mcp/types.go`: `ToolAnnotations` struct with `ReadOnlyHint`, `DestructiveHint`, etc.
- `pkg/mcp/proxy.go`: `FindToolByName()` for execution-time annotation lookup
- Double-check pattern (list AND execute)

### Agentic Backend Loop

The AI conversation loop runs server-side in Go (not in the browser). The frontend sends the full message history and receives SSE events back.

**Flow:**
1. Frontend POSTs to `/api/agent/run` with messages + systemPrompt
2. Backend streams SSE events: `content`, `tool_call_start`, `tool_call_result`, `done`, `error`
3. Agent loop: LLM call → parse tool calls → execute via MCP proxy → feed results back → repeat
4. Max 25 iterations per request (configurable via `AgentMaxIterations`)

**Key Components:**
- `pkg/agent/loop.go` — Core loop orchestration
- `pkg/agent/llm_client.go` — Calls `grafana-llm-app` OpenAI-compatible endpoint using SA token
- `pkg/agent/tools.go` — Converts MCP tools to OpenAI function format, executes tool calls via MCP proxy
- `pkg/agent/context_window.go` — Token-aware message truncation to stay within model limits
- `pkg/plugin/plugin.go:handleAgentRun()` — HTTP handler, SSE streaming, request validation

**Authentication for LLM calls:**
- Uses Grafana service account (SA) token from `backend.GrafanaConfigFromContext()`
- SA token is passed to `grafana-llm-app` via `Authorization: Bearer` header
- `X-Grafana-Org-Id` header forwarded for org context

### OAuth Integration

The plugin supports OAuth 2.0 authentication flows for MCP servers that require OAuth:

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

### MCP Configuration Modes

Ask O11y supports three MCP modes for flexible tool integration:

**1. Built-in Only**: Use Grafana's built-in MCP server (grafana-llm-app)
- Provides 56+ native Grafana observability tools
- Automatically configured when grafana-llm-app is installed
- Enabled via `useBuiltInMCP: true` in plugin settings
- **LIMITATION: Only works for Org 1** (see Multi-Org Constraints below)

**2. External Only**: Use user-configured external MCP servers
- Supports OpenAPI, SSE, Standard MCP, and Streamable HTTP protocols
- Configured in AppConfig UI or via `provisioning/plugins/app.yaml`
- Enabled when `useBuiltInMCP: false` and external servers configured

**3. Combined Mode** (NEW): Use both built-in AND external servers simultaneously
- All tools from both sources available together
- Enabled when `useBuiltInMCP: true` AND external servers configured
- Shows "Combined mode active" alert in AppConfig UI

**Tool Naming Convention:**
- Built-in tools: Original names (e.g., `query_prometheus`, `get_dashboard`)
- External tools: Prefixed by backend with `{serverid}_` (e.g., `mcp-grafana_query_prometheus`)
- Natural disambiguation - conflicts extremely unlikely due to prefixing

**Implementation:**
- Backend: `pkg/mcp/proxy.go` aggregates multiple MCP servers and handles tool routing
- Frontend: All tool execution goes through the server-side agent loop (`pkg/agent/loop.go`)
- Tool listing: `src/services/backendMCPClient.ts` proxies through backend for RBAC-filtered listing
- Error isolation: If one MCP server fails, others continue to work
- RBAC: Filtering applied by backend proxy based on MCP ToolAnnotations

### Multi-Org Constraints (CRITICAL)

**`externalServiceAccounts` creates a service account scoped to Org 1 only.** This is a known Grafana limitation:
- [grafana/grafana#91844](https://github.com/grafana/grafana/issues/91844): SA token from `backend.GrafanaConfigFromContext()` is always Org 1
- [grafana-llm-app#829](https://github.com/grafana/grafana-llm-app/issues/829): Built-in MCP not compatible with multi-org

**Impact on this plugin:**
- `useBuiltInMCP: true` injects grafana-llm-app's MCP endpoint using the SA token → **only works for Org 1**
- The LLM client (`pkg/agent/llm_client.go`) uses the SA token for `grafana-llm-app` calls. It intentionally **does NOT send `X-Grafana-Org-Id`** when using SA token auth — sending a non-Org-1 header with the Org-1-scoped SA token causes a 401 from grafana-llm-app. This means **all orgs share Org 1's LLM configuration** (API key, model settings). Org isolation is enforced at the MCP tool-call layer, not the LLM layer.
- Grafana 12 strips `Cookie` headers from backend plugin requests, so user session cookies cannot be forwarded to grafana-llm-app as an alternative auth mechanism

**Multi-org workaround for MCP tools (used in `docker-compose-full.yaml`):**
- Run `mcp-grafana` as an external sidecar container with basic auth (`GRAFANA_USERNAME`/`GRAFANA_PASSWORD` = admin/admin)
- Basic auth credentials have cross-org access (unlike SA tokens)
- The MCP proxy's `customRoundTripper` in `pkg/mcp/client.go` forwards `X-Grafana-Org-Id` and `X-Scope-OrgID` headers
- The frontend sends `X-Grafana-Org-Id` on the `/api/agent/run` request, which flows through to MCP tool calls
- Configure via external MCP server entries in provisioning (NOT `useBuiltInMCP`)

**NEVER set `useBuiltInMCP: true` in multi-org provisioning files (`full.yaml_`).** Always use external `mcp-grafana` sidecar for multi-org deployments.

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

1. **RBAC — No plugin changes needed:**
   - RBAC is driven by MCP `ToolAnnotations` from the server
   - The MCP server must set `readOnlyHint: true` on read-only tools
   - Tools without annotations are restricted to Admin/Editor only

2. **Frontend Tool Implementation:**
   - Follow existing patterns in `src/tools/` directory
   - Include schema validation, error handling, TypeScript types

3. **Testing:**
   - Verify RBAC: Viewer cannot access tools without `readOnlyHint: true`
   - Test with different org contexts
   - Validate error handling

### Adding a New MCP Server

**Note**: External MCP servers can be used alongside built-in MCP (combined mode) or independently.

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

4. **Tool naming**: External tools will be automatically prefixed with `{server-id}_` to avoid conflicts with built-in tools

### Session Management Implementation

**Backend Storage** (`pkg/plugin/sessionstore.go`, `pkg/plugin/sessionstore_redis.go`):
- In-memory (default) or Redis (production) session store
- Per-user per-org isolation via `ownerKey = {userID}:{orgID}`
- Max 50 sessions per user/org (auto-eviction of oldest)
- `activeRunId` tracking for SSE reconnection on page refresh

**Frontend** (`src/services/backendSessionClient.ts`, `src/components/Chat/hooks/useSessionManager.ts`):
- Thin HTTP client for backend session CRUD
- `useSessionManager` hook manages session state and URL synchronization
- Sessions created server-side during first agent run

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

### Alert Investigation Mode

One-click RCA from alert notifications. URL params trigger auto-send of investigation prompt.

**URL Format:** `/a/consensys-asko11y-app?type=investigation&alertName={alertName}`

**Implementation:**
- `src/hooks/useAlertInvestigation.ts` - Parses URL, validates alert name, builds RCA prompt
- `pkg/plugin/prompt_defaults.go` - Investigation prompt template with runbook annotation support
- `src/pages/Home.tsx` - Renders loading/error states, passes initialMessage to Chat
- `src/components/Chat/hooks/useChat.ts` - Auto-send state machine (idle → creating-session → ready-to-send → sent)

**Flow:**
1. User clicks investigation link from alert notification
2. `useAlertInvestigation` parses `alertName` from URL, validates format
3. Creates new session titled "Alert Investigation: {alertName}"
4. Auto-sends RCA prompt to AI

**Runbook Integration:**
The investigation prompt instructs the agent to check for a `runbook_url` annotation when retrieving the alert. If present, the agent fetches and reads the runbook content before proceeding with the investigation, using it to guide the analysis and remediation steps.

**Slack/Alertmanager Template:**
```go
{{ range .Alerts }}
<{{ $.ExternalURL }}/a/consensys-asko11y-app?type=investigation&alertName={{ .Labels.alertname }}|🔍 Investigate>
{{ end }}
```

### API Documentation

The plugin's REST API is fully documented using OpenAPI 3.0.3 specification.

**Location:** `pkg/plugin/openapi/openapi.json`

**Serving:** Available at `/openapi.json` endpoint (embedded at compile time using `//go:embed`)

**Endpoint:** `/api/plugins/consensys-asko11y-app/resources/openapi.json`

**Implementation Files:**
- `pkg/plugin/openapi/openapi.json` - Complete OpenAPI 3.0.3 spec (all 23 endpoints)
- `pkg/plugin/openapi/openapi.go` - Embed and serve logic
- `pkg/plugin/openapi/openapi_test.go` - Validation tests
- `pkg/plugin/plugin.go` - HTTP route registration (`/openapi.json`)

**Maintenance Guidelines:**

When adding or modifying API endpoints, follow this workflow:

1. **Update Handler Code**: Implement the endpoint in `pkg/plugin/plugin.go`
2. **Update OpenAPI Spec**: Add/modify the endpoint in `pkg/plugin/openapi/openapi.json`
   - Add path definition with all HTTP methods
   - Define request/response schemas in `components.schemas`
   - Document RBAC requirements, rate limiting, headers
   - Add examples for complex request/response bodies
3. **Validate Spec**: Run `npm run validate:openapi` to check OpenAPI validity
4. **Update Tests**: Add test coverage in `pkg/plugin/openapi/openapi_test.go` if adding new endpoints
5. **Commit Together**: Always commit code changes and spec updates in the same PR

**Testing:**
```bash
# Validate OpenAPI spec
npm run validate:openapi

# Run Go tests (includes spec validation)
go test ./pkg/plugin/openapi/...

# Manual testing with Swagger Editor
curl http://localhost:3000/api/plugins/consensys-asko11y-app/resources/openapi.json > spec.json
# Load spec.json into https://editor.swagger.io/
```

**Spec Validation Tests:**
The spec is validated in CI and includes tests for:
- JSON validity and OpenAPI 3.0.3 format
- All 23 endpoints documented
- RBAC documentation completeness (403 responses for protected endpoints)
- SSE streaming endpoint format (`text/event-stream` content type)
- Rate limiting documentation (429 responses)
- Required schemas present (RunRequest, ChatSession, Tool, etc.)
- Security schemes defined (GrafanaSession cookie auth)

**Key Conventions:**
- **SSE Endpoints**: Document with `text/event-stream` content type and event format examples
- **RBAC**: Include 403 Forbidden responses with descriptions for all protected endpoints
- **Rate Limiting**: Document rate limits in description and include 429 responses
- **Multi-Org**: Document `X-Grafana-Org-Id` header in parameter definitions
- **Path Parameters**: Use pattern validation for IDs (e.g., base64 URL-safe 32-byte tokens)

**Future Migration:**
If the API grows beyond 50 endpoints, consider:
- Migrating to `swag` with handler annotations for auto-generation
- Using `oapi-codegen` for spec-first development
- Creating custom reflection-based schema generator

For now, manual maintenance is pragmatic given the codebase size (23 endpoints) and provides better control over API documentation quality.

## Code Style & Conventions

**Guiding Principle:** Always make the simplest change possible. Code readability matters most — we're happy to make bigger structural changes to achieve it. Don't worry about backwards compatibility or migration paths; just write the clearest code.

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
- Use Playwright's auto-waiting
- Limit test files to 3-5 focused tests

## Common Workflows

### Modifying HTTP Routes (Backend)

All routes under: `/api/plugins/consensys-asko11y-app/resources/`

```go
// In pkg/plugin/plugin.go
func (p *Plugin) registerRoutes(mux *http.ServeMux) {
    mux.HandleFunc("/api/mcp/tools", p.handleMCPTools)
    mux.HandleFunc("/api/mcp/call-tool", p.handleMCPCallTool)
    mux.HandleFunc("/api/agent/run", p.handleAgentRun)  // SSE streaming agentic loop
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
nvm use 22 && rm -rf node_modules package-lock.json dist && npm install && npm run build
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
# Check browser console for storage errors
# Verify quota (5MB per user via Grafana UserStorage API)
# Sessions are stored via Grafana's UserStorage API
```

## Configuration Files

- `provisioning/plugins/app.yaml` - Plugin & MCP server config (single-org, default)
- `provisioning/plugins/full.yaml_` - Multi-org provisioning (trailing `_` prevents Grafana from loading; `server:full` swaps it in)
- `.env` - Environment variables (not committed, see `.env.example`)
- `docker-compose.yaml` - Local development environment (single-org)
- `docker-compose-full.yaml` - Multi-org development environment (external mcp-grafana + Redis + mcpo)
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
