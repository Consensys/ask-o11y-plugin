import { test, expect, clearPersistedSession } from './fixtures';
import { ROUTES } from '../src/constants';

test.describe('Simple Chat Test', () => {
  test.beforeEach(async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);
    await clearPersistedSession(page);
    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();
  });

  test('should send a message and receive a response', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');
    const sendButton = page.getByLabel('Send message (Enter)');

    // User enters message
    await chatInput.fill('tell me what you can do');
    await sendButton.click();

    // Verify user message appears
    await expect(page.getByText('tell me what you can do')).toBeVisible();

    // Wait for assistant response
    await expect(sendButton).toBeEnabled({ timeout: 60000 });
    const assistantMessage = page.locator('[aria-label="Assistant message"]').first();
    await expect(assistantMessage).toBeVisible({ timeout: 5000 });

    // Verify assistant has responded (message should contain some text)
    const assistantText = await assistantMessage.textContent();
    expect(assistantText).toBeTruthy();
    expect(assistantText!.length).toBeGreaterThan(0);
  });
});
