import { AppConfigPage, AppPage, test as base } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import pluginJson from '../src/plugin.json';
import * as fs from 'fs';
import * as path from 'path';

type AppTestFixture = {
  appConfigPage: AppConfigPage;
  gotoPage: (path?: string) => Promise<AppPage>;
};

// Coverage output directory
const COVERAGE_DIR = path.join(process.cwd(), 'coverage-e2e', '.nyc_output');

// Ensure coverage directory exists
if (process.env.COVERAGE === 'true') {
  fs.mkdirSync(COVERAGE_DIR, { recursive: true });
}

export const test = base.extend<AppTestFixture>({
  appConfigPage: async ({ gotoAppConfigPage }, use) => {
    const configPage = await gotoAppConfigPage({
      pluginId: pluginJson.id,
    });
    await use(configPage);
  },
  gotoPage: async ({ gotoAppPage }, use) => {
    await use((path) =>
      gotoAppPage({
        path,
        pluginId: pluginJson.id,
      })
    );
  },

  // Auto-use fixture for coverage collection
  page: async ({ page }, use, testInfo) => {
    // Use the page as normal
    await use(page);

    // After test: collect coverage if enabled
    if (process.env.COVERAGE === 'true') {
      try {
        // Get Istanbul coverage from the browser's window object
        const coverage = await page.evaluate(() => {
          // Istanbul stores coverage in window.__coverage__
          return (window as unknown as { __coverage__?: Record<string, unknown> }).__coverage__;
        });

        if (coverage) {
          // Generate a unique filename for this test's coverage
          const sanitizedTitle = testInfo.title.replace(/[^a-zA-Z0-9]/g, '_');
          const coverageFile = path.join(COVERAGE_DIR, `coverage_${sanitizedTitle}_${Date.now()}.json`);
          fs.writeFileSync(coverageFile, JSON.stringify(coverage));
        }
      } catch {
        // Coverage collection failed, likely no instrumented code loaded
        // This is expected for some pages
      }
    }
  },
});

export { expect } from '@grafana/plugin-e2e';

/**
 * Helper function to clear any persisted chat session to ensure the welcome message is visible.
 * This should be called before tests that expect the welcome heading to be visible.
 */
export async function clearPersistedSession(page: Page) {
  // Wait for page to load - check if there's an existing chat session
  const chatInput = page.getByLabel('Chat input');
  await chatInput.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

  // Wait a bit for the page to fully render
  await page.waitForTimeout(500);

  // If there's a "New Chat" button visible, there's an existing session - clear it first
  const newChatButton = page.getByRole('button', { name: /New Chat/i });
  const hasExistingSession = await newChatButton.isVisible().catch(() => false);
  
  if (hasExistingSession) {
    // Clear existing session to show welcome message
    await newChatButton.click();
    const confirmButton = page.getByRole('button', { name: 'Yes' });
    if (await confirmButton.isVisible().catch(() => false)) {
      await confirmButton.click();
      // Wait for the confirmation dialog to close
      await page.waitForTimeout(500);
    }
  }
  
  // Always wait for the welcome message to be visible (whether we cleared a session or not)
  await page.getByRole('heading', { name: 'Ask O11y Assistant' }).waitFor({ state: 'visible', timeout: 10000 });
}
