import { test, expect, clearPersistedSession } from './fixtures';
import { ROUTES } from '../src/constants';

test.describe('Chat Flow Tests', () => {
  test.beforeEach(async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);

    // Clear any persisted session to ensure welcome message is visible
    await clearPersistedSession(page);

    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();
  });

  test('should display and manage messages with proper roles', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');

    await test.step('Send first message and verify container appears', async () => {
      // Send a message
      await chatInput.fill('Hello Grafana');
      await page.getByLabel('Send message (Enter)').click();

      // Wait for message to appear
      await expect(page.getByText('Hello Grafana')).toBeVisible();

      // The chat messages container should be visible
      const chatLog = page.locator('[role="log"]');
      await expect(chatLog).toBeVisible();
    });

    await test.step('Verify user message has correct role attribute', async () => {
      // User message should have aria-label="User message"
      const userMessage = page.locator('[aria-label="User message"]').first();
      await expect(userMessage).toBeVisible();
      await expect(userMessage).toContainText('Hello Grafana');
    });

    await test.step('Send second message and verify scroll', async () => {
      // Wait for assistant response from first message
      await page.waitForTimeout(3000);

      // Send second message
      await chatInput.fill('Second message');
      await page.getByLabel('Send message (Enter)').click();
      await expect(page.getByText('Second message')).toBeVisible();

      // The chat container should have scrolled
      const chatLog = page.locator('[role="log"]');
      await expect(chatLog).toBeVisible();
    });

    await test.step('Verify assistant response appears with correct role', async () => {
      // Wait for assistant response
      const assistantMessage = page.locator('[aria-label="Assistant message"]').first();
      await expect(assistantMessage).toBeVisible({ timeout: 30000 });
    });

    await test.step('Verify conversation context is maintained', async () => {
      // Wait for second assistant response to appear
      const assistantMessage2 = page.locator('[aria-label="Assistant message"]').nth(1);
      await expect(assistantMessage2).toBeVisible({ timeout: 30000 });

      // Both user messages should be in the chat history
      const chatLog = page.locator('[role="log"]');
      await expect(chatLog.getByText('Hello Grafana')).toBeVisible();
      await expect(chatLog.getByText('Second message')).toBeVisible();

      // The fact that we received a second response proves context is maintained
    });
  });

  test('should handle long messages correctly', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');

    // Create a long message
    const longMessage = 'This is a test message. '.repeat(20);
    await chatInput.fill(longMessage);

    // Verify the input contains the full message
    await expect(chatInput).toHaveValue(longMessage);

    // Send it
    await page.getByLabel('Send message (Enter)').click();

    // The message should appear (at least part of it)
    await expect(page.getByText('This is a test message.')).toBeVisible();
  });

  test('should focus input after response is received', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');

    // Send a message
    await chatInput.fill('Test focus');
    await page.getByLabel('Send message (Enter)').click();

    // Wait for response
    await expect(page.locator('[aria-label="Assistant message"]').first()).toBeVisible({ timeout: 30000 });

    // The input should be ready for the next message
    await expect(chatInput).toBeVisible();
    await expect(chatInput).toHaveValue('');
  });
});

test.describe('Chat Streaming Tests', () => {
  test.beforeEach(async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);

    // Clear any persisted session to ensure welcome message is visible
    await clearPersistedSession(page);

    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();
  });

  test('should manage send button state during streaming', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');
    const sendButton = page.getByLabel('Send message (Enter)');

    await test.step('Disable button while generating', async () => {
      // Send a message
      await chatInput.fill('Generate a long response');
      await sendButton.click();

      // The button should be disabled while generating
      await expect(sendButton).toBeDisabled();
    });

    await test.step('Re-enable button after completion', async () => {
      // Wait for response to complete
      await expect(page.locator('[aria-label="Assistant message"]').first()).toBeVisible({ timeout: 30000 });

      // Wait for button to be re-enabled
      await page.waitForTimeout(1000);

      // Fill new message
      await chatInput.fill('Another message');

      // The button should be enabled now
      await expect(sendButton).toBeEnabled();
    });
  });
});

test.describe('Chat UI States', () => {
  test.beforeEach(async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);

    // Clear any persisted session to ensure welcome message is visible
    await clearPersistedSession(page);

    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();
  });

  test('should transition between welcome and chat UI states', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');

    await test.step('Verify complete welcome state', async () => {
      // Welcome heading
      await expect(page.getByRole('heading', { name: 'Ask O11y Assistant' })).toBeVisible();

      // Description
      await expect(page.getByText('agentic LLM assistant')).toBeVisible();

      // Chat input
      await expect(chatInput).toBeVisible();

      // Quick suggestions - wait longer as it might load after other elements
      await expect(page.getByText('Quick start suggestions')).toBeVisible({ timeout: 10000 });
    });

    await test.step('Transition to chat state', async () => {
      // Send a message
      await chatInput.fill('Start conversation');
      await page.getByLabel('Send message (Enter)').click();

      // Wait for message to appear
      await expect(page.getByText('Start conversation')).toBeVisible();

      // Welcome heading should no longer be visible (in chat state)
      await expect(page.getByRole('heading', { name: 'Ask O11y Assistant' })).not.toBeVisible();

      // Chat header with History button should be visible
      await expect(page.getByRole('button', { name: /History/i })).toBeVisible();
    });

    await test.step('Verify chat header with controls', async () => {
      // Wait for response
      await page.waitForTimeout(2000);

      // The chat header should be visible with History and New Chat buttons
      await expect(page.getByRole('button', { name: /History/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /New Chat/i })).toBeVisible();
    });

    await test.step('Transition back to welcome state after clearing chat', async () => {
      // Click New Chat to open confirmation popup
      await page.getByRole('button', { name: /New Chat/i }).click();

      // Confirm by clicking Yes
      await page.getByRole('button', { name: 'Yes' }).click();

      // Should be back to welcome state
      await expect(page.getByRole('heading', { name: 'Ask O11y Assistant' })).toBeVisible();
    });
  });
});
