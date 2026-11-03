import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

async function openSettingsTab(page: Page, tabId: string) {
  await page.locator(`[data-testid="data-testid ac-settings-tab-${tabId}"]`).click();
}

test.describe('Tool discovery settings', () => {
  test('should persist the discovery mode and the budget across a save', async ({ appConfigPage, page }) => {
    await openSettingsTab(page, 'agent-runtime');

    const modeGroup = page.locator('[data-testid="data-testid ac-tool-search-mode"]');
    await expect(modeGroup).toBeVisible();

    // Auto is the default: the threshold input is visible and can be changed.
    const budgetInput = page.locator('[data-testid="data-testid ac-tool-search-budget"]');
    await expect(budgetInput).toBeVisible();
    await budgetInput.clear();
    await budgetInput.fill('7500');

    const saveButton = page.getByRole('button', { name: /Save agent runtime/i });
    await expect(saveButton).toBeEnabled();

    const saveResponse = appConfigPage.waitForSettingsResponse();
    await saveButton.click();
    await expect(saveResponse).toBeOK();
    await page.waitForLoadState('domcontentloaded');

    await openSettingsTab(page, 'agent-runtime');
    await expect(page.locator('[data-testid="data-testid ac-tool-search-budget"]')).toHaveValue('7500');
  });

  test('should hide the budget input when discovery is off', async ({ appConfigPage, page }) => {
    void appConfigPage;
    await openSettingsTab(page, 'agent-runtime');

    await page.locator('[data-testid="data-testid ac-tool-search-mode"]').getByText('Off', { exact: true }).click();

    await expect(page.locator('[data-testid="data-testid ac-tool-search-budget"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="data-testid ac-tool-search-always-include"]')).toBeVisible();

    // Leave the plugin on a clean state for the specs that follow.
    await page.locator('[data-testid="data-testid ac-tool-search-mode"]').getByText('Auto', { exact: true }).click();
  });
});
