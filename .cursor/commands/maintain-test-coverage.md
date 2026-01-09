# Maintain Test Coverage

## Overview

Achieve 65% line coverage through a combination of E2E tests and unit tests. Coverage reports are merged from both test types into a single unified report.

## Commands

| Command                  | Description                                         |
| ------------------------ | --------------------------------------------------- |
| `npm run coverage`       | Run all tests and generate combined coverage report |
| `npm run coverage:e2e`   | Run only E2E tests with coverage (standalone)       |
| `npm run coverage:unit`  | Run only unit tests with coverage                   |
| `npm run coverage:merge` | Merge existing coverage outputs                     |

## Workflow

1. **Run Combined Coverage**

   ```bash
   npm run coverage
   ```

   This command:

   - Cleans previous coverage data
   - Runs unit tests with coverage
   - Builds frontend with instrumentation
   - Runs E2E tests with coverage
   - Merges all coverage into `coverage-combined/`

2. **Review Coverage Report**

   - Check terminal output for line percentage
   - Open `coverage-combined/index.html` for detailed report
   - If line coverage is below 65%, continue to step 3

3. **Add Tests for Uncovered Code**

   - **E2E tests**: Add to `tests/` directory using Playwright
   - **Unit tests**: Add to `src/**/__tests__/` or `src/**/*.test.ts`
   - Re-run `npm run coverage` to verify improvement

4. **Iterate Until 65% Line Coverage**

## Test Strategy

### E2E Tests (Playwright) - `tests/`

Best for:

- React components with user interactions
- Page navigation and routing
- Form submissions and validations
- Visual state changes

### Unit Tests (Jest) - `src/**/__tests__/`

Best for:

- Pure utility functions
- Data transformation logic
- Parsers and validators
- Service classes with mockable dependencies

## Priority Areas

### E2E (UI Components)

1. Chat Input & Submission
2. Session Management
3. AppConfig settings
4. System Prompt Configuration

### Unit Tests (Services)

1. `src/services/validation.ts`
2. `src/services/tokenizer.ts`
3. `src/services/memory.ts`
4. `src/components/Chat/utils/promqlParser.ts`

## Checklist

- [ ] Run `npm run coverage` for combined baseline
- [ ] Review `coverage-combined/index.html` for gaps
- [ ] Add E2E tests for low-coverage UI components
- [ ] Add unit tests for low-coverage services
- [ ] Verify coverage reaches 65% line coverage

## Notes

- Server must be running for E2E: `npm run server`
- Unit tests run independently (no server needed)
- Coverage outputs: `coverage-unit/`, `coverage-e2e/`, `coverage-combined/`
- When you need to write new tests to reach the 65% target, establish a solid plan so you don't always have to run the `npm run coverage` command every time to check that the coverage has increased. Each `npm run coverage` command should be executed in the spirit of reaching 65%. Minimize the number of times you execute `npm run coverage` or similar commands during all your process
