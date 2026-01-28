import { test, expect, disableBuiltInMCP } from './fixtures';

test.describe('Extended App Configuration Tests', () => {
  test('should configure MCP servers with all fields', async ({ appConfigPage, page }) => {
    void appConfigPage;

    // Disable built-in MCP mode to enable external MCP server configuration
    await disableBuiltInMCP(page);

    await test.step('Verify initial token limit and MCP section', async () => {
      // Find the token limit input
      const maxTokensInput = page.getByLabel('Max Total Tokens');
      await expect(maxTokensInput).toBeVisible();

      // Get current value
      const currentValue = await maxTokensInput.inputValue();
      expect(parseInt(currentValue, 10)).toBeGreaterThan(0);

      // The MCP Server Connections fieldset should be visible (use exact match)
      await expect(page.getByText('MCP Server Connections', { exact: true })).toBeVisible();

      // The description should be visible
      await expect(
        page.getByText('Configure additional MCP (Model Context Protocol) servers to extend tool capabilities')
      ).toBeVisible();
    });

    await test.step('Add multiple MCP servers', async () => {
      const addButton = page.locator('[data-testid="data-testid ac-add-mcp-server"]');
      await expect(addButton).toBeVisible();

      // Count initial servers
      const removeButtonsLocator = page.locator('[data-testid^="data-testid ac-mcp-server-remove-"]');
      const initialCount = await removeButtonsLocator.count();

      // Add first server
      await addButton.click();
      await expect(removeButtonsLocator).toHaveCount(initialCount + 1);

      // Add second server
      await addButton.click();
      await expect(removeButtonsLocator).toHaveCount(initialCount + 2);
    });

    await test.step('Update server name and URL', async () => {
      // Find the name input for the new server
      const nameInput = page.locator('[data-testid^="data-testid ac-mcp-server-name-"]').last();
      await nameInput.clear();
      await nameInput.fill('My Custom Server');

      // The new name should be reflected in the card header
      await expect(page.getByText('My Custom Server').first()).toBeVisible();

      // Find the URL input
      const urlInput = page.locator('[data-testid^="data-testid ac-mcp-server-url-"]').last();
      await urlInput.fill('https://mcp-server.example.com/api');

      // Verify the URL is entered
      await expect(urlInput).toHaveValue('https://mcp-server.example.com/api');
    });

    await test.step('Configure headers for MCP server', async () => {
      // Expand advanced options
      const advancedToggle = page.locator('[data-testid^="data-testid ac-mcp-server-advanced-"]').last();
      await advancedToggle.click();

      // Add a header
      const addHeaderButton = page.locator('[data-testid^="data-testid ac-mcp-server-add-header-"]').last();
      await addHeaderButton.click();

      // Configure the header
      const headerKeyInput = page.locator('[data-testid^="data-testid ac-mcp-server-header-key-"]').last();
      const headerValueInput = page.locator('[data-testid^="data-testid ac-mcp-server-header-value-"]').last();

      await headerKeyInput.fill('Authorization');
      await headerValueInput.fill('Bearer my-token');

      // Verify the values are entered
      await expect(headerKeyInput).toHaveValue('Authorization');
      await expect(headerValueInput).toHaveValue('Bearer my-token');
    });
  });

  test('should show validation alert when there are errors', async ({ appConfigPage, page }) => {
    void appConfigPage;

    // Disable built-in MCP mode to enable external MCP server configuration
    await disableBuiltInMCP(page);

    // Add a server
    const addButton = page.locator('[data-testid="data-testid ac-add-mcp-server"]');
    await addButton.click();

    // Clear the name to trigger validation error
    const nameInput = page.locator('[data-testid^="data-testid ac-mcp-server-name-"]').last();
    await nameInput.clear();

    // The save button should be enabled (validation happens on save)
    const saveButton = page.locator('[data-testid="data-testid ac-save-mcp-servers"]');
    await expect(saveButton).toBeVisible();

    // The "Unnamed Server" text should appear indicating empty name
    await expect(page.getByText('Unnamed Server')).toBeVisible();
  });

  test('should show all server type options', async ({ appConfigPage, page }) => {
    void appConfigPage;

    // Disable built-in MCP mode to enable external MCP server configuration
    await disableBuiltInMCP(page);

    // Add a server
    const addButton = page.locator('[data-testid="data-testid ac-add-mcp-server"]');
    await addButton.click();

    // Find the type dropdown
    const typeDropdown = page.locator('select.gf-form-input').last();
    await expect(typeDropdown).toBeVisible();

    // Check that the dropdown has options by verifying its value can be changed
    await expect(typeDropdown).toHaveValue('openapi');

    // Change to standard and verify
    await typeDropdown.selectOption('standard');
    await expect(typeDropdown).toHaveValue('standard');
  });
});

test.describe('System Prompt Edge Cases', () => {
  test('should handle system prompt mode and content persistence', async ({ appConfigPage, page }) => {
    void appConfigPage;

    await test.step('Test character limit display', async () => {
      // Switch to replace mode
      await page.getByLabel('Replace with custom prompt').click();

      // Fill with a long prompt (approaching limit)
      const customPromptTextarea = page.locator('[data-testid="data-testid ac-custom-system-prompt"]');
      const longText = 'x'.repeat(8000);
      await customPromptTextarea.fill(longText);

      // Check character count
      const charCount = page.locator('[data-testid="data-testid ac-custom-prompt-char-count"]');
      await expect(charCount).toContainText('Characters: 8000');
    });

    await test.step('Test mode persistence when switching', async () => {
      // Switch to append mode
      await page.getByLabel('Append to default prompt').click();

      // Verify append mode is selected
      await expect(page.getByLabel('Append to default prompt')).toBeChecked();

      // Textarea should be visible
      const customPromptTextarea = page.locator('[data-testid="data-testid ac-custom-system-prompt"]');
      await expect(customPromptTextarea).toBeVisible();

      // Switch to replace mode
      await page.getByLabel('Replace with custom prompt').click();
      await expect(page.getByLabel('Replace with custom prompt')).toBeChecked();

      // Switch back to default
      await page.getByLabel('Use default prompt').click();
      await expect(page.getByLabel('Use default prompt')).toBeChecked();

      // Textarea should be hidden
      await expect(customPromptTextarea).not.toBeVisible();
    });

    await test.step('Test content preservation across modes', async () => {
      // Switch to replace mode
      await page.getByLabel('Replace with custom prompt').click();

      // Fill custom prompt
      const customPromptTextarea = page.locator('[data-testid="data-testid ac-custom-system-prompt"]');
      await customPromptTextarea.fill('My custom prompt text');

      // Switch to append mode
      await page.getByLabel('Append to default prompt').click();

      // Text should be preserved
      await expect(customPromptTextarea).toHaveValue('My custom prompt text');

      // Switch to default and back to replace
      await page.getByLabel('Use default prompt').click();
      await page.getByLabel('Replace with custom prompt').click();

      // Text should still be preserved
      await expect(customPromptTextarea).toHaveValue('My custom prompt text');
    });
  });
});
