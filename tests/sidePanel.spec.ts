import { test, expect, clearPersistedSession } from './fixtures';
import { ROUTES } from '../src/constants';

/**
 * E2E tests for the Right Side Panel feature
 *
 * The side panel displays Grafana dashboards and explore views in an iframe
 * when the assistant includes dashboard/explore links in responses.
 *
 * Note: Most side panel functionality is covered by comprehensive component tests
 * in src/components/Chat/components/SidePanel/__tests__/SidePanel.test.tsx.
 * These E2E tests cover basic integration scenarios only.
 */
test.describe('Side Panel', () => {
  test.beforeEach(async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);
    await clearPersistedSession(page);

    // Wait for welcome screen
    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();
  });

  test('should not show panel when no dashboard links are present', async ({ page }) => {
    await test.step('Send message without dashboard reference', async () => {
      const chatInput = page.getByLabel('Chat input');

      await chatInput.fill('What is observability?');
      await page.getByLabel('Send message (Enter)').click();

      // Wait for assistant response
      const assistantMessage = page.locator('[aria-label="Assistant message"]').first();
      await expect(assistantMessage).toBeVisible({ timeout: 30000 });
    });

    await test.step('Verify panel does not open', async () => {
      const sidePanel = page.locator('[role="complementary"][aria-label="Grafana page preview"]');

      // Wait a bit to ensure it doesn't appear
      await page.waitForTimeout(1000);
      await expect(sidePanel).not.toBeVisible();
    });
  });
});
