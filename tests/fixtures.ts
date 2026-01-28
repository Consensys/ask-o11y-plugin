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
export async function deleteAllPersistedSessions(page: Page) {
  // Wait for page to load
  const chatInput = page.getByLabel('Chat input');
  await chatInput.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

  // Try to open the sidebar - check if we're on welcome screen or in a chat
  const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
  const isWelcomeVisible = await welcomeHeading.isVisible().catch(() => false);

  if (isWelcomeVisible) {
    // On welcome screen - use the "View chat history" button
    const historyButton = page.getByText(/View chat history/);
    if (await historyButton.isVisible().catch(() => false)) {
      await historyButton.click();
    }
  } else {
    // In a chat - use the History button in header
    const historyButtonInHeader = page.getByRole('button', { name: /History/i });
    if (await historyButtonInHeader.isVisible().catch(() => false)) {
      await historyButtonInHeader.click();
    }
  }

  // Wait for sidebar to open
  await page.getByRole('heading', { name: 'Chat History' }).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

  // Find all session items using data-testid
  const sessionItems = page.getByTestId('session-item');
  let sessionCount = await sessionItems.count();
  
  // If no sessions, we're done
  if (sessionCount === 0) {
    // Close sidebar and return
    const closeButton = page.locator('button[title="Close"]');
    if (await closeButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await closeButton.click();
    }
    return;
  }

  // Use "Clear All History" button if available (more efficient)
  const clearAllButton = page.getByRole('button', { name: /Clear All History/i });
  if (await clearAllButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    // Set up dialog handler BEFORE clicking to avoid race condition
    // Use page.once to auto-accept the confirm dialog
    page.once('dialog', dialog => dialog.accept());

    // Click the button - the dialog will be auto-accepted
    await clearAllButton.click();

    // Wait for sessions to be deleted - check that session count becomes 0
    await page.waitForFunction(
      () => {
        const items = document.querySelectorAll('[data-testid="session-item"]');
        return items.length === 0;
      },
      { timeout: 10000 }
    ).catch(() => {
      // If timeout, log warning but continue (sessions might already be deleted)
      console.warn('[deleteAllPersistedSessions] Timeout waiting for sessions to clear');
    });

    // Wait for storage operations to complete
    await page.waitForTimeout(1000);
  } else {
    // Fallback: delete sessions one by one (limited to prevent timeouts)
    let maxIterations = Math.min(sessionCount, 10); // Limit to 10 deletions max
    for (let i = 0; i < maxIterations && sessionCount > 0; i++) {
      const sessionItem = sessionItems.first();
      
      if (!(await sessionItem.isVisible({ timeout: 1000 }).catch(() => false))) {
        break;
      }

      // Hover to reveal delete button
      await sessionItem.hover();

      // Look for delete button - try icon button first
      const deleteButton = sessionItem
        .locator('button[title*="Delete"]')
        .or(sessionItem.locator('button[aria-label*="delete" i]'))
        .or(sessionItem.locator('button').filter({ hasText: /delete/i }))
        .first();

      if (await deleteButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await deleteButton.click();
        // Wait for UI update after deletion
        await page.waitForTimeout(300);
        
        // Re-count sessions after deletion
        const newCount = await sessionItems.count();
        if (newCount >= sessionCount) {
          // No progress, break to avoid infinite loop
          break;
        }
        sessionCount = newCount;
      } else {
        // If delete button not found, break to avoid infinite loop
        break;
      }
    }
  }

  // Close the sidebar using the close button
  const closeButton = page.locator('button[title="Close"]');
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
    // Wait for sidebar to fully close
    await page.getByRole('heading', { name: 'Chat History' }).waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {});
  } else {
    // Fallback: try clicking outside the sidebar to close it
    const chatInput = page.getByLabel('Chat input');
    if (await chatInput.isVisible().catch(() => false)) {
      await chatInput.click().catch(() => {});
    }
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

/**
 * Helper function to disable built-in MCP mode if it's enabled.
 *
 * @deprecated This function is no longer needed since combined mode is now supported.
 * External MCP servers can be configured even when built-in MCP is enabled.
 * Kept for backward compatibility with existing tests.
 */
export async function disableBuiltInMCP(_page: Page) {
  // No-op: External MCP configuration is now always available (combined mode supported)
  console.log('[disableBuiltInMCP] Skipped: External MCP is always available (combined mode)');
}

