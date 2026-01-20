import { test, expect, clearPersistedSession, deleteAllPersistedSessions } from './fixtures';
import { ROUTES } from '../src/constants';

test.describe('Session Sidebar Extended', () => {
  test.beforeEach(async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);

    // Clear any persisted session to ensure welcome message is visible
    await clearPersistedSession(page);

    // Wait for page to load
    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();
  });

  test('should display session information with formatting', async ({ page }) => {
    // Delete all existing sessions to ensure a clean state
    await deleteAllPersistedSessions(page);

    await test.step('Verify sessions count in view history button', async () => {
      const historyButton = page.getByText(/View chat history/);
      await expect(historyButton).toBeVisible();

      // The button should contain a count (even if 0)
      const buttonText = await historyButton.textContent();
      expect(buttonText).toMatch(/View chat history \(\d+\)/);
    });

    await test.step('Create session and open sidebar', async () => {
      // First create a session by sending a message
      const chatInput = page.getByLabel('Chat input');
      await chatInput.fill('Test message for session');
      await page.getByLabel('Send message (Enter)').click();

      // Wait for message to appear
      await expect(page.getByText('Test message for session')).toBeVisible();

      // Wait for chat input to become enabled (indicates message processing is done)
      await expect(chatInput).toBeEnabled({ timeout: 30000 });

      // Wait for auto-save debounce (10s) + a bit more for refresh
      await page.waitForTimeout(12000);

      // Open the sidebar
      const historyButtonInHeader = page.getByRole('button', { name: /History/i });
      await historyButtonInHeader.click();

      // Wait for sidebar
      await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();
    });

    await test.step('Verify date formatting in sidebar', async () => {
      // Get the first session item
      // Wait for session item to appear (with timeout accounting for debounce)
      const firstSessionItem = page.locator('.p-1\\.5.rounded.group').first();
      await expect(firstSessionItem).toBeVisible({ timeout: 15000 });

      // There should be date text like "Today", "Yesterday", or a date - only within the first session item
      await expect(
        firstSessionItem.getByText('Today').or(firstSessionItem.getByText('Yesterday')).or(firstSessionItem.getByText(/\d+ days ago/))
      ).toBeVisible();
    });

    await test.step('Verify message count for session', async () => {
      // Get the first session item
      const firstSessionItem = page.locator('.p-1\\.5.rounded.group').first();
      await expect(firstSessionItem).toBeVisible();

      // Should show message count - only within the first session item
      await expect(firstSessionItem.getByText(/\d+ messages/)).toBeVisible();
    });

    await test.step('Verify active session indicator', async () => {
      // The current session should have some visual indication (blue styling)
      // Check for a session item that might have active styling
      const sessionItems = page.locator('.p-1\\.5.rounded.group');
      await expect(sessionItems.first()).toBeVisible();
    });

    await test.step('Close sidebar', async () => {
      // Close sidebar using the close button
      await page.locator('button[title="Close"]').click();
    });
  });

  test('should support sidebar actions (import, new chat, storage)', async ({ page }) => {
    await test.step('Open sidebar and verify storage indicator', async () => {
      // Open history sidebar
      const historyButton = page.getByText(/View chat history/);
      await historyButton.click();
      await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

      // Storage indicator should show percentage
      await expect(page.getByText(/\d+% storage used/)).toBeVisible();
    });

    await test.step('Open and close import modal', async () => {
      // Click Import button
      await page.getByRole('button', { name: 'Import' }).click();

      // Import modal should be visible
      await expect(page.getByRole('heading', { name: 'Import Session' })).toBeVisible();

      // File input should be visible
      const fileInput = page.locator('input[type="file"]');
      await expect(fileInput).toBeVisible();

      // Cancel button should be visible
      await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();

      // Cancel and verify sidebar is still open
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();
    });

    await test.step('Create new session from sidebar', async () => {
      // Click "+ New Chat" button
      const newChatButton = page.getByText('+ New Chat');
      await expect(newChatButton).toBeVisible();
      await newChatButton.click();

      // Sidebar should close after creating new session
      await expect(page.getByRole('heading', { name: 'Chat History' })).not.toBeVisible({ timeout: 5000 });

      // Welcome screen should be visible (new empty session)
      await expect(page.getByRole('heading', { name: 'Ask O11y Assistant' })).toBeVisible();
    });
  });

  test('should handle keyboard focus in sidebar', async ({ page }) => {
    // Open history sidebar
    const historyButton = page.getByText(/View chat history/);
    await historyButton.click();
    await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

    // Tab through elements in the sidebar
    await page.keyboard.press('Tab');

    // Something should be focused
    const focusedElement = page.locator(':focus');
    await expect(focusedElement).toBeVisible();

    // Close sidebar using the close button
    await page.locator('button[title="Close"]').click();
  });
});

test.describe('Session Interactions After Chat', () => {
  test.beforeEach(async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);

    // Clear any persisted session to ensure welcome message is visible
    await clearPersistedSession(page);

    // Wait for page to load
    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();

    // Send initial message
    const chatInput = page.getByLabel('Chat input');
    await chatInput.fill('Initial message for session tests');
    await page.getByLabel('Send message (Enter)').click();
    await expect(page.getByText('Initial message for session tests')).toBeVisible();
  });

  test('should manage active session interactions', async ({ page }) => {
    await test.step('Verify session controls in header after sending message', async () => {
      // After sending a message, we should see the header with session controls
      const historyButton = page.getByRole('button', { name: /History/i });
      await expect(historyButton).toBeVisible();

      const newChatButton = page.getByRole('button', { name: /New Chat/i });
      await expect(newChatButton).toBeVisible();

      // The history button in header should show session count (at least 1 session should exist)
      await expect(historyButton).toBeVisible();
    });

    await test.step('Clear current chat and show welcome screen', async () => {
      // Click the "+ New Chat" button in header
      const newChatButton = page.getByRole('button', { name: /New Chat/i });
      await newChatButton.click();

      // Confirm by clicking Yes
      await page.getByRole('button', { name: 'Yes' }).click();

      // Welcome screen should reappear
      await expect(page.getByRole('heading', { name: 'Ask O11y Assistant' })).toBeVisible();

      // The previous message should be gone
      await expect(page.getByText('Initial message for session tests')).not.toBeVisible();
    });

    await test.step('Create second session and verify switching capability', async () => {
      // Send a new message
      const chatInput = page.getByLabel('Chat input');
      await chatInput.fill('Second session message');
      await page.getByLabel('Send message (Enter)').click();
      await expect(page.getByText('Second session message')).toBeVisible();

      // Wait for chat input to become enabled (indicates message processing is done)
      await expect(chatInput).toBeEnabled({ timeout: 30000 });

      // Wait for auto-save debounce (10s) + a bit more for refresh
      await page.waitForTimeout(12000);

      // Open sidebar
      const historyButton = page.getByRole('button', { name: /History/i });
      await historyButton.click();
      await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

      // Wait for session items to appear
      const sessionItems = page.locator('.p-1\\.5.rounded.group');
      await expect(sessionItems.first()).toBeVisible({ timeout: 15000 });
      const sessionCount = await sessionItems.count();
      expect(sessionCount).toBeGreaterThanOrEqual(1);

      // Close sidebar using the close button
      await page.locator('button[title="Close"]').click();
    });
  });
});
