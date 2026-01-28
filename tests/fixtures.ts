import { AppConfigPage, AppPage, test as base } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import pluginJson from '../src/plugin.json';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

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
 * Now deletes ALL persisted sessions to ensure a completely clean state.
 */
export async function clearPersistedSession(page: Page) {
  // Wait for page to load
  const chatInput = page.getByLabel('Chat input');
  await chatInput.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

  // Delete all existing sessions first to ensure a clean slate
  await deleteAllPersistedSessions(page);

  // After deleting sessions, check if we're on welcome screen
  const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
  const isWelcomeVisible = await welcomeHeading.isVisible().catch(() => false);

  if (!isWelcomeVisible) {
    // If not on welcome screen, click "New Chat" to clear the current view
    const newChatButton = page.getByRole('button', { name: /New Chat/i });
    if (await newChatButton.isVisible().catch(() => false)) {
      await newChatButton.click();
      const confirmButton = page.getByRole('button', { name: 'Yes' });
      if (await confirmButton.isVisible().catch(() => false)) {
        await confirmButton.click();
      }
    }
  }

  // Verify welcome message is now visible
  await welcomeHeading.waitFor({ state: 'visible', timeout: 10000 });
}

/**
 * Helper function to delete all persisted chat sessions.
 * This should be called before tests that need a clean slate with no existing sessions.
 */
export async function deleteAllPersistedSessions(page: Page): Promise<void> {
  // Wait for page to load
  const chatInput = page.getByLabel('Chat input');
  await chatInput.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

  // Open the history sidebar
  const sidebarOpened = await openHistorySidebar(page);
  if (!sidebarOpened) {
    console.warn('[deleteAllPersistedSessions] Could not open sidebar - skipping deletion');
    return;
  }

  // Find all session items
  const sessionItems = page.getByTestId('session-item');
  const sessionCount = await sessionItems.count();

  // If no sessions, close sidebar and return
  if (sessionCount === 0) {
    await closeSidebar(page);
    return;
  }

  // Try to clear all sessions at once, fall back to one-by-one deletion
  const cleared = await clearAllSessionsViaButton(page);
  if (!cleared) {
    await deleteSessionsOneByOne(page, sessionItems);
  }

  await closeSidebar(page);
}

/**
 * Open the history sidebar, handling both welcome screen and chat views.
 */
async function openHistorySidebar(page: Page): Promise<boolean> {
  const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
  const isWelcomeVisible = await welcomeHeading.isVisible().catch(() => false);

  if (isWelcomeVisible) {
    const historyButton = page.getByText(/View chat history/);
    if (await historyButton.isVisible().catch(() => false)) {
      await historyButton.click();
    }
  } else {
    const historyButtonInHeader = page.getByRole('button', { name: /History/i });
    if (await historyButtonInHeader.isVisible().catch(() => false)) {
      await historyButtonInHeader.click();
    }
  }

  const sidebarHeading = page.getByRole('heading', { name: 'Chat History' });
  return await sidebarHeading.isVisible({ timeout: 5000 }).catch(() => false);
}

/**
 * Close the history sidebar.
 */
async function closeSidebar(page: Page): Promise<void> {
  const closeButton = page.locator('button[title="Close"]');
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
    // Wait for sidebar to close
    await page.getByRole('heading', { name: 'Chat History' }).waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {
      console.warn('[deleteAllPersistedSessions] Sidebar did not close properly');
    });
  } else {
    // Fallback: try clicking the chat input to close sidebar
    console.warn('[deleteAllPersistedSessions] Close button not found, trying fallback method');
    const chatInput = page.getByLabel('Chat input');
    if (await chatInput.isVisible().catch(() => false)) {
      await chatInput.click().catch(() => {});
    }
  }
}

/**
 * Try to clear all sessions using the "Clear All History" button.
 * Returns true if successful, false if button not found.
 */
async function clearAllSessionsViaButton(page: Page): Promise<boolean> {
  const clearAllButton = page.getByRole('button', { name: /Clear All History/i });
  if (!(await clearAllButton.isVisible({ timeout: 2000 }).catch(() => false))) {
    return false;
  }

  // Set up dialog handler before clicking
  page.once('dialog', (dialog) => dialog.accept());
  await clearAllButton.click();

  // Wait for sessions to be deleted
  const deletionSucceeded = await page
    .waitForFunction(() => document.querySelectorAll('[data-testid="session-item"]').length === 0, { timeout: 10000 })
    .then(() => true)
    .catch(() => false);

  if (!deletionSucceeded) {
    console.warn('[deleteAllPersistedSessions] Timeout waiting for sessions to clear');
  }

  // Wait for storage operations
  await page.waitForTimeout(1000);

  const remaining = await page.getByTestId('session-item').count();
  if (remaining > 0) {
    console.error(`[deleteAllPersistedSessions] Failed to delete all sessions - ${remaining} remaining`);
  }

  return true;
}

/**
 * Delete sessions one by one (fallback when Clear All button is unavailable).
 */
async function deleteSessionsOneByOne(
  page: Page,
  sessionItems: ReturnType<Page['getByTestId']>
): Promise<void> {
  let sessionCount = await sessionItems.count();
  const maxIterations = Math.min(sessionCount, 10);

  for (let i = 0; i < maxIterations && sessionCount > 0; i++) {
    const sessionItem = sessionItems.first();

    if (!(await sessionItem.isVisible({ timeout: 1000 }).catch(() => false))) {
      break;
    }

    await sessionItem.hover();

    const deleteButton = sessionItem
      .locator('button[title*="Delete"]')
      .or(sessionItem.locator('button[aria-label*="delete" i]'))
      .or(sessionItem.locator('button').filter({ hasText: /delete/i }))
      .first();

    if (!(await deleteButton.isVisible({ timeout: 1000 }).catch(() => false))) {
      break;
    }

    await deleteButton.click();
    await page.waitForTimeout(300);

    const newCount = await sessionItems.count();
    if (newCount >= sessionCount) {
      break; // No progress, avoid infinite loop
    }
    sessionCount = newCount;
  }
}

/**
 * Helper function to reset rate limits in Redis.
 * This should be called before tests that create multiple shares to avoid rate limiting issues.
 * Uses docker compose to execute redis-cli commands.
 *
 * Note: This function will silently fail if Redis is not available (e.g., using in-memory storage),
 * allowing tests to continue running.
 */
export async function resetRateLimits() {
  try {
    // First, get all rate limit keys
    // Use --no-warnings to suppress warnings when no keys are found
    const keysOutput = execSync(
      'docker compose exec -T redis redis-cli --scan --pattern "ratelimit:*" 2>/dev/null || true',
      { encoding: 'utf-8', stdio: 'pipe', timeout: 5000, shell: '/bin/bash' }
    ).trim();

    // If there are keys, delete them
    if (keysOutput) {
      const keyList = keysOutput.split('\n').filter(k => k.trim());
      if (keyList.length > 0) {
        // Delete all rate limit keys at once
        // Escape keys to handle special characters
        const escapedKeys = keyList.map(k => `"${k}"`).join(' ');
        execSync(
          `docker compose exec -T redis redis-cli DEL ${escapedKeys} 2>/dev/null || true`,
          { encoding: 'utf-8', stdio: 'pipe', timeout: 5000, shell: '/bin/bash' }
        );
      }
    }
  } catch (error) {
    // If docker compose or redis is not available, silently fail
    // This allows tests to run even if Redis is not running (using in-memory storage)
    // The error is expected when Redis is not available, so we don't log it
  }
}

