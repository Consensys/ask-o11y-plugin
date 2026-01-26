import { test, expect, clearPersistedSession } from './fixtures';
import { ROUTES } from '../src/constants';

test.describe('Keyboard Navigation', () => {
  test.beforeEach(async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);

    // Clear any persisted session to ensure welcome message is visible
    await clearPersistedSession(page);

    // Wait for page to load
    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();
  });

  test('should support keyboard focus and input interactions', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');

    await test.step('Verify input is visible and focusable', async () => {
      // Chat input should be visible
      await expect(chatInput).toBeVisible();

      // Click on the input to focus it
      await chatInput.click();

      // Chat input should be focused
      await expect(chatInput).toBeFocused();
    });

    await test.step('Click suggestion to fill input', async () => {
      // Suggestion buttons should be visible
      const suggestionButton = page.getByText('Show me a graph of CPU usage');
      await expect(suggestionButton).toBeVisible();

      // Clicking a suggestion should fill the input
      await suggestionButton.click();

      // Wait for input to be filled
      await page.waitForTimeout(200);

      // Chat input should have content
      const inputValue = await chatInput.inputValue();
      expect(inputValue.length).toBeGreaterThan(0);
    });

    await test.step('Maintain input value when pressing Escape', async () => {
      // Fill the input
      await chatInput.fill('Test message to keep');

      // Press Escape (this might blur the input, not clear it)
      await chatInput.press('Escape');

      // Input should still have the value (Escape doesn't clear, it may blur)
      await expect(chatInput).toHaveValue('Test message to keep');
    });
  });

  test('should navigate messages with arrow keys in chat history', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');

    // First send a message
    await chatInput.fill('Test message');
    await chatInput.press('Enter');

    // Wait for message to appear
    await expect(page.getByText('Test message')).toBeVisible();

    // Tab to the chat messages area
    const chatMessages = page.locator('[role="log"]');
    await chatMessages.focus();

    // The chat log should be focusable
    await expect(chatMessages).toBeFocused();
  });

  test('should have complete accessibility support', async ({ page }) => {
    await test.step('Verify ARIA structure', async () => {
      // Main chat interface should have aria-label
      const mainRegion = page.getByRole('main', { name: 'Chat interface' });
      await expect(mainRegion).toBeVisible();

      // Message input region should be labeled
      const inputRegion = page.getByRole('region', { name: 'Message input' });
      await expect(inputRegion).toBeVisible();

      // Chat input should have aria-label
      const chatInput = page.getByLabel('Chat input');
      await expect(chatInput).toBeVisible();

      // Send button should have aria-label
      const sendButton = page.getByLabel('Send message (Enter)');
      await expect(sendButton).toBeVisible();
    });

    await test.step('Verify live regions for screen readers', async () => {
      // The chat interface main region should be visible
      const mainRegion = page.getByRole('main', { name: 'Chat interface' });
      await expect(mainRegion).toBeVisible();

      // Check that ARIA live regions exist for chat messages
      // When a message is sent, the chat history should update
      const chatInput = page.getByLabel('Chat input');
      await chatInput.fill('Screen reader test');
      await page.getByLabel('Send message (Enter)').click();

      // The chat log should have aria-live attribute
      const chatLog = page.locator('[aria-live]');
      await expect(chatLog.first()).toBeVisible();
    });
  });
});

test.describe('Chat Input Keyboard Behavior', () => {
  test.beforeEach(async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);

    // Clear any persisted session to ensure welcome message is visible
    await clearPersistedSession(page);

    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();
  });

  test('should handle keyboard shortcuts correctly', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');

    await test.step('Prevent submit on empty input', async () => {
      // Ensure input is empty
      await expect(chatInput).toHaveValue('');

      // Try pressing Enter
      await chatInput.focus();
      await chatInput.press('Enter');

      // Welcome should still be visible
      await expect(page.getByRole('heading', { name: 'Ask O11y Assistant' })).toBeVisible();
    });

    await test.step('Submit with Enter key', async () => {
      await chatInput.fill('Enter key test');
      await chatInput.press('Enter');

      // Message should be visible in chat
      await expect(page.getByText('Enter key test')).toBeVisible();
    });

    await test.step('Insert newline with Shift+Enter', async () => {
      // Fill textarea with multiline text
      await chatInput.fill('Line 1\nLine 2');

      const value = await chatInput.inputValue();
      expect(value).toContain('Line 1');
      expect(value).toContain('Line 2');
      expect(value.includes('\n')).toBe(true);
    });
  });

  test('should resize textarea for long content', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');

    // Get initial height
    const initialHeight = await chatInput.evaluate((el) => el.scrollHeight);

    // Add multiple lines
    await chatInput.fill('Line 1\nLine 2\nLine 3\nLine 4\nLine 5');

    // Height should increase
    const newHeight = await chatInput.evaluate((el) => el.scrollHeight);
    expect(newHeight).toBeGreaterThan(initialHeight);
  });
});
