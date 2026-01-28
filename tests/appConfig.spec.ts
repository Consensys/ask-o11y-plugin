import { test, expect } from './fixtures';

test.describe('App Configuration', () => {
  test('should be possible to save app configuration', async ({ appConfigPage, page }) => {
    const saveButton = page.getByRole('button', { name: /Save LLM settings/i });

    // enter a valid token limit
    const maxTokensInput = page.getByLabel('Max Total Tokens');
    await maxTokensInput.clear();
    await maxTokensInput.fill('75000');

    // listen for the server response on the saved form
    const saveResponse = appConfigPage.waitForSettingsResponse();

    await saveButton.click();
    await expect(saveResponse).toBeOK();
  });

  test('should show validation error for invalid token limit', async ({ appConfigPage, page }) => {
    // Suppress the appConfigPage unused variable warning - we need it to navigate to the page
    void appConfigPage;

    const saveButton = page.getByRole('button', { name: /Save LLM settings/i });
    const maxTokensInput = page.getByLabel('Max Total Tokens');

    // Enter an invalid token limit (below minimum of 1000)
    await maxTokensInput.clear();
    await maxTokensInput.fill('500');

    // The save button should be disabled when validation fails
    await expect(saveButton).toBeDisabled();

    // Enter a valid value and verify button is enabled
    await maxTokensInput.clear();
    await maxTokensInput.fill('50000');
    await expect(saveButton).toBeEnabled();
  });

  test('should be able to add and configure an MCP server', async ({ appConfigPage, page }) => {
    // Suppress the appConfigPage unused variable warning
    void appConfigPage;

    // Disable built-in MCP mode to enable external MCP server configuration

    // Wait for the Add MCP Server button to be visible (page fully loaded) - using test ID
    // Note: testIds include 'data-testid ' prefix in their values
    const addButton = page.locator('[data-testid="data-testid ac-add-mcp-server"]');
    await expect(addButton).toBeVisible();

    // Count existing servers before adding - using test ID pattern
    const removeButtonsLocator = page.locator('[data-testid^="data-testid ac-mcp-server-remove-"]');
    const existingServerCount = await removeButtonsLocator.count();

    // Click the Add MCP Server button
    await addButton.click();

    // Wait for the new server card to appear with default name "New MCP Server"
    await expect(page.getByText('New MCP Server').first()).toBeVisible();

    // Verify a new server was added (one more Remove button than before)
    await expect(removeButtonsLocator).toHaveCount(existingServerCount + 1);

    // Find the last server name input using test ID pattern
    const newServerNameInput = page.locator('[data-testid^="data-testid ac-mcp-server-name-"]').last();
    await newServerNameInput.clear();
    await newServerNameInput.fill('E2E Test Server');

    // Verify the name changed in the card header (use .first() in case of duplicates from previous runs)
    await expect(page.getByText('E2E Test Server').first()).toBeVisible();

    // Fill in the server URL using test ID pattern
    const newServerUrlInput = page.locator('[data-testid^="data-testid ac-mcp-server-url-"]').last();
    await newServerUrlInput.fill('https://test-mcp.example.com');

    // Verify the Save MCP Server Connections button is enabled - using test ID
    const saveMcpButton = page.locator('[data-testid="data-testid ac-save-mcp-servers"]');
    await expect(saveMcpButton).toBeEnabled();
  });

  test('should be able to remove an MCP server', async ({ appConfigPage, page }) => {
    // Suppress the appConfigPage unused variable warning
    void appConfigPage;

    // Disable built-in MCP mode to enable external MCP server configuration

    // Wait for the Add MCP Server button to be visible (page fully loaded) - using test ID
    // Note: testIds include 'data-testid ' prefix in their values
    const addButton = page.locator('[data-testid="data-testid ac-add-mcp-server"]');
    await expect(addButton).toBeVisible();

    // Count existing servers before adding - using test ID pattern
    const removeButtonsLocator = page.locator('[data-testid^="data-testid ac-mcp-server-remove-"]');
    const existingServerCount = await removeButtonsLocator.count();

    // First add an MCP server
    await addButton.click();

    // Wait for the new server card to be visible
    await expect(page.getByText('New MCP Server').first()).toBeVisible();

    // Verify a new server was added
    await expect(removeButtonsLocator).toHaveCount(existingServerCount + 1);

    // Click the last Remove button (the newly added server) - using test ID pattern
    await removeButtonsLocator.last().click();

    // Verify we're back to the original count (server was removed)
    await expect(removeButtonsLocator).toHaveCount(existingServerCount);
  });
});
