import { test, expect, clearPersistedSession } from './fixtures';
import { ROUTES } from '../src/constants';

test.describe('Edge Cases', () => {
  test.beforeEach(async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);
    await clearPersistedSession(page);

    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();
  });

  test('should handle unicode characters in message', async ({ page }) => {
    test.setTimeout(90000);
    const chatInput = page.getByLabel('Chat input');

    await chatInput.fill('测试消息 🎉 émojis');
    await page.getByLabel('Send message (Enter)').click();

    await expect(page.locator('[aria-label="User message"]').first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('测试消息 🎉 émojis')).toBeVisible();

    // Wait for assistant response to complete before next test
    await expect(page.locator('[aria-label="Assistant message"]').first()).toBeVisible({ timeout: 60000 });
    await expect(page.getByRole('button', { name: 'Stop generating' })).toBeHidden({ timeout: 60000 });
  });

  test('should handle code blocks in message', async ({ page }) => {
    test.setTimeout(90000);
    const chatInput = page.getByLabel('Chat input');

    await chatInput.fill('```javascript\nconsole.log("test");\n```');
    await page.getByLabel('Send message (Enter)').click();

    await expect(page.locator('[aria-label="User message"]').first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('console.log')).toBeVisible();

    // Wait for assistant response to complete before next test
    await expect(page.locator('[aria-label="Assistant message"]').first()).toBeVisible({ timeout: 60000 });
    await expect(page.getByRole('button', { name: 'Stop generating' })).toBeHidden({ timeout: 60000 });
  });
});
