import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

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
  const openAddServerModal = async (page: Page) => {
    const addButton = page.getByTestId('data-testid ac-add-mcp-server');
    await expect(addButton).toBeVisible();
    await addButton.click();
    await expect(page.getByRole('heading', { name: 'Add MCP Server' })).toBeVisible();
  };

  test('should add, configure, and remove MCP servers via modal', async ({ appConfigPage, page }) => {
    void appConfigPage;

    // Count initial table rows
    const tableRows = page.locator('table tbody tr');
    const initialCount = await tableRows.count();
    const serverName = `E2E Test Server ${Date.now()}`;

    // Add a server - should open modal
    await openAddServerModal(page);

    // Fill in server details in modal
    const nameInput = page.getByTestId('mcp-modal-name-input');
    await nameInput.fill(serverName);

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
    await expect(page.getByRole('heading', { name: 'Add MCP Server' })).not.toBeVisible();
    await expect(tableRows).toHaveCount(initialCount + 1);
    const serverRow = page.locator('table tbody tr', { hasText: serverName });
    await expect(serverRow).toBeVisible();

    // Remove the server using its row action
    await serverRow.getByRole('button', { name: /Remove server/i }).click();
    await expect(serverRow).toBeHidden();
    await expect(tableRows).toHaveCount(initialCount);
  });

  test('should edit existing server via modal', async ({ appConfigPage, page }) => {
    void appConfigPage;
    const initialName = `Editable Server ${Date.now()}`;
    const updatedName = `${initialName} Updated`;

    // Add a server first
    await openAddServerModal(page);
    await page.getByTestId('mcp-modal-name-input').fill(initialName);
    await page.getByTestId('mcp-modal-url-input').fill('https://test.example.com');
    await page.getByTestId('mcp-modal-save-button').click();

    // Wait for modal to close
    await expect(page.getByRole('heading', { name: 'Add MCP Server' })).not.toBeVisible();

    // Edit the server from its row
    const serverRow = page.locator('table tbody tr', { hasText: initialName });
    await expect(serverRow).toBeVisible();
    await serverRow.getByRole('button', { name: 'Edit' }).click();

    // Modal should open in edit mode
    await expect(page.getByRole('heading', { name: 'Edit MCP Server' })).toBeVisible();
    const nameInput = page.getByTestId('mcp-modal-name-input');
    await expect(nameInput).toHaveValue(initialName);

    // Change the name
    await nameInput.clear();
    await nameInput.fill(updatedName);

    // Save changes
    await page.getByTestId('mcp-modal-save-button').click();

    // Modal should close and changes should be visible
    await expect(page.getByRole('heading', { name: 'Edit MCP Server' })).not.toBeVisible();
    const updatedRow = page.locator('table tbody tr', { hasText: updatedName });
    await expect(updatedRow).toBeVisible();
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
