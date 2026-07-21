# E2E Tests

This directory contains Playwright end-to-end tests for the Ask O11y plugin.

## Prerequisites

### LLM API Key Required

**IMPORTANT**: E2E tests that involve AI chat functionality require a valid Anthropic API key.

**Note**: The environment variable is `LLM_API_KEY` (used by `grafana-llm-app`), even though the key comes from Anthropic.

1. Create a `.env` file in the project root (copy from `.env.example`):
   ```bash
   cp .env.example .env
   ```

2. Add your Anthropic API key:
   ```
   LLM_API_KEY=sk-ant-api03-xxxxx
   ```

3. Get your API key from: https://console.anthropic.com/

### Without an API Key

If you don't have an API key, the following tests will fail:
- `tests/chatFlows.spec.ts` - Tests that send messages and expect AI responses
- `tests/chatInteractions.spec.ts` - Tests that verify multi-turn conversations
- `tests/errorHandling.spec.ts` - Tests that check message handling

Other tests (UI-only, configuration, navigation) will pass without an API key.

## Running Tests

```bash
# Start the development server (required)
npm run server

# In another terminal, run E2E tests
npm run e2e

# Run specific test file
npm run e2e -- tests/chatFlows.spec.ts

# Run in headed mode (see the browser)
npm run e2e -- --headed

# Debug mode
npm run e2e -- --debug
```

## Test Structure

- `fixtures.ts` - Shared test fixtures and utilities
- `*.spec.ts` - Test files organized by feature
- Coverage reports are generated in `coverage-e2e/` when `COVERAGE=true`

### Test Execution Strategy

Tests are organized into projects with different parallelization strategies:

- **Session tests** (`session*.spec.ts`): Run serially (1 worker) to avoid storage conflicts
- **LLM-dependent tests** (`chatFlows`, `chatInteractions`, `sidePanel`, `errorHandling`): Run serially (1 worker) to avoid LLM API rate limiting
- **UI-only tests** (all others): Run in parallel (6 workers) for speed

This ensures reliable test execution while maximizing performance for tests that don't have concurrency constraints.

## Debugging Failed Tests

1. Check Grafana logs: `docker compose logs -f grafana`
2. Look for "Agent run failed" messages
3. Verify `.env` file has correct `LLM_API_KEY`
4. Ensure development server is running
5. Check test output for specific error messages

## Test Categories

- **Chat Tests**: `chatFlows.spec.ts`, `chatInteractions.spec.ts`, `chatStreaming.spec.ts`
- **Session Tests**: `sessionManagement.spec.ts`, `sessionSharing.spec.ts`, `sessionSidebar*.spec.ts`
- **Config Tests**: `appConfig*.spec.ts`, `systemPrompt.spec.ts`
- **UI Tests**: `appNavigation.spec.ts`, `appLoading.spec.ts`, `sidePanel.spec.ts`
- **Error Handling**: `errorHandling.spec.ts`
