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

test.describe('Prompt Templates', () => {
  test('should display all three prompt editors', async ({ appConfigPage, page }) => {
    void appConfigPage;

    await expect(page.getByText('Prompt Templates', { exact: true })).toBeVisible();

    await expect(page.locator('[data-testid="ac-prompt-system-edit-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="ac-prompt-investigation-edit-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="ac-prompt-performance-edit-button"]')).toBeVisible();
  });

  test('should open editor modal with working controls', async ({ appConfigPage, page }) => {
    void appConfigPage;

    await page.locator('[data-testid="ac-prompt-system-edit-button"]').click();
    await expect(page.getByRole('heading', { name: 'Edit System Prompt' })).toBeVisible();

    const textarea = page.locator('[data-testid="ac-prompt-system-textarea"]');
    const saveButton = page.locator('[data-testid="ac-prompt-system-save-button"]');
    const resetButton = page.locator('[data-testid="ac-prompt-system-reset-button"]');

    await expect(textarea).toBeVisible();

    // No changes yet: save disabled, reset disabled (using default)
    await expect(saveButton).toBeDisabled();
    await expect(resetButton).toBeDisabled();

    // Edit prompt: save becomes enabled, reset becomes enabled
    await textarea.fill('Custom system prompt for testing');
    await expect(saveButton).toBeEnabled();
    await expect(resetButton).toBeEnabled();
    await expect(page.getByText(/\d+ \/ 15000 characters/)).toBeVisible();

    // Reset to default: both buttons disabled again
    await resetButton.click();
    await expect(saveButton).toBeDisabled();
    await expect(resetButton).toBeDisabled();

    // Dismiss modal via close button
    await page.locator('[aria-label="Close"]').click();
    await expect(page.getByRole('heading', { name: 'Edit System Prompt' })).not.toBeVisible();
  });
});
