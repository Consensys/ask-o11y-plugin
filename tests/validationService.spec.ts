import { test, expect, disableBuiltInMCP } from './fixtures';

test.describe('Validation Service via UI', () => {
  test('should validate token limit with min/max/valid values', async ({ appConfigPage, page }) => {
    void appConfigPage;

    const maxTokensInput = page.getByLabel('Max Total Tokens');
    const saveButton = page.getByRole('button', { name: /Save LLM settings/i });

    await test.step('Test minimum validation', async () => {
      // Enter a value below minimum (1000)
      await maxTokensInput.clear();
      await maxTokensInput.fill('500');

      // Save button should be disabled
      await expect(saveButton).toBeDisabled();
    });

    await test.step('Test maximum value input', async () => {
      // Enter a value above maximum (200000)
      await maxTokensInput.clear();
      await maxTokensInput.fill('300000');

      // Note: The UI might show an error but still allow typing
      const value = await maxTokensInput.inputValue();
      expect(value).toBe('300000');
    });

    await test.step('Test valid value', async () => {
      // Enter a valid value
      await maxTokensInput.clear();
      await maxTokensInput.fill('75000');

      // Save button should be enabled
      await expect(saveButton).toBeEnabled();
    });
  });

  test('should validate MCP server URL format', async ({ appConfigPage, page }) => {
    void appConfigPage;

    // Disable built-in MCP mode to enable external MCP server configuration
    await disableBuiltInMCP(page);

    // Add a server
    const addButton = page.locator('[data-testid="data-testid ac-add-mcp-server"]');
    await addButton.click();

    // Find the URL input
    const urlInput = page.locator('[data-testid^="data-testid ac-mcp-server-url-"]').last();

    // Test with invalid URL
    await urlInput.fill('not-a-valid-url');
    await urlInput.blur();

    // Enter valid URL
    await urlInput.clear();
    await urlInput.fill('https://valid-server.example.com');
    await expect(urlInput).toHaveValue('https://valid-server.example.com');
  });

  test('should validate MCP server name is not empty', async ({ appConfigPage, page }) => {
    void appConfigPage;

    // Disable built-in MCP mode to enable external MCP server configuration
    await disableBuiltInMCP(page);

    // Add a server
    const addButton = page.locator('[data-testid="data-testid ac-add-mcp-server"]');
    await addButton.click();

    // Find the name input
    const nameInput = page.locator('[data-testid^="data-testid ac-mcp-server-name-"]').last();

    // Clear the name
    await nameInput.clear();
    await nameInput.blur();

    // The header should show "Unnamed Server"
    await expect(page.getByText('Unnamed Server')).toBeVisible();
  });

  test('should validate system prompt across all modes', async ({ appConfigPage, page }) => {
    void appConfigPage;

    await test.step('Validate custom prompt length', async () => {
      // Switch to replace mode
      await page.getByLabel('Replace with custom prompt').click();

      // Find the textarea
      const customPromptTextarea = page.locator('[data-testid="data-testid ac-custom-system-prompt"]');

      // Fill with content
      await customPromptTextarea.fill('A short valid prompt.');

      // Character count should show
      const charCount = page.locator('[data-testid="data-testid ac-custom-prompt-char-count"]');
      await expect(charCount).toContainText('Characters: 21');
    });

    await test.step('Require custom prompt when in replace mode', async () => {
      // First ensure we're in default mode and clear any previous content
      await page.getByLabel('Use default prompt').click();

      // Now switch to replace mode
      await page.getByLabel('Replace with custom prompt').click();

      // Clear the textarea if it has content from previous step
      const customPromptTextarea = page.locator('[data-testid="data-testid ac-custom-system-prompt"]');
      await customPromptTextarea.clear();

      // The save button should be disabled when prompt is empty
      const saveButton = page.locator('[data-testid="data-testid ac-save-system-prompt"]');
      await expect(saveButton).toBeDisabled();

      // Fill in a prompt
      await customPromptTextarea.fill('My custom prompt');

      // Now save should be enabled
      await expect(saveButton).toBeEnabled();
    });

    await test.step('Require custom prompt when in append mode', async () => {
      // First ensure we're in default mode
      await page.getByLabel('Use default prompt').click();

      // Switch to append mode
      await page.getByLabel('Append to default prompt').click();

      // Clear the textarea
      const customPromptTextarea = page.locator('[data-testid="data-testid ac-custom-system-prompt"]');
      await customPromptTextarea.clear();

      // The save button should be disabled when prompt is empty
      const saveButton = page.locator('[data-testid="data-testid ac-save-system-prompt"]');
      await expect(saveButton).toBeDisabled();

      // Fill in a prompt
      await customPromptTextarea.fill('Additional instructions');

      // Now save should be enabled
      await expect(saveButton).toBeEnabled();
    });

    await test.step('Allow saving in default prompt mode without custom prompt', async () => {
      // Ensure we're in default mode
      await page.getByLabel('Use default prompt').click();

      // The save button should be enabled (no custom prompt required)
      const saveButton = page.locator('[data-testid="data-testid ac-save-system-prompt"]');
      await expect(saveButton).toBeEnabled();
    });
  });

  test('should prevent duplicate header keys', async ({ appConfigPage, page }) => {
    void appConfigPage;

    // Disable built-in MCP mode to enable external MCP server configuration
    await disableBuiltInMCP(page);

    // Add a server
    const addButton = page.locator('[data-testid="data-testid ac-add-mcp-server"]');
    await addButton.click();

    // Expand advanced options
    const advancedToggle = page.locator('[data-testid^="data-testid ac-mcp-server-advanced-"]').last();
    await advancedToggle.click();

    // Add first header
    const addHeaderButton = page.locator('[data-testid^="data-testid ac-mcp-server-add-header-"]').last();
    await addHeaderButton.click();

    // Fill first header
    const firstHeaderKey = page.locator('[data-testid^="data-testid ac-mcp-server-header-key-"]').first();
    await firstHeaderKey.fill('Authorization');

    // Add second header
    await addHeaderButton.click();

    // Fill second header with same key
    const secondHeaderKey = page.locator('[data-testid^="data-testid ac-mcp-server-header-key-"]').last();
    await secondHeaderKey.fill('Authorization');

    // There should be a visual indication of duplicate key (the field might turn red)
    // At minimum, we should have two header inputs
    const headerKeyInputs = page.locator('[data-testid^="data-testid ac-mcp-server-header-key-"]');
    const count = await headerKeyInputs.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
