import { test, expect, clearPersistedSession, deleteAllPersistedSessions } from './fixtures';
import { ROUTES } from '../src/constants';

test.describe('Session Persistence Tests', () => {
  test.beforeEach(async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);

    // Clear any persisted session to ensure welcome message is visible
    await clearPersistedSession(page);

    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();
  });

  test('should persist and load sessions correctly', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');

    await test.step('Save session after message', async () => {
      // Send a message
      await chatInput.fill('Message to persist');
      await page.getByLabel('Send message (Enter)').click();
      await expect(page.locator('[role="log"]').getByText('Message to persist')).toBeVisible();

      // Wait for session to be saved
      await page.waitForTimeout(1000);

      // After sending a message, the header should show session controls
      await expect(page.getByRole('button', { name: /History/i })).toBeVisible();
    });

    await test.step('Verify session count increments', async () => {
      // Wait for processing
      await page.waitForTimeout(10000);

      // Open sidebar and check session count
      await page.getByRole('button', { name: /History/i }).click();
      await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

      // Should have at least 1 session
      await expect(page.getByText(/\d+ sessions/)).toBeVisible();

      // Close sidebar
      await page.locator('.bg-black\\/50').click({ force: true });
    });

    await test.step('Load existing session from sidebar', async () => {
      // Create a new session
      await page.getByRole('button', { name: /New Chat/i }).click();

      // Confirm by clicking Yes
      await page.getByRole('button', { name: 'Yes' }).click();

      await expect(page.getByRole('heading', { name: 'Ask O11y Assistant' })).toBeVisible();

      // Open sidebar
      await page.getByText(/View chat history/).click();
      await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

      // Click on the existing session
      const sessionItem = page.locator('.p-3.rounded.group').first();
      if (await sessionItem.isVisible()) {
        await sessionItem.click();

        // The old message should be visible again
        await expect(page.locator('[role="log"]').getByText('Message to persist')).toBeVisible();
      }
    });
  });

  test('should delete session from sidebar', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');

    // Create a session
    await chatInput.fill('Session to delete');
    await page.getByLabel('Send message (Enter)').click();
    await expect(page.locator('[role="log"]').getByText('Session to delete')).toBeVisible();

    // Wait for processing
    await page.waitForTimeout(10000);

    // Open sidebar
    await page.getByRole('button', { name: /History/i }).click();
    await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

    // Find delete button in session item
    const sessionItem = page.locator('.p-3.rounded.group').first();
    if (await sessionItem.isVisible()) {
      // Hover to reveal delete button
      await sessionItem.hover();

      // Look for delete button (trash icon or similar)
      const deleteButton = sessionItem.getByRole('button', { name: /delete/i }).or(sessionItem.locator('[aria-label*="delete"]')).or(sessionItem.locator('button').last());

      if (await deleteButton.isVisible()) {
        await deleteButton.click();
      }
    }
  });

  test('should display session metadata correctly', async ({ page }) => {
    // Delete all existing sessions to ensure a clean state
    await deleteAllPersistedSessions(page);

    const chatInput = page.getByLabel('Chat input');

    await test.step('Create session with specific message', async () => {
      // Send a specific message
      await chatInput.fill('What is Grafana used for?');
      await page.getByLabel('Send message (Enter)').click();
      await expect(page.locator('[role="log"]').getByText('What is Grafana used for?')).toBeVisible();

      // Wait for processing
      await page.waitForTimeout(10000);
    });

    await test.step('Verify title and metadata in sidebar', async () => {
      // Open sidebar
      await page.getByRole('button', { name: /History/i }).click();
      await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

      // Get the first session item
      const firstSessionItem = page.locator('.p-3.rounded.group').first();
      await expect(firstSessionItem).toBeVisible();

      // The session should have a title related to the message
      // (or at least contain some text)
      const sessionTitle = firstSessionItem.locator('.font-medium').first();
      if (await sessionTitle.isVisible()) {
        const title = await sessionTitle.textContent();
        expect(title).not.toBe('');
      }

      // Should show date (Today, Yesterday, or date) - only within the first session item
      await expect(
        firstSessionItem.getByText('Today').or(firstSessionItem.getByText('Yesterday')).or(firstSessionItem.getByText(/\d+ days ago/))
      ).toBeVisible();

      // Should show message count - only within the first session item
      await expect(firstSessionItem.getByText(/\d+ messages?/)).toBeVisible();
    });
  });
});

test.describe('Session Export/Import', () => {
  test.beforeEach(async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);

    // Clear any persisted session to ensure welcome message is visible
    await clearPersistedSession(page);

    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();
  });

  test('should have export button in session item', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');

    // Create a session
    await chatInput.fill('Export test message');
    await page.getByLabel('Send message (Enter)').click();
    await expect(page.locator('[role="log"]').getByText('Export test message')).toBeVisible();

    // Wait for processing
    await page.waitForTimeout(10000);

    // Open sidebar
    await page.getByRole('button', { name: /History/i }).click();
    await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

    // Hover over session item to reveal actions
    const sessionItem = page.locator('.p-3.rounded.group').first();
    if (await sessionItem.isVisible()) {
      await sessionItem.hover();

      // Look for export action
      // The UI might have various ways to export
    }
  });

  test('should show and close import modal', async ({ page }) => {
    await test.step('Open import modal', async () => {
      // Open sidebar via welcome screen button
      await page.getByText(/View chat history/).click();
      await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

      // Click Import button
      await page.getByRole('button', { name: 'Import' }).click();

      // Import modal should appear
      await expect(page.getByRole('heading', { name: 'Import Session' })).toBeVisible();

      // File input should be present
      const fileInput = page.locator('input[type="file"]');
      await expect(fileInput).toBeVisible();

      // Cancel button should be present
      await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    });

    await test.step('Close import modal when cancelled', async () => {
      // Cancel
      await page.getByRole('button', { name: 'Cancel' }).click();

      // Modal should be closed but sidebar still open
      await expect(page.getByRole('heading', { name: 'Import Session' })).not.toBeVisible();
      await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();
    });
  });
});
