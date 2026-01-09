# Run All Tests and Fix Failures

## Overview

Execute the full test suite and systematically fix any failures, ensuring code
quality and functionality. All test-related commands must pass before completion.

## Test Commands

Run these commands in order. All must pass:

```bash
# 1. Unit tests (Jest)
npm run test:ci

# 2. TypeScript type checking
npm run typecheck

# 3. Linting (ESLint)
npm run lint

# 4. E2E tests (Playwright) - requires running server
npm run e2e
```

## Execution Steps

### 1. Run the Full Test Suite

Execute all test commands sequentially:

```bash
npm run test:ci && npm run typecheck && npm run lint && npm run e2e
```

**Requirements:**

- All commands must exit with code 0
- No test should be skipped unless marked with `// IMPORTANT: <reason>` comment
- If a test uses `test.skip()` without an `IMPORTANT` comment, fix the test so it runs
- Warnings are acceptable; errors are not

### 2. Analyze Failures

For each failure, determine:

| Category       | Description                    | Priority |
| -------------- | ------------------------------ | -------- |
| **Type Error** | TypeScript compilation failure | High     |
| **Lint Error** | ESLint rule violation          | Medium   |
| **Unit Test**  | Jest test failure              | High     |
| **E2E Test**   | Playwright test failure        | High     |
| **Flaky**      | Intermittent failures          | Medium   |

**Investigation checklist:**

- Check if the failure is in test code or source code
- Look for recent changes that might have caused it
- Check error context files in `test-results/` for E2E failures
- Review console output for stack traces

### 3. Fix Issues Systematically

**Order of operations:**

1. Fix TypeScript errors first (blocks other tests)
2. Fix ESLint errors second
3. Fix unit test failures
4. Fix E2E test failures last

**For each fix:**

- Make the minimal change needed
- Re-run the specific test to verify
- Run full suite before moving to next issue

### 4. Handle Skipped Tests

If you encounter `test.skip()`:

- Check for `// IMPORTANT:` comment explaining why
- If no comment exists, investigate and fix the test
- Valid reasons to skip: external dependency unavailable, feature flag disabled
- Invalid reasons: flaky test, "fix later", no explanation

### 5. Final Verification

Run the complete suite one final time:

```bash
npm run test:ci && npm run typecheck && npm run lint && npm run e2e
```

## Common Issues & Solutions

| Issue                                 | Solution                                                        |
| ------------------------------------- | --------------------------------------------------------------- |
| Missing dependencies                  | Run `npm install` with network permissions                      |
| E2E tests fail with "LLM not enabled" | Tests should handle both LLM enabled/disabled states gracefully |
| TypeScript module not found           | Check imports and run `npm install`                             |
| Jest can't find module                | Clear cache: `npx jest --clearCache`                            |
| Playwright timeout                    | Ensure server is running: `npm run server`                      |

## Test Recovery Checklist

- [ ] `npm run test:ci` passes (0 failures)
- [ ] `npm run typecheck` passes (no errors)
- [ ] `npm run lint` passes (0 errors, warnings acceptable)
- [ ] `npm run e2e` passes (all tests pass or skip with IMPORTANT comment)
- [ ] No unauthorized `test.skip()` calls remain
- [ ] All fixes verified with re-run
- [ ] Summary of changes provided to user
