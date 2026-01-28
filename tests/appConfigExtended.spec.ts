import { test, expect, disableBuiltInMCP } from './fixtures';

test.describe('AppConfig LLM Settings', () => {
  test('should configure LLM settings with complete validation flow', async ({ appConfigPage, page }) => {
    void appConfigPage;

    await test.step('Verify LLM Settings section is visible', async () => {
      // The LLM Settings fieldset should be visible
      await expect(page.getByText('LLM Settings', { exact: true })).toBeVisible();
    });

    await test.step('Verify Max Total Tokens field with default value', async () => {
      const maxTokensInput = page.getByLabel('Max Total Tokens');
      await expect(maxTokensInput).toBeVisible();

      // Should have some default value
      const value = await maxTokensInput.inputValue();
      expect(parseInt(value, 10)).toBeGreaterThan(0);
    });

    await test.step('Test minimum token validation', async () => {
      const maxTokensInput = page.getByLabel('Max Total Tokens');
      await maxTokensInput.clear();
      await maxTokensInput.fill('500'); // Below minimum

      // Save button should be disabled for invalid value
      const saveButton = page.getByRole('button', { name: /Save LLM settings/i });
      await expect(saveButton).toBeDisabled();
    });

    await test.step('Test valid token value enables save', async () => {
      const maxTokensInput = page.getByLabel('Max Total Tokens');
      await maxTokensInput.clear();
      await maxTokensInput.fill('50000'); // Valid value

      const saveButton = page.getByRole('button', { name: /Save LLM settings/i });
      await expect(saveButton).toBeEnabled();
    });
  });
});

test.describe('AppConfig MCP Server Management', () => {
  test('should manage MCP server CRUD operations', async ({ appConfigPage, page }) => {
    void appConfigPage;

    // Disable built-in MCP mode to enable external MCP server configuration
    await disableBuiltInMCP(page);

    await test.step('Verify add MCP server button and add new card', async () => {
      const addButton = page.locator('[data-testid="data-testid ac-add-mcp-server"]');
      await expect(addButton).toBeVisible();

      await addButton.click();

      // A new server card should appear
      const serverCards = page.locator('[data-testid^="data-testid ac-mcp-server-"]').first();
      await expect(serverCards).toBeVisible();
    });

    await test.step('Verify default server type is openapi', async () => {
      // Find the type dropdown
      const typeDropdown = page.locator('select.gf-form-input').last();
      await expect(typeDropdown).toHaveValue('openapi');
    });

    await test.step('Change server type', async () => {
      const typeDropdown = page.locator('select.gf-form-input').last();

      // Change to SSE
      await typeDropdown.selectOption('sse');
      await expect(typeDropdown).toHaveValue('sse');

      // Change to standard
      await typeDropdown.selectOption('standard');
      await expect(typeDropdown).toHaveValue('standard');
    });

    await test.step('Update server name and verify header updates', async () => {
      const nameInput = page.locator('[data-testid^="data-testid ac-mcp-server-name-"]').last();
      await nameInput.clear();
      await nameInput.fill('My Custom Server');

      // The header should update
      await expect(page.getByText('My Custom Server')).toBeVisible();
    });

    await test.step('Remove MCP server', async () => {
      const addButton = page.locator('[data-testid="data-testid ac-add-mcp-server"]');

      // Add another server so we have at least 2
      await addButton.click();

      // Get initial count
      const serverCards = page.locator('[data-testid^="data-testid ac-mcp-server-name-"]');
      const initialCount = await serverCards.count();
      expect(initialCount).toBeGreaterThanOrEqual(2);

      // Remove one server
      const removeButton = page.locator('[data-testid^="data-testid ac-mcp-server-remove-"]').first();
      await removeButton.click();

      // Count should decrease
      const newCount = await serverCards.count();
      expect(newCount).toBe(initialCount - 1);
    });
  });

  test('should configure MCP server advanced options with headers', async ({ appConfigPage, page }) => {
    void appConfigPage;

    // Disable built-in MCP mode to enable external MCP server configuration
    await disableBuiltInMCP(page);

    await test.step('Add server and expand advanced options', async () => {
      const addButton = page.locator('[data-testid="data-testid ac-add-mcp-server"]');
      await addButton.click();

      // Click advanced toggle
      const advancedToggle = page.locator('[data-testid^="data-testid ac-mcp-server-advanced-"]').last();
      await advancedToggle.click();

      // Headers section should be visible
      await expect(page.getByText('Custom Headers')).toBeVisible();
    });

    await test.step('Add custom header and verify inputs appear', async () => {
      // Add header
      const addHeaderButton = page.locator('[data-testid^="data-testid ac-mcp-server-add-header-"]').last();
      await addHeaderButton.click();

      // Header inputs should appear
      const headerKeyInput = page.locator('[data-testid^="data-testid ac-mcp-server-header-key-"]').last();
      await expect(headerKeyInput).toBeVisible();

      const headerValueInput = page.locator('[data-testid^="data-testid ac-mcp-server-header-value-"]').last();
      await expect(headerValueInput).toBeVisible();
    });

    await test.step('Fill header key and value', async () => {
      const headerKeyInput = page.locator('[data-testid^="data-testid ac-mcp-server-header-key-"]').last();
      await headerKeyInput.fill('Authorization');

      const headerValueInput = page.locator('[data-testid^="data-testid ac-mcp-server-header-value-"]').last();
      await headerValueInput.fill('Bearer token123');

      await expect(headerKeyInput).toHaveValue('Authorization');
      await expect(headerValueInput).toHaveValue('Bearer token123');
    });
  });
});

test.describe('AppConfig System Prompt', () => {
  test('should handle system prompt mode switching with validation', async ({ appConfigPage, page }) => {
    void appConfigPage;

    await test.step('Verify default mode is selected', async () => {
      const defaultModeRadio = page.getByLabel('Use default prompt');
      await expect(defaultModeRadio).toBeChecked();
    });

    await test.step('Verify view default prompt button is visible', async () => {
      // The View Default Prompt button should be visible
      const viewButton = page.locator('[data-testid="data-testid ac-view-default-prompt"]');
      await expect(viewButton).toBeVisible();
    });

    await test.step('Verify save is enabled in default mode', async () => {
      // Ensure default mode is selected
      await page.getByLabel('Use default prompt').click();

      // Save button should be enabled
      const saveButton = page.locator('[data-testid="data-testid ac-save-system-prompt"]');
      await expect(saveButton).toBeEnabled();
    });

    await test.step('Switch to replace mode and verify textarea appears', async () => {
      await page.getByLabel('Replace with custom prompt').click();

      // Custom prompt textarea should appear
      const customPromptTextarea = page.locator('[data-testid="data-testid ac-custom-system-prompt"]');
      await expect(customPromptTextarea).toBeVisible();
    });

    await test.step('Verify save disabled in replace mode without content', async () => {
      // Save button should be disabled (empty prompt)
      const saveButton = page.locator('[data-testid="data-testid ac-save-system-prompt"]');
      await expect(saveButton).toBeDisabled();
    });

    await test.step('Fill custom prompt and verify character count', async () => {
      // Type something
      const customPromptTextarea = page.locator('[data-testid="data-testid ac-custom-system-prompt"]');
      await customPromptTextarea.fill('Test prompt content');

      // Character count should be visible
      const charCount = page.locator('[data-testid="data-testid ac-custom-prompt-char-count"]');
      await expect(charCount).toContainText('Characters: 19');
    });

    await test.step('Verify save enabled in replace mode with content', async () => {
      const customPromptTextarea = page.locator('[data-testid="data-testid ac-custom-system-prompt"]');

      // Clear and fill with different content
      await customPromptTextarea.clear();
      await customPromptTextarea.fill('My custom assistant prompt');

      // Save button should be enabled
      const saveButton = page.locator('[data-testid="data-testid ac-save-system-prompt"]');
      await expect(saveButton).toBeEnabled();
    });

    await test.step('Switch to append mode and verify textarea visible', async () => {
      await page.getByLabel('Append to default prompt').click();

      // Custom prompt textarea should appear
      const customPromptTextarea = page.locator('[data-testid="data-testid ac-custom-system-prompt"]');
      await expect(customPromptTextarea).toBeVisible();
    });
  });
});
