import type { PluginOptions } from '@grafana/plugin-e2e';
import { defineConfig, devices } from '@playwright/test';
import { dirname } from 'node:path';

const pluginE2eAuth = `${dirname(require.resolve('@grafana/plugin-e2e'))}/auth`;

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig<PluginOptions>({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Default workers - overridden per project */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.GRAFANA_URL || 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    // 1. Login to Grafana and store the cookie on disk for use in other tests.
    {
      name: 'auth',
      testDir: pluginE2eAuth,
      testMatch: [/.*\.js/],
    },
    // 2. Run session-related tests serially (single worker) to avoid storage conflicts
    {
      name: 'chromium-session-tests',
      testMatch: [/session.*\.spec\.ts/],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/admin.json',
      },
      dependencies: ['auth'],
      fullyParallel: false,
      workers: 1, // Force single worker to avoid storage conflicts between test files
    },
    // 3. Run LLM-dependent tests with single worker to avoid rate limiting
    {
      name: 'chromium-llm-tests',
      testMatch: [
        /chatFlows\.spec\.ts/,
        /chatInteractions\.spec\.ts/,
        /sidePanel\.spec\.ts/,
        /errorHandling\.spec\.ts/,
      ],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/admin.json',
      },
      dependencies: ['chromium-session-tests'],
      fullyParallel: false,
      workers: 1, // Single worker to avoid LLM API rate limiting
    },
    // 4. Run other tests in parallel with multiple workers
    {
      name: 'chromium',
      testIgnore: [
        /session.*\.spec\.ts/,
        /chatFlows\.spec\.ts/,
        /chatInteractions\.spec\.ts/,
        /sidePanel\.spec\.ts/,
        /errorHandling\.spec\.ts/,
      ],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/admin.json',
      },
      dependencies: ['chromium-session-tests'],
      workers: 6, // Parallel execution for fast UI-only tests
    },
  ],
});
