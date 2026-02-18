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
  test('should add, configure, and remove MCP servers via modal', async ({ appConfigPage, page }) => {
    void appConfigPage;

    const addButton = page.locator('[data-testid="data-testid ac-add-mcp-server"]');
    await expect(addButton).toBeVisible();

    // Count initial table rows
    const tableRows = page.locator('table tbody tr');
    const initialCount = await tableRows.count();

    // Add a server - should open modal
    await addButton.click();
    await expect(page.getByText('Add MCP Server')).toBeVisible();

    // Fill in server details in modal
    const nameInput = page.getByTestId('mcp-modal-name-input');
    await nameInput.fill('E2E Test Server');

    const urlInput = page.getByTestId('mcp-modal-url-input');
    await urlInput.fill('https://test-mcp.example.com');

    // Change server type in modal
    const typeDropdown = page.getByTestId('mcp-modal-type-select');
    await expect(typeDropdown).toHaveValue('streamable-http');
    await typeDropdown.selectOption('sse');
    await expect(typeDropdown).toHaveValue('sse');

    // Save the server
    const saveButton = page.getByTestId('mcp-modal-save-button');
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // Modal should close and server should appear in table
    await expect(page.getByText('Add MCP Server')).not.toBeVisible();
    await expect(tableRows).toHaveCount(initialCount + 1);
    await expect(page.getByText('E2E Test Server')).toBeVisible();

    // Remove the server via delete button in table
    const deleteButtons = page.locator('button:has-text("Delete")');
    await deleteButtons.last().click();
    await expect(tableRows).toHaveCount(initialCount);
  });

  test('should edit existing server via modal', async ({ appConfigPage, page }) => {
    void appConfigPage;

    // Add a server first
    const addButton = page.locator('[data-testid="data-testid ac-add-mcp-server"]');
    await addButton.click();
    await page.getByTestId('mcp-modal-name-input').fill('Test Server');
    await page.getByTestId('mcp-modal-url-input').fill('https://test.example.com');
    await page.getByTestId('mcp-modal-save-button').click();

    // Wait for modal to close
    await expect(page.getByText('Add MCP Server')).not.toBeVisible();

    // Click Edit button
    const editButtons = page.locator('button:has-text("Edit")');
    await editButtons.last().click();

    // Modal should open in edit mode
    await expect(page.getByText('Edit MCP Server')).toBeVisible();
    const nameInput = page.getByTestId('mcp-modal-name-input');
    await expect(nameInput).toHaveValue('Test Server');

    // Change the name
    await nameInput.clear();
    await nameInput.fill('Updated Server');

    // Save changes
    await page.getByTestId('mcp-modal-save-button').click();

    // Modal should close and changes should be visible
    await expect(page.getByText('Edit MCP Server')).not.toBeVisible();
    await expect(page.getByText('Updated Server')).toBeVisible();
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
