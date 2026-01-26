import { test, expect, clearPersistedSession } from './fixtures';
import { ROUTES } from '../src/constants';

test.describe('app loading behavior', () => {
  test('app loads successfully and transitions from loading to ready state', async ({ gotoPage, page }) => {
    // Navigate to the home page
    await gotoPage(`/${ROUTES.Home}`);

    // Clear any persisted session to ensure welcome message is visible
    await clearPersistedSession(page);

    // Verify the app has loaded successfully (welcome heading is visible)
    // This implicitly tests that the loading state completed successfully
    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();

    // Verify the loader is no longer visible (loading complete)
    const appLoader = page.getByTestId('app-loader');
    await expect(appLoader).not.toBeVisible();

    // Verify the chat input is ready for interaction
    const chatInput = page.getByLabel('Chat input');
    await expect(chatInput).toBeVisible();
    await expect(chatInput).toBeEnabled();
  });
});
