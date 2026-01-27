import { test, expect } from './fixtures';
import { ROUTES } from '../src/constants';

test.describe('App Health Check', () => {
  test('should load the plugin without errors', async ({ page, gotoPage }) => {
    // Navigate to the plugin
    await gotoPage(`/${ROUTES.Home}`);

    // Wait for page to load
    await page.waitForTimeout(3000);

    // Check if chat input is visible (basic check that the app loaded)
    const chatInput = page.getByLabel('Chat input');
    const isChatInputVisible = await chatInput.isVisible().catch(() => false);
    console.log('Chat input visible:', isChatInputVisible);

    // Check what's actually on the page
    const pageTitle = await page.title();
    console.log('Page title:', pageTitle);

    // Check for welcome heading
    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    const isWelcomeVisible = await welcomeHeading.isVisible().catch(() => false);
    console.log('Welcome heading visible:', isWelcomeVisible);

    // Check for any error messages
    const errorBoundary = page.getByText(/error|failed|something went wrong/i);
    const hasError = await errorBoundary.isVisible().catch(() => false);
    console.log('Has error:', hasError);

    // Take a screenshot
    await page.screenshot({ path: 'test-results/app-health.png', fullPage: true });

    // Log all localStorage keys
    const storageKeys = await page.evaluate(() => {
      return Object.keys(localStorage);
    });
    console.log('LocalStorage keys:', storageKeys);

    // Log the page content snippet
    const bodyText = await page.locator('body').textContent();
    console.log('Page content (first 500 chars):', bodyText?.substring(0, 500));
  });
});
