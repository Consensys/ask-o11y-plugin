import { test, expect, clearPersistedSession } from './fixtures';
import { ROUTES } from '../src/constants';

test.describe('navigating app', () => {
  test('home page should render successfully', async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);

    // Clear any persisted session to ensure welcome message is visible
    await clearPersistedSession(page);

    // The page should render the welcome message
    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();

    // Check for conversation starters
    await expect(page.getByText('Show me a graph of CPU usage')).toBeVisible();
  });

  test('all suggestion buttons should be visible', async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);

    // Clear any persisted session to ensure welcome message is visible
    await clearPersistedSession(page);

    // Wait for page to load
    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();

    // Verify all 4 suggestion buttons are visible
    await expect(page.getByText('Show me a graph of CPU usage')).toBeVisible();
    await expect(page.getByText('Graph memory by pod')).toBeVisible();
    await expect(page.getByText('Monitor user activity')).toBeVisible();
    await expect(page.getByText('Build a dashboard')).toBeVisible();

    // Also verify the quick start label is visible
    await expect(page.getByText('Quick start suggestions')).toBeVisible();
  });

  test('clicking a suggestion should populate the chat input', async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);

    // Clear any persisted session to ensure welcome message is visible
    await clearPersistedSession(page);

    // Wait for page to load
    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();

    // Find the chat input by its aria-label
    const chatInput = page.getByLabel('Chat input');

    // Verify the input is initially empty
    await expect(chatInput).toHaveValue('');

    // Click the "Show me a graph of CPU usage" suggestion button
    await page.getByText('Show me a graph of CPU usage').click();

    // Verify the chat input is now populated with the suggestion message
    await expect(chatInput).toHaveValue('Show me a graph of CPU usage over time');
  });

  test('submitting a message should display it in chat history', async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);

    // Clear any persisted session to ensure welcome message is visible
    await clearPersistedSession(page);

    // Wait for page to load
    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();

    // Find the chat input
    const chatInput = page.getByLabel('Chat input');

    // Type a test message
    const testMessage = 'Hello, this is a test message';
    await chatInput.fill(testMessage);

    // Verify the input has the message
    await expect(chatInput).toHaveValue(testMessage);

    // Find and click the send button
    const sendButton = page.getByLabel('Send message (Enter)');
    await sendButton.click();

    // After sending, the welcome message should disappear and our message should appear
    // The user message should be visible in the chat history
    await expect(page.getByText(testMessage)).toBeVisible();

    // The welcome message should no longer be visible (replaced by chat history)
    await expect(welcomeHeading).not.toBeVisible();
  });
});
