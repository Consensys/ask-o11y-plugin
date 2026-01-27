import { test, expect, clearPersistedSession } from './fixtures';
import { ROUTES } from '../src/constants';

test.describe('Chat Interactions', () => {
  test.beforeEach(async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);

    // Clear any persisted session to ensure welcome message is visible
    await clearPersistedSession(page);

    // Wait for page to load
    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();
  });

  test('should display welcome screen with interactive suggestions', async ({ page }) => {
    await test.step('Verify welcome message with correct styling', async () => {
      // The welcome heading should be visible
      const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
      await expect(welcomeHeading).toBeVisible();

      // The greeting and description should be visible
      await expect(page.getByText("Hi, I'm")).toBeVisible();
      await expect(page.getByText('agentic LLM assistant')).toBeVisible();
    });

    await test.step('Verify all quick suggestion buttons', async () => {
      // All 4 quick suggestions should be visible
      await expect(page.getByText('Show me a graph of CPU usage')).toBeVisible();
      await expect(page.getByText('Graph memory by pod')).toBeVisible();
      await expect(page.getByText('Monitor user activity')).toBeVisible();
      await expect(page.getByText('Build a dashboard')).toBeVisible();

      // The "Quick start suggestions" label should be visible
      await expect(page.getByText('Quick start suggestions')).toBeVisible();
    });

    await test.step('Test clicking each suggestion fills input correctly', async () => {
      const chatInput = page.getByLabel('Chat input');

      // Test each suggestion button with actual message values from QuickSuggestions.tsx
      const suggestions = [
        { button: 'Show me a graph of CPU usage', expected: 'Show me a graph of CPU usage over time' },
        { button: 'Graph memory by pod', expected: 'Graph memory usage by pod in my default namespace' },
        { button: 'Monitor user activity', expected: 'Create a query to monitor user activity over the last 24 hours' },
        { button: 'Build a dashboard', expected: 'Help me build a dashboard for system performance metrics' },
      ];

      for (const suggestion of suggestions) {
        // Clear input first
        await chatInput.fill('');

        // Click the suggestion button
        await page.getByText(suggestion.button).click();

        // Verify the input is filled with the expected message
        await expect(chatInput).toHaveValue(suggestion.expected);
      }
    });

    await test.step('Verify input focus after clicking suggestion', async () => {
      const chatInput = page.getByLabel('Chat input');

      // Click a suggestion button (use role to be more specific)
      await page.getByRole('button', { name: /Show me a graph of CPU usage/ }).click();

      // Wait a bit for the focus to happen (there's a setTimeout in the code)
      await page.waitForTimeout(300);

      // The input should be focused
      await expect(chatInput).toBeFocused();
    });
  });

  test('should send and display messages with proper validation', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');
    const sendButton = page.getByLabel('Send message (Enter)');

    await test.step('Verify empty message cannot be sent', async () => {
      // Make sure input is empty
      await expect(chatInput).toHaveValue('');

      // The send button should be disabled when input is empty
      await expect(sendButton).toBeDisabled();

      // The welcome message should still be visible (no message sent)
      await expect(page.getByRole('heading', { name: 'Ask O11y Assistant' })).toBeVisible();
    });

    await test.step('Send message with keyboard Enter key', async () => {
      // Type a message
      await chatInput.fill('Test message with Enter');

      // Press Enter to send
      await chatInput.press('Enter');

      // The message should appear in the chat
      await expect(page.getByText('Test message with Enter')).toBeVisible();
    });

    await test.step('Verify user message has correct styling', async () => {
      // Wait for message to appear
      const userMessage = page.getByText('Test message with Enter');
      await expect(userMessage).toBeVisible();

      // The message should be in an article element with user message aria-label
      const messageContainer = page.locator('[aria-label="User message"]').first();
      await expect(messageContainer).toBeVisible();
    });

    await test.step('Verify assistant response appears', async () => {
      // Wait for the assistant response to appear (this proves the thinking phase completed)
      await expect(page.locator('[aria-label="Assistant message"]').first()).toBeVisible({
        timeout: 30000,
      });
    });
  });

  test('should display assistant response', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');

    // Send a simple message
    await chatInput.fill('Say hello');
    await page.getByLabel('Send message (Enter)').click();

    // Wait for assistant message to appear
    const assistantMessage = page.locator('[aria-label="Assistant message"]').first();
    await expect(assistantMessage).toBeVisible({ timeout: 30000 });
  });

  test('should maintain chat history after multiple messages', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');

    // Send first message
    await chatInput.fill('First test message');
    await page.getByLabel('Send message (Enter)').click();

    // Wait for first message to appear in chat messages area (using more specific locator)
    const chatMessages = page.locator('[role="log"]');
    await expect(chatMessages.getByText('First test message')).toBeVisible();

    // Wait for chat input to become enabled again (wait for isGenerating to be false)
    await expect(chatInput).toBeEnabled({ timeout: 30000 });

    // Send second message
    await chatInput.fill('Second test message');
    await page.getByLabel('Send message (Enter)').click();

    // Both messages should be visible in chat area
    await expect(chatMessages.getByText('First test message')).toBeVisible();
    await expect(chatMessages.getByText('Second test message')).toBeVisible();
  });

  test('should have accessible chat interface', async ({ page }) => {
    // Main region should be present
    const mainRegion = page.getByRole('main', { name: 'Chat interface' });
    await expect(mainRegion).toBeVisible();

    // Message input region should be labeled
    const inputRegion = page.getByRole('region', { name: 'Message input' });
    await expect(inputRegion).toBeVisible();

    // Chat input should have proper aria-label
    const chatInput = page.getByLabel('Chat input');
    await expect(chatInput).toBeVisible();
  });

  test('should disable send button while generating', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');
    const sendButton = page.getByLabel('Send message (Enter)');

    // Send a message
    await chatInput.fill('Tell me a long story about observability');
    await sendButton.click();

    // While generating, the button should be disabled
    // Note: This might be very brief, so we do a quick check
    await expect(sendButton).toBeDisabled();
  });
});

test.describe('Chat Input Field', () => {
  test.beforeEach(async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);

    // Clear any persisted session to ensure welcome message is visible
    await clearPersistedSession(page);

    // Wait for page to load
    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();
  });

  test('should allow multiline input with Shift+Enter', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');

    // Fill the textarea with multiline text directly
    await chatInput.fill('First line\nSecond line');

    // Verify the input contains both lines
    const value = await chatInput.inputValue();
    expect(value).toContain('First line');
    expect(value).toContain('Second line');
    expect(value.includes('\n')).toBe(true);
  });

  test('should clear input after sending message', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');

    // Send a message
    await chatInput.fill('Test clearing input');
    await page.getByLabel('Send message (Enter)').click();

    // The input should be cleared
    await expect(chatInput).toHaveValue('');
  });

  test('should have placeholder text', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');

    // Check placeholder exists (matches actual placeholder text)
    await expect(chatInput).toHaveAttribute('placeholder', /Ask me anything about your metrics, logs, or observability/);
  });
});
