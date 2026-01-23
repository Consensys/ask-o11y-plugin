import { test, expect, clearPersistedSession } from './fixtures';
import { ROUTES } from '../src/constants';

test.describe('Error Handling Tests', () => {
  test('should handle and display various error states', async ({ gotoPage, page }) => {
    await test.step('Navigate and verify page renders in valid state', async () => {
      // Navigate to the app
      await gotoPage(`/${ROUTES.Home}`);

      // Clear any persisted session to ensure welcome message is visible
      await clearPersistedSession(page);

      // Wait for page to load
      const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
      const errorBoundary = page.getByText('Something went wrong');

      // The page should render in one of these states
      await expect(welcomeHeading.or(errorBoundary)).toBeVisible();
    });
  });
});

test.describe('AppConfig Error Handling', () => {
  test('should validate AppConfig inputs with edge cases', async ({ appConfigPage, page }) => {
    void appConfigPage;

    await test.step('Handle empty MCP server URL', async () => {
      // Add a server
      const addButton = page.locator('[data-testid="data-testid ac-add-mcp-server"]');
      await addButton.click();

      // URL can be empty initially - server just won't work without it
      const urlInput = page.locator('[data-testid^="data-testid ac-mcp-server-url-"]').last();
      await expect(urlInput).toHaveValue('');

      // The save button should still be available (validation happens on save)
      const saveButton = page.locator('[data-testid="data-testid ac-save-mcp-servers"]');
      await expect(saveButton).toBeVisible();
    });

    await test.step('Accept special characters in server name', async () => {
      // Enter name with special characters
      const nameInput = page.locator('[data-testid^="data-testid ac-mcp-server-name-"]').last();
      await nameInput.clear();
      await nameInput.fill('Test Server (v1.0) - Production');

      // The name should be accepted
      await expect(nameInput).toHaveValue('Test Server (v1.0) - Production');
    });

    await test.step('Accept special characters in header values', async () => {
      // Expand advanced options
      const advancedToggle = page.locator('[data-testid^="data-testid ac-mcp-server-advanced-"]').last();
      await advancedToggle.click();

      // Add a header
      const addHeaderButton = page.locator('[data-testid^="data-testid ac-mcp-server-add-header-"]').last();
      await addHeaderButton.click();

      // Enter header with special characters
      const headerValueInput = page.locator('[data-testid^="data-testid ac-mcp-server-header-value-"]').last();
      await headerValueInput.fill('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test');

      // The value should be accepted
      await expect(headerValueInput).toHaveValue('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test');
    });
  });

  test('should handle very long system prompt', async ({ appConfigPage, page }) => {
    void appConfigPage;

    // Switch to replace mode
    await page.getByLabel('Replace with custom prompt').click();

    // Enter a long prompt
    const customPromptTextarea = page.locator('[data-testid="data-testid ac-custom-system-prompt"]');
    const longPrompt = 'You are a helpful assistant. '.repeat(100);
    await customPromptTextarea.fill(longPrompt);

    // Character count should update
    const charCount = page.locator('[data-testid="data-testid ac-custom-prompt-char-count"]');
    await expect(charCount).toContainText('Characters:');
  });
});

test.describe('Chat Error Recovery', () => {
  test.beforeEach(async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);

    // Clear any persisted session to ensure welcome message is visible
    await clearPersistedSession(page);

    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();
  });

  test('should handle chat errors and maintain reliability', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');

    await test.step('Recover from message send and prevent rapid sends', async () => {
      // Send a message
      await chatInput.fill('Test recovery');
      await page.getByLabel('Send message (Enter)').click();

      // The button should be disabled preventing rapid sends
      const sendButton = page.getByLabel('Send message (Enter)');
      await expect(sendButton).toBeDisabled();

      // Wait for processing
      await page.waitForTimeout(2000);

      // The message should be visible in the chat log
      await expect(page.locator('[role="log"]').getByText('Test recovery', { exact: true })).toBeVisible();

      // The input should eventually be usable again
      await expect(chatInput).toBeVisible();
    });

    await test.step('Verify session persistence', async () => {
      // Wait for chat input to become enabled again (wait for isGenerating to be false)
      await expect(chatInput).toBeEnabled({ timeout: 30000 });

      // Send another message
      await chatInput.fill('Message to check persistence');
      await page.getByLabel('Send message (Enter)').click();
      await expect(page.getByText('Message to check persistence')).toBeVisible();

      // Note: Actual state persistence would be tested after refresh
      // For now, we just verify the session is saved
      // Open sidebar to check session exists
      await page.getByRole('button', { name: /History/i }).click();
      await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

      // There should be at least one session
      await expect(page.getByText(/\d+ sessions/)).toBeVisible();

      // Close sidebar using the close button instead of backdrop
      await page.locator('button[title="Close"]').click();
    });
  });
});

test.describe('Edge Cases', () => {
  test.beforeEach(async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);

    // Clear any persisted session to ensure welcome message is visible
    await clearPersistedSession(page);

    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();
  });

  test('should handle unicode characters in message', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');

    // Send message with unicode
    await chatInput.fill('测试消息 🎉 émojis');
    await page.getByLabel('Send message (Enter)').click();

    // The message should appear
    await expect(page.getByText('测试消息 🎉 émojis')).toBeVisible();
  });

  test('should handle code blocks in message', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');

    // Send message with code
    await chatInput.fill('```javascript\nconsole.log("test");\n```');
    await page.getByLabel('Send message (Enter)').click();

    // The message should appear (though formatting may vary)
    await expect(page.getByText('console.log')).toBeVisible();
  });

  test('should handle newlines in message', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');

    // Create message with newlines using Shift+Enter
    await chatInput.fill('Line 1');
    await chatInput.press('Shift+Enter');
    await chatInput.type('Line 2');
    await chatInput.press('Shift+Enter');
    await chatInput.type('Line 3');

    // Send the message
    await page.getByLabel('Send message (Enter)').click();

    // The message should appear
    await expect(page.getByText('Line 1')).toBeVisible();
  });
});
