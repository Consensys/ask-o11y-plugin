import { test, expect } from './fixtures';

test.describe('MCP Server Advanced Options', () => {
  test.beforeEach(async ({ appConfigPage, page }) => {
    void appConfigPage;

    const addButton = page.locator('[data-testid="data-testid ac-add-mcp-server"]');
    await expect(addButton).toBeVisible();
    await addButton.click();
    await expect(page.getByText('New MCP Server').first()).toBeVisible();
  });

  test('should manage headers lifecycle', async ({ page }) => {
    // Expand advanced options
    const advancedToggle = page.locator('[data-testid^="data-testid ac-mcp-server-advanced-"]').last();
    await advancedToggle.click();
    await expect(page.getByText('Custom Headers')).toBeVisible();

    // Add header button should now be visible
    const addHeaderButton = page.locator('[data-testid^="data-testid ac-mcp-server-add-header-"]').last();
    await expect(addHeaderButton).toBeVisible();
    await addHeaderButton.click();

    // Fill header
    const headerKeyInput = page.locator('[data-testid^="data-testid ac-mcp-server-header-key-"]').last();
    const headerValueInput = page.locator('[data-testid^="data-testid ac-mcp-server-header-value-"]').last();
    await expect(headerKeyInput).toBeVisible();
    await expect(headerValueInput).toBeVisible();

    await headerKeyInput.fill('Authorization');
    await headerValueInput.fill('Bearer test-token');

    // Header count in toggle
    await expect(advancedToggle).toContainText('1 header');

    // Remove header
    const removeHeaderButton = page.locator('[data-testid^="data-testid ac-mcp-server-header-remove-"]').last();
    await removeHeaderButton.click();

    const remainingHeaders = await page.locator('[data-testid^="data-testid ac-mcp-server-header-key-"]').count();
    expect(remainingHeaders).toBe(0);
  });

  test('should disable add-header when incomplete header exists', async ({ page }) => {
    const advancedToggle = page.locator('[data-testid^="data-testid ac-mcp-server-advanced-"]').last();
    await advancedToggle.click();

    const addHeaderButton = page.locator('[data-testid^="data-testid ac-mcp-server-add-header-"]').last();
    await addHeaderButton.click();

    // Empty key disables the add button
    await expect(addHeaderButton).toBeDisabled();

    // Fill key re-enables it
    const headerKeyInput = page.locator('[data-testid^="data-testid ac-mcp-server-header-key-"]').last();
    await headerKeyInput.fill('Valid-Key');
    await expect(addHeaderButton).toBeEnabled();
  });
});
