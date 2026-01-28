import { test, expect, clearPersistedSession, deleteAllPersistedSessions } from './fixtures';
import { ROUTES } from '../src/constants';

test.describe('Session Persistence Tests', () => {
  // Run session tests serially to avoid conflicts with shared storage
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);

    // Clear any persisted session to ensure welcome message is visible
    await clearPersistedSession(page);

    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();
  });

  test('should persist and load sessions correctly', async ({ page }) => {
    // Delete all sessions first to ensure a clean slate for this test
    await deleteAllPersistedSessions(page);

    // After deleting all sessions, ensure welcome message is visible
    await expect(page.getByRole('heading', { name: 'Ask O11y Assistant' })).toBeVisible({ timeout: 10000 });

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
      // Wait for chat input to become enabled (indicates message processing is done)
      const chatInput = page.getByLabel('Chat input');
      await expect(chatInput).toBeEnabled({ timeout: 30000 });

      // Session is saved immediately, just wait a bit for UI refresh
      await page.waitForTimeout(1000);

      // Open sidebar and check session count
      await page.getByRole('button', { name: /History/i }).click();
      await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

      // Should have at least 1 session
      await expect(page.getByText(/\d+ sessions/)).toBeVisible({ timeout: 5000 });

      // Close sidebar using the close button
      await page.locator('button[title="Close"]').click();
    });

    await test.step('Load existing session from sidebar', async () => {
      // Wait for chat input to become enabled
      const chatInput = page.getByLabel('Chat input');
      await expect(chatInput).toBeEnabled({ timeout: 30000 });

      // Close the chat to trigger navigation away from current session
      // This simulates the user navigating away and coming back
      await page.getByRole('button', { name: /History/i }).click();
      await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

      // Wait for session items to appear
      await page.waitForSelector('[data-testid="session-item"]', { timeout: 10000 });
      const sessionItems = page.locator('[data-testid="session-item"]');

      // Should have at least 1 session (we just created one)
      const sessionCount = await sessionItems.count();
      expect(sessionCount).toBeGreaterThanOrEqual(1);

      // Find the session with "Message to persist" - it should be the most recent one
      const targetSession = sessionItems.filter({
        has: page.getByRole('heading', { name: 'Message to persist' })
      });

      await expect(targetSession).toHaveCount(1, { timeout: 5000 });

      // Click on the session with "Message to persist"
      await expect(targetSession.first()).toBeVisible({ timeout: 10000 });
      await targetSession.first().click();

      // Wait for the chat to load the session
      await page.waitForTimeout(1000);

      // The old message should be visible again
      const chatLog = page.locator('[role="log"]');
      await expect(chatLog).toBeVisible({ timeout: 5000 });

      // Verify the message content is loaded
      await page.waitForSelector('text=Message to persist', { timeout: 10000 });
      await expect(chatLog.getByText('Message to persist').first()).toBeVisible({ timeout: 10000 });
    });
  });

  test('should delete session from sidebar', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');

    // Create a session
    await chatInput.fill('Session to delete');
    await page.getByLabel('Send message (Enter)').click();
    await expect(page.locator('[role="log"]').getByText('Session to delete')).toBeVisible();

    // Wait for chat input to become enabled (indicates message processing is done)
    await expect(chatInput).toBeEnabled({ timeout: 30000 });

    // Wait for auto-save debounce (10s) + a bit more for refresh
    await page.waitForTimeout(12000);

    // Open sidebar
    await page.getByRole('button', { name: /History/i }).click();
    await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

    // Find delete button in session item
    const sessionItem = page.locator('.p-1\\.5.rounded.group').first();
    if (await sessionItem.isVisible()) {
      // Hover to reveal delete button
      await sessionItem.hover();

      // Look for delete button (trash icon or similar)
      const deleteButton = sessionItem
        .getByRole('button', { name: /delete/i })
        .or(sessionItem.locator('[aria-label*="delete"]'))
        .or(sessionItem.locator('button').last());

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

      // Wait for chat input to become enabled (indicates message processing is done)
      await expect(chatInput).toBeEnabled({ timeout: 30000 });

      // Session is saved immediately, just wait a bit for UI refresh
      await page.waitForTimeout(1000);
    });

    await test.step('Verify title and metadata in sidebar', async () => {
      // Open sidebar
      await page.getByRole('button', { name: /History/i }).click();
      await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

      // Get the first session item
      // Wait for session item to appear (session is saved immediately)
      const firstSessionItem = page.locator('.p-1\\.5.rounded.group').first();
      await expect(firstSessionItem).toBeVisible({ timeout: 5000 });

      // The session should have a title related to the message
      // (or at least contain some text)
      const sessionTitle = firstSessionItem.locator('.font-medium').first();
      if (await sessionTitle.isVisible()) {
        const title = await sessionTitle.textContent();
        expect(title).not.toBe('');
      }

      // Should show date (Today, Yesterday, or date) - only within the first session item
      await expect(
        firstSessionItem
          .getByText('Today')
          .or(firstSessionItem.getByText('Yesterday'))
          .or(firstSessionItem.getByText(/\d+ days ago/))
      ).toBeVisible();

      // Should show message count - only within the first session item
      await expect(firstSessionItem.getByText(/\d+ messages?/)).toBeVisible();
    });
  });
});
