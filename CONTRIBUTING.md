# Contributing to Ask O11y

Thank you for your interest in contributing to Ask O11y! We welcome all contributions that help improve this project, whether you're fixing bugs, adding features, improving documentation, or helping with community support.

## Code of Conduct

This project and everyone participating in it is expected to uphold professional and respectful behavior. We are committed to providing a welcoming and inclusive environment for all contributors.

## Table of Contents

- [Getting Help](#getting-help)
- [Reporting Issues](#reporting-issues)
- [Contributing Code](#contributing-code)
- [Development Setup](#development-setup)
- [Code Standards](#code-standards)
- [Testing Guidelines](#testing-guidelines)
- [Pull Request Process](#pull-request-process)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Community](#community)

---

## Getting Help

Before contributing, you might want to:

- **Read the Documentation**: Check [README.md](README.md), [AGENTS.md](AGENTS.md), and [src/README.md](src/README.md)
- **Search Existing Issues**: Your question might already be answered in [GitHub Issues](https://github.com/Consensys/ask-o11y-plugin/issues)
- **GitHub Discussions**: Join conversations with the community

For general questions about using the plugin, please use GitHub Discussions rather than opening an issue.

---

## Reporting Issues

### Bug Reports

Found a bug? Help us fix it by providing detailed information:

1. **Search First**: Check if the issue already exists in [GitHub Issues](https://github.com/Consensys/ask-o11y-plugin/issues)
2. **Use the Bug Report Template**: When creating a new issue, GitHub will guide you through our bug report form which includes:
   - **Clear Description**: What happened vs what you expected
   - **Steps to Reproduce**: Detailed steps to recreate the issue
   - **Environment Details**:
     - Grafana version
     - Plugin version
     - Browser and OS
     - User role (Admin/Editor/Viewer)
   - **Screenshots/Logs**: Include relevant error messages, browser console logs, or screenshots
   - **Configuration**: Any relevant MCP server or plugin configuration

**Example Bug Report:**
```markdown
## Bug Description
Visualizations fail to load when querying Prometheus datasource

## Steps to Reproduce
1. Navigate to Ask O11y plugin
2. Ask: "Show me CPU usage in the last hour"
3. Tool executes successfully but visualization shows loading spinner indefinitely

## Environment
- Grafana: 12.1.1
- Plugin: consensys-asko11y-app v1.0.0
- Browser: Chrome 120.0
- OS: macOS 14.2
- Role: Admin

## Console Errors
```
Error: Failed to fetch datasource query results
  at DataSourceService.query (chunk-ABC123.js:42)
```

## Configuration
- Prometheus datasource: http://prometheus:9090
- MCP Grafana server: http://mcp-grafana:8001
```

### Feature Requests

Have an idea for a new feature?

1. **Check Existing Requests**: Search issues labeled `enhancement`
2. **Use the Feature Request Template**: When creating a new issue, select "Feature Request" and fill out the form with:
   - Problem statement and use case
   - Proposed solution
   - Alternatives considered
   - Implementation ideas (optional)

### Security Vulnerabilities

**DO NOT** open public issues for security vulnerabilities. Instead, please report them privately through GitHub's Security Advisory feature:

1. Go to the repository's Security tab
2. Click "Report a vulnerability"
3. Include detailed description and steps to reproduce
4. We will respond promptly and work with you on a fix

---

## Contributing Code

We accept contributions via Pull Requests on GitHub. Here's how to get started:

### Types of Contributions

- **Bug Fixes**: Fix issues reported in GitHub Issues
- **New Features**: Add new functionality (discuss in an issue first for large features)
- **Documentation**: Improve README, code comments, or user guides
- **Tests**: Add or improve test coverage
- **Performance**: Optimize existing code
- **Refactoring**: Improve code quality without changing behavior

### Before You Start

For significant changes:
1. **Open an Issue First**: Discuss your proposed changes
2. **Get Feedback**: Wait for maintainer input on approach
3. **Agree on Design**: Ensure alignment before investing time

For small changes (typos, small bugs, documentation):
- Feel free to submit a PR directly

---

## Development Setup

### Prerequisites

- **Node.js** >= 22
- **Go** >= 1.21
- **Docker & Docker Compose**
- **Mage** ([installation instructions](https://magefile.org/))
- **Git**

### Initial Setup

```bash
# Fork the repository on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/ask-o11y-plugin.git
cd ask-o11y-plugin

# Add upstream remote
git remote add upstream https://github.com/Consensys/ask-o11y-plugin.git

# Install dependencies
npm install

# Build the plugin
npm run build

# Start development environment
npm run server

# Access Grafana at http://localhost:3000
# Default credentials: admin/admin
```

### Development Workflow

**Frontend Development (Hot Reload):**
```bash
npm run dev
```
Changes to React components will reload automatically.

**Backend Development:**
```bash
# Build backend for current platform
npm run build:backend

# Restart Grafana to load new binary
docker compose restart grafana

# Watch Grafana logs
docker compose logs -f grafana
```

**Testing:**
```bash
# Frontend unit tests (watch mode)
npm test

# Frontend tests (CI mode)
npm run test:ci

# Backend tests
go test ./pkg/...

# E2E tests (requires running server)
npm run e2e

# Type checking
npm run typecheck

# Linting
npm run lint
npm run lint:fix
```

### Keeping Your Fork Updated

```bash
# Fetch upstream changes
git fetch upstream

# Rebase your branch on upstream/main
git rebase upstream/main

# Push to your fork (force push if already pushed)
git push origin your-branch-name --force-with-lease
```

---

## Code Standards

### Frontend (TypeScript/React)

**Style Guide:**
- Use `@grafana/eslint-config` (enforced by ESLint)
- **Indentation**: 2 spaces
- **Quotes**: Single quotes preferred
- **Semicolons**: Required
- **Max Line Length**: 120 characters

**TypeScript Standards:**
- **Strict Mode**: Always enabled
- **No `any` Types**: Use proper types or `unknown`
- **Interface Over Type**: Prefer interfaces for objects
- **Async/Await**: Use instead of `.then()/.catch()`

**React Standards:**
- **Functional Components**: No class components
- **Hooks**: Use custom hooks for business logic
- **Memoization**: Use `useMemo`/`useCallback` for expensive operations
- **Props Interfaces**: Always define TypeScript interfaces for props

**Theme Integration (CRITICAL):**
```tsx
// ✅ CORRECT: Use Grafana theme classes
<div className="bg-background text-primary border-weak">

// ❌ WRONG: Never hardcode colors
<div className="bg-gray-900 text-white border-gray-700">
```

**Semantic Tailwind Classes:**
- Backgrounds: `bg-background`, `bg-secondary`, `bg-surface`
- Text: `text-primary`, `text-secondary`, `text-disabled`
- Borders: `border-weak`, `border-medium`, `border-strong`

### Backend (Go)

**Style Guide:**
- Follow standard Go formatting (`gofmt`)
- Use `golangci-lint` (enforced by CI)
- **Naming**: camelCase for private, PascalCase for public
- **Error Handling**: Always check errors, return early
- **Context**: Pass `context.Context` as first parameter

**Grafana Plugin Patterns:**
- Use Grafana Plugin SDK types and interfaces
- Follow standard plugin architecture
- Handle plugin context properly
- Log errors with appropriate severity

### File Organization

```
src/
├── components/      # React UI components
│   ├── App/        # Main app shell
│   ├── Chat/       # Chat interface
│   └── AppConfig/  # Configuration UI
├── core/           # Domain layer (Clean Architecture)
│   ├── models/     # Domain models
│   ├── repositories/ # Data access interfaces
│   └── services/   # Business logic
├── services/       # Application services
├── pages/          # Top-level page components
└── utils/          # Utility functions

pkg/
├── main.go         # Backend entry point
├── plugin/         # Plugin implementation, routes, RBAC
└── mcp/            # MCP client, proxy, health
```

---

## Testing Guidelines

### Frontend Testing

**Unit Tests:**
- Located in `tests/` directory
- Use Jest + React Testing Library
- Filename pattern: `*.test.tsx` or `*.test.ts`
- Use `data-testid` from `src/components/testIds.ts`

**What to Test:**
- Component rendering
- User interactions (clicks, input)
- State changes
- Error handling
- RBAC behavior (different user roles)

**Example:**
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatMessage } from './ChatMessage';

describe('ChatMessage', () => {
  it('renders user message correctly', () => {
    render(<ChatMessage role="user" content="Hello" />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('calls onCopy when copy button clicked', () => {
    const onCopy = jest.fn();
    render(<ChatMessage role="assistant" content="Response" onCopy={onCopy} />);
    fireEvent.click(screen.getByTestId('copy-button'));
    expect(onCopy).toHaveBeenCalled();
  });
});
```

**E2E Tests:**
- Use Playwright
- Test complete user workflows
- Located in `tests/e2e/`
- Run against real Grafana instance

### Backend Testing

**Unit Tests:**
- Use Go's built-in testing package
- Filename pattern: `*_test.go`
- Test coverage for critical paths

**What to Test:**
- RBAC filtering logic
- MCP client connections
- Tool execution
- Error handling
- Multi-tenant isolation

**Example:**
```go
func TestCanAccessTool(t *testing.T) {
    tests := []struct {
        role     string
        toolName string
        expected bool
    }{
        {"Admin", "grafana-create-dashboard", true},
        {"Viewer", "grafana-create-dashboard", false},
        {"Viewer", "grafana-query-prometheus", true},
    }

    for _, tt := range tests {
        result := canAccessTool(tt.role, tt.toolName)
        if result != tt.expected {
            t.Errorf("canAccessTool(%s, %s) = %v, want %v",
                tt.role, tt.toolName, result, tt.expected)
        }
    }
}
```

### Test Requirements for PRs

✅ **Required:**
- All new code must have unit tests
- Existing tests must pass
- No decrease in code coverage

✅ **Recommended:**
- Add E2E tests for new user-facing features
- Test edge cases and error conditions
- Test with different user roles (RBAC)

---

## Pull Request Process

### Creating a Pull Request

1. **Create a Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/issue-123
   ```

2. **Make Your Changes**
   - Write clean, well-commented code
   - Follow code standards
   - Add tests for new functionality
   - Update documentation if needed

3. **Test Locally**
   ```bash
   npm run lint
   npm run typecheck
   npm test
   go test ./pkg/...
   ```

4. **Commit Your Changes**
   - Use conventional commit format (see below)
   - Keep commits focused and atomic
   - Include issue references

5. **Push to Your Fork**
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Open a Pull Request**
   - Use the PR template (if available)
   - Provide clear description of changes
   - Link related issues: "Fixes #123" or "Relates to #456"
   - Add screenshots for UI changes
   - List breaking changes if any

### PR Title Format

Use conventional commit format:
```
<type>(<scope>): <description>

Examples:
feat(chat): add message export functionality
fix(mcp): resolve connection timeout issue
docs(readme): update installation instructions
refactor(session): extract validation logic
test(chat): add streaming message tests
```

### PR Description Template

```markdown
## Description
Brief summary of changes and why they're needed.

## Related Issues
Fixes #123
Relates to #456

## Changes
- Added X feature to Y component
- Fixed Z bug in A service
- Updated B documentation

## Screenshots (if applicable)
[Add screenshots for UI changes]

## Testing
- [ ] Unit tests added/updated
- [ ] E2E tests added/updated
- [ ] Manual testing completed
- [ ] Tested with different user roles (Admin, Editor, Viewer)

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex logic
- [ ] Documentation updated
- [ ] No new warnings introduced
- [ ] Tests pass locally
```

### Code Review Process

**What to Expect:**
1. **Automated Checks**: CI will run tests, linting, and builds
2. **Maintainer Review**: A maintainer will review your code
3. **Feedback**: You may receive comments or change requests
4. **Iteration**: Address feedback and push updates
5. **Approval**: Once approved, maintainers will merge

**Review Timeline:**
- Small PRs (< 100 lines): 1-3 days
- Medium PRs (100-500 lines): 3-7 days
- Large PRs (> 500 lines): 1-2 weeks

**Tips for Faster Review:**
- Keep PRs small and focused
- Write clear descriptions
- Respond promptly to feedback
- Pass all automated checks
- Follow code standards

### Handling Merge Conflicts

If your PR has merge conflicts:

```bash
# Fetch latest changes
git fetch upstream

# Rebase on upstream/main
git checkout your-branch-name
git rebase upstream/main

# Resolve conflicts in your editor
# After resolving, continue rebase
git add .
git rebase --continue

# Force push to your fork
git push origin your-branch-name --force-with-lease
```

---

## Commit Message Guidelines

We use **Conventional Commits** for clear, structured commit history.

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type

- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **style**: Formatting, missing semicolons, etc.
- **refactor**: Code restructuring without behavior change
- **test**: Adding or updating tests
- **chore**: Maintenance tasks, dependency updates
- **perf**: Performance improvements

### Scope

Optional, but recommended. Examples:
- `chat` - Chat interface components
- `mcp` - MCP integration
- `session` - Session management
- `rbac` - Role-based access control
- `config` - Configuration
- `backend` - Backend/Go code
- `frontend` - Frontend/React code

### Subject

- Use imperative mood ("add" not "added" or "adds")
- Don't capitalize first letter
- No period at the end
- Max 72 characters

### Body (Optional)

- Explain the "why" not the "what"
- Wrap at 72 characters
- Separate from subject with blank line

### Footer (Optional)

- Reference issues: `Fixes #123`, `Closes #456`
- Note breaking changes: `BREAKING CHANGE: ...`

### Examples

**Simple commit:**
```
feat(chat): add message export functionality
```

**With body:**
```
fix(mcp): resolve connection timeout issue

The MCP client was not properly handling network timeouts,
causing the plugin to hang. Added timeout configuration and
proper error handling for connection failures.

Fixes #123
```

**Breaking change:**
```
feat(api): change tool call response format

BREAKING CHANGE: Tool call responses now return structured
error objects instead of plain strings. Update client code
to handle the new format.

Fixes #456
```

---

## Community

### Ways to Contribute Beyond Code

Not a developer? You can still contribute!

- **Documentation**: Improve guides, fix typos, add examples
- **Bug Reports**: Report issues with detailed reproduction steps
- **Feature Ideas**: Suggest improvements and new features
- **Community Support**: Help others in GitHub Discussions
- **Testing**: Test pre-release versions and provide feedback
- **Tutorials**: Write blog posts or create video tutorials
- **Translations**: Help translate documentation (future)

### Communication Channels

- **GitHub Issues**: Bug reports and feature requests
- **GitHub Discussions**: Questions and community discussions

### Recognition

Contributors will be:
- Listed in release notes for their contributions
- Mentioned in the project's acknowledgments
- Credited in commit history

---

## Additional Resources

- **[README.md](README.md)**: Project overview and quick start
- **[AGENTS.md](AGENTS.md)**: Comprehensive developer guide
- **[src/README.md](src/README.md)**: Feature documentation
- **[Grafana Plugin Development](https://grafana.com/developers/plugin-tools/)**: Official Grafana docs
- **[Model Context Protocol](https://modelcontextprotocol.io/)**: MCP specification

---

## License

By contributing to Ask O11y, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for contributing to Ask O11y!**

Your efforts help make observability more accessible for everyone. If you have questions about contributing, don't hesitate to reach out via GitHub Discussions.
