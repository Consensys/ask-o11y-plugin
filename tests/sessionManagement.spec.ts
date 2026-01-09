import { test, expect } from './fixtures';
import { ROUTES } from '../src/constants';

test.describe('Session Management', () => {
  test.beforeEach(async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);

    // Wait for page to load - check for either state
    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    const llmNotEnabledMessage = page.getByText('LLM plugin not enabled');
    await expect(welcomeHeading.or(llmNotEnabledMessage)).toBeVisible();

    // Skip all tests in this suite if LLM plugin is not enabled
    const isWelcomeVisible = await welcomeHeading.isVisible();
    if (!isWelcomeVisible) {
      test.skip();
    }
  });

  test('should open and close history sidebar', async ({ page }) => {
    // Find the "View chat history" button on the welcome screen
    const historyButton = page.getByText(/View chat history/);
    await expect(historyButton).toBeVisible();

    // Click to open the sidebar
    await historyButton.click();

    // The sidebar should now be visible with "Chat History" heading
    await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

    // The New Chat button should be visible
    await expect(page.getByText('+ New Chat')).toBeVisible();

    // The Import button should be visible
    await expect(page.getByRole('button', { name: 'Import' })).toBeVisible();

    // Close the sidebar using the close button (the one with ✕ in the sidebar header)
    await page.locator('.relative.w-80 button[title="Close"]').click();

    // The sidebar should be closed
    await expect(page.getByRole('heading', { name: 'Chat History' })).not.toBeVisible();
  });

  test('should create a new chat session from sidebar', async ({ page }) => {
    // Open history sidebar
    const historyButton = page.getByText(/View chat history/);
    await historyButton.click();

    // Wait for sidebar to open
    await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

    // Get initial session count from the sessions display
    const sessionCountText = page.locator('text=/\\d+ sessions/');

    // Click the "+ New Chat" button
    await page.getByText('+ New Chat').click();

    // Wait for the creating state to complete (button changes to "Creating...")
    // and then the sidebar closes automatically
    await expect(page.getByRole('heading', { name: 'Chat History' })).not.toBeVisible({ timeout: 5000 });

    // Re-open the sidebar to verify the session was created
    await page.getByText(/View chat history/).click();
    await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

    // Should now have at least one session (indicated by session list or count)
    // The sessions list should be visible with at least one session
    await expect(page.getByText('sessions')).toBeVisible();
  });

  test('should show storage indicator in sidebar', async ({ page }) => {
    // Open history sidebar
    const historyButton = page.getByText(/View chat history/);
    await historyButton.click();

    // Wait for sidebar to open
    await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

    // Storage indicator should be visible (shows "X% storage used")
    await expect(page.getByText(/storage used/)).toBeVisible();

    // Close sidebar using the backdrop
    await page.locator('.bg-black\\/50').click({ force: true });
  });

  test('should show empty state when no sessions exist', async ({ page }) => {
    // Open history sidebar
    const historyButton = page.getByText(/View chat history/);
    await historyButton.click();

    // Wait for sidebar to open
    await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

    // Check for either empty state or session list
    const emptyStateMessage = page.getByText('No saved conversations yet');
    const sessionsList = page.locator('[class*="space-y-1"]');

    // At least one of these should be visible
    await expect(emptyStateMessage.or(sessionsList)).toBeVisible();

    // Close sidebar using the backdrop
    await page.locator('.bg-black\\/50').click({ force: true });
  });

  test('should close sidebar by clicking backdrop', async ({ page }) => {
    // Open history sidebar
    const historyButton = page.getByText(/View chat history/);
    await historyButton.click();

    // Wait for sidebar to open
    await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

    // Click the backdrop (the black overlay area)
    // The backdrop is the first child div with bg-black/50 class
    const backdrop = page.locator('.bg-black\\/50');
    await backdrop.click({ force: true });

    // The sidebar should be closed
    await expect(page.getByRole('heading', { name: 'Chat History' })).not.toBeVisible();
  });

  test('should show history button with session count in header after sending message', async ({ page }) => {
    // Send a message to have a conversation
    const chatInput = page.getByLabel('Chat input');
    await chatInput.fill('Hello, test message');
    await page.getByLabel('Send message (Enter)').click();

    // Wait for the user message to appear in chat
    await expect(page.getByText('Hello, test message')).toBeVisible();

    // After sending a message, the header should be visible with the History button
    const historyButtonInHeader = page.getByRole('button', { name: /History/i });
    await expect(historyButtonInHeader).toBeVisible();

    // The "+ New Chat" button should also be visible in the header
    await expect(page.getByRole('button', { name: /New Chat/i })).toBeVisible();
  });

  test('should open sidebar from header after conversation starts', async ({ page }) => {
    // Send a message to have a conversation
    const chatInput = page.getByLabel('Chat input');
    await chatInput.fill('Hello, test for history');
    await page.getByLabel('Send message (Enter)').click();

    // Wait for the user message to appear in chat
    await expect(page.getByText('Hello, test for history')).toBeVisible();

    // Click the History button in the header
    const historyButtonInHeader = page.getByRole('button', { name: /History/i });
    await historyButtonInHeader.click();

    // The sidebar should now be visible
    await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

    // Close the sidebar using the backdrop
    await page.locator('.bg-black\\/50').click({ force: true });
    await expect(page.getByRole('heading', { name: 'Chat History' })).not.toBeVisible();
  });

  test('should clear chat using header button', async ({ page }) => {
    // Send a message to have a conversation
    const chatInput = page.getByLabel('Chat input');
    await chatInput.fill('Message to be cleared');
    await page.getByLabel('Send message (Enter)').click();

    // Wait for the user message to appear in chat
    await expect(page.getByText('Message to be cleared')).toBeVisible();

    // Click the "+ New Chat" button in the header
    // Note: This actually clears the chat (acts as clearChat in the header)
    const newChatButton = page.getByRole('button', { name: /New Chat/i });
    await newChatButton.click();

    // Confirm by clicking Yes
    await page.getByRole('button', { name: 'Yes' }).click();

    // The welcome message should reappear (chat is cleared)
    await expect(page.getByRole('heading', { name: 'Ask O11y Assistant' })).toBeVisible();

    // The message we sent should no longer be visible
    await expect(page.getByText('Message to be cleared')).not.toBeVisible();
  });

  test('should show import modal in sidebar', async ({ page }) => {
    // Open history sidebar
    const historyButton = page.getByText(/View chat history/);
    await historyButton.click();

    // Wait for sidebar to open
    await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

    // Click the Import button
    await page.getByRole('button', { name: 'Import' }).click();

    // The import modal should be visible
    await expect(page.getByRole('heading', { name: 'Import Session' })).toBeVisible();

    // The file input should be visible
    await expect(page.locator('input[type="file"]')).toBeVisible();

    // Cancel button should be visible
    const cancelButton = page.getByRole('button', { name: 'Cancel' });
    await expect(cancelButton).toBeVisible();

    // Click cancel to close the import modal
    await cancelButton.click();

    // The import modal should be closed, but sidebar should still be open
    await expect(page.getByRole('heading', { name: 'Import Session' })).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

    // Close the sidebar using the backdrop
    await page.locator('.bg-black\\/50').click({ force: true });
  });
});

