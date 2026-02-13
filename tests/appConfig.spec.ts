import { test, expect } from './fixtures';

test.describe('LLM Settings', () => {
  test('should save valid config and reject invalid token limits', async ({ appConfigPage, page }) => {
    const maxTokensInput = page.getByLabel('Max Total Tokens');
    const saveButton = page.getByRole('button', { name: /Save LLM settings/i });

    // Reject value below minimum (1000)
    await maxTokensInput.clear();
    await maxTokensInput.fill('500');
    await expect(saveButton).toBeDisabled();

    // Accept valid value and save
    await maxTokensInput.clear();
    await maxTokensInput.fill('75000');
    await expect(saveButton).toBeEnabled();

    const saveResponse = appConfigPage.waitForSettingsResponse();
    await saveButton.click();
    await expect(saveResponse).toBeOK();
  });
});

test.describe('MCP Server Management', () => {
  test('should add, configure, and remove MCP servers', async ({ appConfigPage, page }) => {
    void appConfigPage;

    const addButton = page.locator('[data-testid="data-testid ac-add-mcp-server"]');
    await expect(addButton).toBeVisible();

    const removeButtons = page.locator('[data-testid^="data-testid ac-mcp-server-remove-"]');
    const initialCount = await removeButtons.count();

    // Add a server
    await addButton.click();
    await expect(removeButtons).toHaveCount(initialCount + 1);
    await expect(page.getByText('New MCP Server').first()).toBeVisible();

    // Configure name and URL
    const nameInput = page.locator('[data-testid^="data-testid ac-mcp-server-name-"]').last();
    await nameInput.clear();
    await nameInput.fill('E2E Test Server');
    await expect(page.getByText('E2E Test Server').first()).toBeVisible();

    const urlInput = page.locator('[data-testid^="data-testid ac-mcp-server-url-"]').last();
    await urlInput.fill('https://test-mcp.example.com');

    // Change server type
    const typeDropdown = page.locator('select.gf-form-input').last();
    await expect(typeDropdown).toHaveValue('openapi');
    await typeDropdown.selectOption('sse');
    await expect(typeDropdown).toHaveValue('sse');
    await typeDropdown.selectOption('streamable-http');
    await expect(typeDropdown).toHaveValue('streamable-http');

    // Save button should be enabled
    const saveMcpButton = page.locator('[data-testid="data-testid ac-save-mcp-servers"]');
    await expect(saveMcpButton).toBeEnabled();

    // Remove the server
    await removeButtons.last().click();
    await expect(removeButtons).toHaveCount(initialCount);
  });

  test('should show "Unnamed Server" when name is cleared', async ({ appConfigPage, page }) => {
    void appConfigPage;

    const addButton = page.locator('[data-testid="data-testid ac-add-mcp-server"]');
    await addButton.click();

    const nameInput = page.locator('[data-testid^="data-testid ac-mcp-server-name-"]').last();
    await nameInput.clear();
    await nameInput.blur();

    await expect(page.getByText('Unnamed Server')).toBeVisible();
  });
});

test.describe('System Prompt', () => {
  test('should handle mode switching and validation', async ({ appConfigPage, page }) => {
    void appConfigPage;

    const customPromptTextarea = page.locator('[data-testid="data-testid ac-custom-system-prompt"]');
    const saveButton = page.locator('[data-testid="data-testid ac-save-system-prompt"]');

    // Default mode: textarea hidden, save enabled
    await expect(page.getByLabel('Use default prompt')).toBeChecked();
    await expect(customPromptTextarea).not.toBeVisible();
    await expect(saveButton).toBeEnabled();

    // Replace mode: textarea visible, save disabled when empty
    await page.getByLabel('Replace with custom prompt').click();
    await expect(customPromptTextarea).toBeVisible();
    await expect(saveButton).toBeDisabled();

    // Fill prompt, verify char count, save enabled
    await customPromptTextarea.fill('Test prompt content');
    const charCount = page.locator('[data-testid="data-testid ac-custom-prompt-char-count"]');
    await expect(charCount).toContainText('Characters: 19');
    await expect(saveButton).toBeEnabled();

    // Append mode: textarea visible
    await page.getByLabel('Append to default prompt').click();
    await expect(customPromptTextarea).toBeVisible();
    // Content preserved across mode switches
    await expect(customPromptTextarea).toHaveValue('Test prompt content');

    // Back to default: textarea hidden
    await page.getByLabel('Use default prompt').click();
    await expect(customPromptTextarea).not.toBeVisible();
  });

  test('should interact with default prompt modal', async ({ appConfigPage, page }) => {
    void appConfigPage;

    const viewDefaultButton = page.locator('[data-testid="data-testid ac-view-default-prompt"]');
    await viewDefaultButton.click();

    await expect(page.getByRole('heading', { name: 'Default System Prompt' })).toBeVisible();
    await expect(page.locator('[data-testid="data-testid ac-default-prompt-content"]')).toBeVisible();
    await expect(page.locator('[data-testid="data-testid ac-copy-default-prompt"]')).toBeVisible();

    await page.locator('[data-testid="data-testid ac-close-default-prompt"]').click();
    await expect(page.getByRole('heading', { name: 'Default System Prompt' })).not.toBeVisible();
  });
});
