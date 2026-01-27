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
 */
export async function clearPersistedSession(page: Page) {
  // Wait for page to load
  const chatInput = page.getByLabel('Chat input');
  await chatInput.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

  // Wait a bit for the page to fully render
  await page.waitForTimeout(500);

  // Check if welcome heading is already visible
  const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
  const isWelcomeAlreadyVisible = await welcomeHeading.isVisible().catch(() => false);

  if (isWelcomeAlreadyVisible) {
    // Welcome screen is already showing, nothing to clear
    return;
  }

  // If there's a "New Chat" button visible, there's an existing session - clear it
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

  // Wait for the welcome message to be visible after clearing
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

  // Find all session items
  const sessionItems = page.locator('.p-1\\.5.rounded.group');
  let sessionCount = await sessionItems.count();
  
  // If no sessions, we're done
  if (sessionCount === 0) {
    // Close sidebar and return
    const closeButton = page.locator('button[title="Close"]');
    if (await closeButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await closeButton.click();
    }
    await page.waitForTimeout(300);
    return;
  }

  // Use "Clear All History" button if available (more efficient)
  const clearAllButton = page.getByRole('button', { name: /Clear All History/i });
  if (await clearAllButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    // Accept the confirmation dialog
    page.once('dialog', async dialog => {
      await dialog.accept();
    });
    await clearAllButton.click();
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
      await page.waitForTimeout(200);

      // Look for delete button - try icon button first
      const deleteButton = sessionItem
        .locator('button[title*="Delete"]')
        .or(sessionItem.locator('button[aria-label*="delete" i]'))
        .or(sessionItem.locator('button').filter({ hasText: /delete/i }))
        .first();

      if (await deleteButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await deleteButton.click();
        // Wait for deletion confirmation if needed, then wait for UI update
        await page.waitForTimeout(500);
        
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
  } else {
    // Fallback: try clicking the backdrop (the overlay div)
    const backdrop = page.locator('.fixed.inset-0 > div.absolute.inset-0').first();
    if (await backdrop.isVisible().catch(() => false)) {
      await backdrop.click();
    }
  }

  // Wait for sidebar to close
  await page.waitForTimeout(500);
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

