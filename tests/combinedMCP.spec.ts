import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Ensure built-in MCP is enabled, clicking the toggle and saving if needed.
 */
async function ensureBuiltInMCPEnabled(page: Page, shouldReload = false): Promise<void> {
  const builtInToggle = page.getByTestId('data-testid ac-use-builtin-mcp-toggle');
  const isBuiltInEnabled = await builtInToggle.isChecked().catch(() => false);

  if (!isBuiltInEnabled) {
    await builtInToggle.click();
    const saveMCPModeButton = page.getByTestId('data-testid ac-save-mcp-mode');
    await saveMCPModeButton.click();
    await page.waitForLoadState('domcontentloaded');
    if (shouldReload) {
      await page.reload();
    }
  }
}

async function addServerFromModal(page: Page, name: string, url: string) {
  const addButton = page.getByTestId('data-testid ac-add-mcp-server');
  await expect(addButton).toBeEnabled();
  await addButton.click();
  await expect(page.getByRole('heading', { name: 'Add MCP Server' })).toBeVisible();

  await page.getByTestId('mcp-modal-name-input').fill(name);
  await page.getByTestId('mcp-modal-url-input').fill(url);
  await page.getByTestId('mcp-modal-save-button').click();
  await expect(page.getByRole('heading', { name: 'Add MCP Server' })).not.toBeVisible();
}

test.describe('Combined MCP Mode', () => {
  test('should allow configuring external servers with built-in MCP enabled', async ({ appConfigPage, page }) => {
    void appConfigPage;

    await ensureBuiltInMCPEnabled(page);
    const serverName = `Combined Mode Server ${Date.now()}`;

    // Verify external MCP server configuration is available (not disabled)
    const addButton = page.getByTestId('data-testid ac-add-mcp-server');
    await expect(addButton).toBeEnabled();

    await addServerFromModal(page, serverName, 'https://mcp.example.com');
    await expect(page.locator('table tbody tr', { hasText: serverName })).toBeVisible();

    // Saving external servers remains enabled in combined mode
    const saveMCPServersButton = page.getByTestId('data-testid ac-save-mcp-servers');
    await expect(saveMCPServersButton).toBeEnabled();
  });

  test('should not show "External servers disabled" alert when built-in is enabled', async ({
    appConfigPage,
    page,
  }) => {
    void appConfigPage;

    await ensureBuiltInMCPEnabled(page, true);

    // Verify the old blocking alert is NOT shown
    const disabledAlert = page.getByText(/external mcp servers disabled/i);
    await expect(disabledAlert).not.toBeVisible();

    // Verify the add button is enabled
    const addButton = page.getByTestId('data-testid ac-add-mcp-server');
    await expect(addButton).toBeEnabled();
  });

  test('should allow editing external servers with built-in enabled', async ({ appConfigPage, page }) => {
    void appConfigPage;

    await ensureBuiltInMCPEnabled(page);
    const initialName = `Initial Name ${Date.now()}`;
    const updatedName = `${initialName} Updated`;

    await addServerFromModal(page, initialName, 'https://initial.example.com');

    const initialRow = page.locator('table tbody tr', { hasText: initialName });
    await expect(initialRow).toBeVisible();
    await initialRow.getByRole('button', { name: 'Edit' }).click();

    await expect(page.getByRole('heading', { name: 'Edit MCP Server' })).toBeVisible();
    const editedNameInput = page.getByTestId('mcp-modal-name-input');
    await editedNameInput.clear();
    await editedNameInput.fill(updatedName);
    await page.getByTestId('mcp-modal-save-button').click();
    await expect(page.getByRole('heading', { name: 'Edit MCP Server' })).not.toBeVisible();

    await expect(page.locator('table tbody tr', { hasText: updatedName })).toBeVisible();
  });

  test('should allow removing external servers with built-in enabled', async ({ appConfigPage, page }) => {
    void appConfigPage;

    await ensureBuiltInMCPEnabled(page);
    const serverName = `Server To Remove ${Date.now()}`;

    // Count existing servers first (before adding)
    const tableRows = page.locator('table tbody tr');
    const initialServerCount = await tableRows.count();

    await addServerFromModal(page, serverName, 'https://remove.example.com');
    await expect(tableRows).toHaveCount(initialServerCount + 1);

    const serverRow = page.locator('table tbody tr', { hasText: serverName });
    await expect(serverRow).toBeVisible();
    await serverRow.getByRole('button', { name: /Remove server/i }).click();

    // Verify server was removed - should be back to initial count
    await expect(serverRow).toBeHidden();
    await expect(tableRows).toHaveCount(initialServerCount);
  });
});
