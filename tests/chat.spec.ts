import { test, expect, clearPersistedSession } from './fixtures';
import { ROUTES } from '../src/constants';

test.describe('Chat', () => {
  test.beforeEach(async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);
    await clearPersistedSession(page);

    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();
  });

  test('should display welcome screen with suggestions that populate input', async ({ page }) => {
    // Welcome elements visible
    await expect(page.getByText("Hi, I'm")).toBeVisible();
    await expect(page.getByText('Quick start suggestions')).toBeVisible();
    await expect(page.getByText('Show me a graph of CPU usage')).toBeVisible();
    await expect(page.getByText('Graph memory by pod')).toBeVisible();
    await expect(page.getByText('Monitor user activity')).toBeVisible();
    await expect(page.getByText('Build a dashboard')).toBeVisible();

    // Click suggestion populates input
    const chatInput = page.getByLabel('Chat input');
    await expect(chatInput).toHaveValue('');
    await page.getByText('Show me a graph of CPU usage').click();
    await expect(chatInput).toHaveValue('Show me a graph of CPU usage over time');
  });

  test('should send messages and transition to chat state', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');
    const sendButton = page.getByLabel('Send message (Enter)');

    // Empty input: send disabled
    await expect(sendButton).toBeDisabled();

    // Send message
    await chatInput.fill('list your datasources');
    await sendButton.click();

    // Message appears, welcome disappears
    await expect(page.getByText('list your datasources')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ask O11y Assistant' })).not.toBeVisible();

    // User message has correct role
    const userMessage = page.locator('[aria-label="User message"]').first();
    await expect(userMessage).toContainText('list your datasources');

    // Header controls appear
    await expect(page.getByRole('button', { name: /History/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /New Chat/i })).toBeVisible();

    // Wait for assistant response
    await expect(page.locator('[aria-label="Assistant message"]').first()).toBeVisible({ timeout: 60000 });
    const stopButton = page.getByRole('button', { name: 'Stop generating' });
    await expect(stopButton).toBeHidden({ timeout: 60000 });

    // Input cleared and ready
    await expect(chatInput).toHaveValue('');
  });

  test('should disable send button while generating', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');
    const sendButton = page.getByLabel('Send message (Enter)');

    await chatInput.fill('list your datasources');
    await sendButton.click();

    await expect(sendButton).toBeDisabled();

    // Stop generation to avoid leaving an active agent run for subsequent tests
    const stopButton = page.getByRole('button', { name: 'Stop generating' });
    await expect(stopButton).toBeVisible({ timeout: 10000 });
    await stopButton.click();
    await expect(stopButton).toBeHidden({ timeout: 30000 });
  });

  test('should have accessible chat interface', async ({ page }) => {
    await expect(page.getByRole('main', { name: 'Chat interface' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Message input' })).toBeVisible();
    await expect(page.getByLabel('Chat input')).toBeVisible();
  });

  test('should support multiline input and clear after send', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');

    // Multiline
    await chatInput.fill('First line\nSecond line');
    const value = await chatInput.inputValue();
    expect(value).toContain('First line');
    expect(value).toContain('Second line');

    // Send clears input
    await page.getByLabel('Send message (Enter)').click();
    await expect(chatInput).toHaveValue('');
  });

  test('should have placeholder text', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');
    await expect(chatInput).toHaveAttribute('placeholder', /Ask me anything about your metrics, logs, or observability/);
  });
});
