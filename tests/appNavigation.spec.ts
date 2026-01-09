import { test, expect } from './fixtures';
import { ROUTES } from '../src/constants';

test.describe('navigating app', () => {
  test('home page should render successfully', async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);

    // The page should render either the welcome message (LLM enabled) or the LLM not enabled message
    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    const llmNotEnabledMessage = page.getByText('LLM plugin not enabled');

    // Wait for either element to be visible
    await expect(welcomeHeading.or(llmNotEnabledMessage)).toBeVisible();

    // If LLM is enabled (heading visible), also check for conversation starters
    const isWelcomeVisible = await welcomeHeading.isVisible();
    if (isWelcomeVisible) {
      await expect(page.getByText('Show me a graph of CPU usage')).toBeVisible();
    }
  });

  test('should show LLM not enabled message when LLM plugin is disabled', async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);

    // Wait for page to load - check for either state
    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    const llmNotEnabledMessage = page.getByText('LLM plugin not enabled');

    // Wait for either to appear
    await expect(welcomeHeading.or(llmNotEnabledMessage)).toBeVisible();

    // Check which state we're in by checking if welcome heading is visible
    const isWelcomeVisible = await welcomeHeading.isVisible();

    if (isWelcomeVisible) {
      // IMPORTANT: Skip when LLM is enabled - this test specifically validates the disabled state
      test.skip();
      return;
    }

    // Validate the LLM not enabled state
    await expect(llmNotEnabledMessage).toBeVisible();
    await expect(page.getByText('Please enable the LLM plugin to use the chat interface')).toBeVisible();
  });

  test('all suggestion buttons should be visible', async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);

    // Wait for page to load - check for either state
    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    const llmNotEnabledMessage = page.getByText('LLM plugin not enabled');
    await expect(welcomeHeading.or(llmNotEnabledMessage)).toBeVisible();

    // Check which state we're in
    const isWelcomeVisible = await welcomeHeading.isVisible();
    if (!isWelcomeVisible) {
      // IMPORTANT: Skip when LLM plugin is not enabled - requires external LLM dependency
      test.skip();
      return;
    }

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

    // Wait for page to load - check for either state
    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    const llmNotEnabledMessage = page.getByText('LLM plugin not enabled');
    await expect(welcomeHeading.or(llmNotEnabledMessage)).toBeVisible();

    // Check which state we're in
    const isWelcomeVisible = await welcomeHeading.isVisible();
    if (!isWelcomeVisible) {
      // IMPORTANT: Skip when LLM plugin is not enabled - requires external LLM dependency
      test.skip();
      return;
    }

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

    // Wait for page to load - check for either state
    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    const llmNotEnabledMessage = page.getByText('LLM plugin not enabled');
    await expect(welcomeHeading.or(llmNotEnabledMessage)).toBeVisible();

    // Check which state we're in
    const isWelcomeVisible = await welcomeHeading.isVisible();
    if (!isWelcomeVisible) {
      // IMPORTANT: Skip when LLM plugin is not enabled - requires external LLM dependency
      test.skip();
      return;
    }

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
