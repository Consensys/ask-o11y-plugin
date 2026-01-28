import { test, expect } from './fixtures';

test.describe('Combined MCP Mode', () => {
  test('should allow configuring external servers with built-in MCP enabled', async ({ appConfigPage, page }) => {
    void appConfigPage;

    // Ensure built-in MCP is enabled
    const builtInToggle = page.locator('[data-testid="data-testid ac-use-builtin-mcp-toggle"]');
    const isBuiltInEnabled = await builtInToggle.isChecked().catch(() => false);

    if (!isBuiltInEnabled) {
      await builtInToggle.click();
      const saveMCPModeButton = page.locator('[data-testid="data-testid ac-save-mcp-mode"]');
      await saveMCPModeButton.click();
      await page.waitForTimeout(1000);
    }

    // Verify external MCP server configuration is available (not disabled)
    const addButton = page.locator('[data-testid="data-testid ac-add-mcp-server"]');
    await expect(addButton).toBeEnabled();

    // Add an external MCP server
    await addButton.click();

    // Verify the new server card appears
    const serverCards = page.locator('[data-testid^="data-testid ac-mcp-server-"]');
    await expect(serverCards.first()).toBeVisible();

    // Configure the server
    const nameInput = page.locator('[data-testid^="data-testid ac-mcp-server-name-"]').first();
    const urlInput = page.locator('[data-testid^="data-testid ac-mcp-server-url-"]').first();

    await nameInput.fill('Test External Server');
    await urlInput.fill('https://mcp.example.com');

    // Verify inputs are not disabled (combined mode allows external configuration)
    await expect(nameInput).toBeEnabled();
    await expect(urlInput).toBeEnabled();

    // Save the external server
    const saveMCPServersButton = page.locator('[data-testid="data-testid ac-save-mcp-servers"]');
    await expect(saveMCPServersButton).toBeEnabled();
  });

  test('should not show "External servers disabled" alert when built-in is enabled', async ({
    appConfigPage,
    page,
  }) => {
    void appConfigPage;

    // Enable built-in MCP
    const builtInToggle = page.locator('[data-testid="data-testid ac-use-builtin-mcp-toggle"]');
    const isBuiltInEnabled = await builtInToggle.isChecked().catch(() => false);

    if (!isBuiltInEnabled) {
      await builtInToggle.click();
      const saveMCPModeButton = page.locator('[data-testid="data-testid ac-save-mcp-mode"]');
      await saveMCPModeButton.click();
      await page.waitForTimeout(1000);
      await page.reload();
    }

    // Verify the old blocking alert is NOT shown
    const disabledAlert = page.getByText(/external mcp servers disabled/i);
    await expect(disabledAlert).not.toBeVisible();

    // Verify the add button is enabled
    const addButton = page.locator('[data-testid="data-testid ac-add-mcp-server"]');
    await expect(addButton).toBeEnabled();
  });

  test('should allow editing external servers with built-in enabled', async ({ appConfigPage, page }) => {
    void appConfigPage;

    // Enable built-in MCP
    const builtInToggle = page.locator('[data-testid="data-testid ac-use-builtin-mcp-toggle"]');
    const isBuiltInEnabled = await builtInToggle.isChecked().catch(() => false);

    if (!isBuiltInEnabled) {
      await builtInToggle.click();
      const saveMCPModeButton = page.locator('[data-testid="data-testid ac-save-mcp-mode"]');
      await saveMCPModeButton.click();
      await page.waitForTimeout(1000);
    }

    // Add an external server
    const addButton = page.locator('[data-testid="data-testid ac-add-mcp-server"]');
    await addButton.click();

    const nameInput = page.locator('[data-testid^="data-testid ac-mcp-server-name-"]').first();
    const urlInput = page.locator('[data-testid^="data-testid ac-mcp-server-url-"]').first();

    await nameInput.fill('Initial Name');
    await urlInput.fill('https://initial.example.com');

    // Save the server
    const saveMCPServersButton = page.locator('[data-testid="data-testid ac-save-mcp-servers"]');
    await saveMCPServersButton.click();
    await page.waitForTimeout(2000);

    // Reload and edit the server
    await page.reload();
    await page.waitForTimeout(1000);

    const editedNameInput = page.locator('[data-testid^="data-testid ac-mcp-server-name-"]').first();
    await expect(editedNameInput).toBeEnabled();

    // Clear and update the name
    await editedNameInput.clear();
    await editedNameInput.fill('Updated Name');

    // Verify we can save the updated configuration
    await expect(saveMCPServersButton).toBeEnabled();
  });

  test('should allow removing external servers with built-in enabled', async ({ appConfigPage, page }) => {
    void appConfigPage;

    // Enable built-in MCP
    const builtInToggle = page.locator('[data-testid="data-testid ac-use-builtin-mcp-toggle"]');
    const isBuiltInEnabled = await builtInToggle.isChecked().catch(() => false);

    if (!isBuiltInEnabled) {
      await builtInToggle.click();
      const saveMCPModeButton = page.locator('[data-testid="data-testid ac-save-mcp-mode"]');
      await saveMCPModeButton.click();
      await page.waitForTimeout(1000);
    }

    // Count existing servers first (before adding)
    const initialServerCount = await page.locator('[data-testid^="data-testid ac-mcp-server-name-"]').count();

    // Add an external server
    const addButton = page.locator('[data-testid="data-testid ac-add-mcp-server"]');
    await addButton.click();

    // Wait for new server form to appear
    await expect(page.locator('[data-testid^="data-testid ac-mcp-server-name-"]').nth(initialServerCount)).toBeVisible({ timeout: 5000 });

    const nameInput = page.locator('[data-testid^="data-testid ac-mcp-server-name-"]').nth(initialServerCount);
    await nameInput.fill('Server To Remove');

    // Verify server was added
    const serversAfterAdd = await page.locator('[data-testid^="data-testid ac-mcp-server-name-"]').count();
    expect(serversAfterAdd).toBe(initialServerCount + 1);

    // Click remove button for the newly added server
    const removeButton = page.locator('[data-testid^="data-testid ac-mcp-server-remove-"]').nth(initialServerCount);
    await expect(removeButton).toBeEnabled({ timeout: 5000 });
    await removeButton.click();

    // Verify server was removed - should be back to initial count
    await page.waitForTimeout(500); // Give time for UI to update
    const serversAfterRemoval = await page.locator('[data-testid^="data-testid ac-mcp-server-name-"]').count();
    expect(serversAfterRemoval).toBe(initialServerCount);
  });
});
