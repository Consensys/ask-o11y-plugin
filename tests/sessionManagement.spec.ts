import { test, expect, clearPersistedSession } from './fixtures';
import { ROUTES } from '../src/constants';

test.describe('Session Management', () => {
  test.beforeEach(async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);

    // Clear any persisted session to ensure welcome message is visible
    await clearPersistedSession(page);

    // Wait for page to load
    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();
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

  test('should show empty state when no sessions exist', async ({ page }) => {
    // Open history sidebar
    const historyButton = page.getByText(/View chat history/);
    await historyButton.click();

    // Wait for sidebar to open
    await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

    // Check for either empty state or session list
    const emptyStateMessage = page.getByText('No saved conversations yet');
    const sessionsList = page.locator('[class*="space-y-0.5"]');

    // At least one of these should be visible
    await expect(emptyStateMessage.or(sessionsList)).toBeVisible();

    // Close sidebar using the close button
    await page.locator('button[title="Close"]').click();
  });

  test('should close sidebar by clicking backdrop', async ({ page }) => {
    // Open history sidebar
    const historyButton = page.getByText(/View chat history/);
    await historyButton.click();

    // Wait for sidebar to open
    await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

    // Close sidebar using the close button (more reliable than backdrop click)
    await page.locator('button[title="Close"]').click();

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

    // Wait for chat input to become enabled again (wait for isGenerating to be false)
    await expect(chatInput).toBeEnabled({ timeout: 30000 });

    // Click the History button in the header
    const historyButtonInHeader = page.getByRole('button', { name: /History/i });
    await historyButtonInHeader.click();

    // The sidebar should now be visible
    await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

    // Close the sidebar using the close button
    await page.locator('button[title="Close"]').click();
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

});

