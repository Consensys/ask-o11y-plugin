import { test, expect, clearPersistedSession, deleteAllPersistedSessions } from './fixtures';
import { ROUTES } from '../src/constants';

test.describe('Session Management', () => {
  test.beforeEach(async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);
    await clearPersistedSession(page);

    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();
  });

  test('should open and close history sidebar', async ({ page }) => {
    const historyButton = page.getByText(/View chat history/);
    await historyButton.click();

    await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();
    await expect(page.getByText('+ New Chat')).toBeVisible();

    await page.locator('button[title="Close"]').click();
    await expect(page.getByRole('heading', { name: 'Chat History' })).not.toBeVisible();
  });

  test('should create a new chat session from sidebar', async ({ page }) => {
    const historyButton = page.getByText(/View chat history/);
    await historyButton.click();
    await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

    await page.getByText('+ New Chat').click();

    // Sidebar closes after creating session
    await expect(page.getByRole('heading', { name: 'Chat History' })).not.toBeVisible({ timeout: 5000 });

    // Welcome screen visible
    await expect(page.getByRole('heading', { name: 'Ask O11y Assistant' })).toBeVisible();
  });

  test('should show empty state or sessions list', async ({ page }) => {
    const historyButton = page.getByText(/View chat history/);
    await historyButton.click();
    await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

    const emptyState = page.getByText('No saved conversations yet');
    const sessionsList = page.locator('[class*="space-y-0.5"]');
    await expect(emptyState.or(sessionsList)).toBeVisible();

    await page.locator('button[title="Close"]').click();
  });

  test('should show header controls and open sidebar after sending message', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');
    await chatInput.fill('list your datasources');
    await page.getByLabel('Send message (Enter)').click();

    // Wait for user message in chat log
    await expect(page.locator('[aria-label="User message"]').first()).toBeVisible({ timeout: 30000 });

    // Header buttons visible
    await expect(page.getByRole('button', { name: /History/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /New Chat/i })).toBeVisible();

    // Wait for assistant response to complete
    await expect(page.locator('[aria-label="Assistant message"]').first()).toBeVisible({ timeout: 60000 });
    await expect(page.getByRole('button', { name: 'Stop generating' })).toBeHidden({ timeout: 60000 });

    // Open sidebar from header
    await page.getByRole('button', { name: /History/i }).click();
    await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();
    await page.locator('button[title="Close"]').click();
  });

  test('should clear chat using header button', async ({ page }) => {
    test.setTimeout(90000);
    const chatInput = page.getByLabel('Chat input');
    await chatInput.fill('list your datasources');
    await page.getByLabel('Send message (Enter)').click();

    // Wait for user message in chat log
    await expect(page.locator('[aria-label="User message"]').first()).toBeVisible({ timeout: 30000 });

    // Wait for assistant response to complete
    await expect(page.locator('[aria-label="Assistant message"]').first()).toBeVisible({ timeout: 60000 });
    await expect(page.getByRole('button', { name: 'Stop generating' })).toBeHidden({ timeout: 60000 });

    await page.getByRole('button', { name: /New Chat/i }).click();
    await page.getByRole('button', { name: 'Yes' }).click();

    await expect(page.getByRole('heading', { name: 'Ask O11y Assistant' })).toBeVisible();
  });

  test('should display session info with date and message count', async ({ page }) => {
    await deleteAllPersistedSessions(page);

    // Create a session
    const chatInput = page.getByLabel('Chat input');
    await chatInput.fill('list your datasources');
    await page.getByLabel('Send message (Enter)').click();

    // Wait for user message in chat log
    await expect(page.locator('[aria-label="User message"]').first()).toBeVisible({ timeout: 30000 });

    // Wait for assistant response to complete
    await expect(page.locator('[aria-label="Assistant message"]').first()).toBeVisible({ timeout: 60000 });
    await expect(page.getByRole('button', { name: 'Stop generating' })).toBeHidden({ timeout: 60000 });

    // Open sidebar
    await page.getByRole('button', { name: /History/i }).click();
    await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

    // Session item with date and message count
    const firstSessionItem = page.locator('.p-1\\.5.rounded.group').first();
    await expect(firstSessionItem).toBeVisible({ timeout: 15000 });

    await expect(
      firstSessionItem.getByText('Today').or(firstSessionItem.getByText('Yesterday')).or(firstSessionItem.getByText(/\d+ days ago/))
    ).toBeVisible();

    await expect(firstSessionItem.getByText(/\d+ messages/)).toBeVisible();

    await page.locator('button[title="Close"]').click();
  });
});
