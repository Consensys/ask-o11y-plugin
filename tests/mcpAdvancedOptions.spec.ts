import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

test.describe('MCP Server Advanced Options', () => {
  const openAddServerModal = async (page: Page) => {
    const addButton = page.getByTestId('data-testid ac-add-mcp-server');
    await expect(addButton).toBeVisible();
    await addButton.click();
    await expect(page.getByRole('heading', { name: 'Add MCP Server' })).toBeVisible();
  };

  test('should manage headers lifecycle', async ({ appConfigPage, page }) => {
    void appConfigPage;
    const serverName = `Headers Lifecycle ${Date.now()}`;
    const headersButton = page.getByRole('button', { name: /^Headers/ });

    await openAddServerModal(page);
    await page.getByTestId('mcp-modal-name-input').fill(serverName);
    await page.getByTestId('mcp-modal-url-input').fill('https://headers-lifecycle.example.com');

    await headersButton.click();
    const headersTextarea = page.getByTestId('mcp-modal-headers-textarea');
    await expect(headersTextarea).toBeVisible();
    await headersTextarea.fill('Authorization: Bearer test-token');
    await expect(page.getByRole('button', { name: /^Headers \(1 configured\)$/ })).toBeVisible();

    await page.getByTestId('mcp-modal-save-button').click();
    await expect(page.getByRole('heading', { name: 'Add MCP Server' })).not.toBeVisible();

    const serverRow = page.locator('table tbody tr', { hasText: serverName });
    await expect(serverRow).toBeVisible();
    await serverRow.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: 'Edit MCP Server' })).toBeVisible();

    await page.getByRole('button', { name: /^Headers \(1 configured\)$/ }).click();
    const editHeadersTextarea = page.getByTestId('mcp-modal-headers-textarea');
    await expect(editHeadersTextarea).toHaveValue('Authorization: Bearer test-token');

    await editHeadersTextarea.fill('');
    await page.getByTestId('mcp-modal-save-button').click();
    await expect(page.getByRole('heading', { name: 'Edit MCP Server' })).not.toBeVisible();

    await serverRow.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: 'Edit MCP Server' })).toBeVisible();
    await page.getByRole('button', { name: /^Headers$/ }).click();
    await expect(page.getByTestId('mcp-modal-headers-textarea')).toHaveValue('');
  });

  test('should validate header format before save', async ({ appConfigPage, page }) => {
    void appConfigPage;

    await openAddServerModal(page);
    await page.getByTestId('mcp-modal-name-input').fill(`Header Validation ${Date.now()}`);
    await page.getByTestId('mcp-modal-url-input').fill('https://header-validation.example.com');
    await page.getByRole('button', { name: /^Headers/ }).click();

    const headersTextarea = page.getByTestId('mcp-modal-headers-textarea');
    await headersTextarea.fill('Authorization Bearer test-token');

    await expect(page.getByText('Line 1: Missing colon separator (expected format: Key: Value)')).toBeVisible();
    await expect(page.getByTestId('mcp-modal-save-button')).toBeDisabled();

    await headersTextarea.fill('Authorization: Bearer test-token');
    await expect(page.getByText('Line 1: Missing colon separator (expected format: Key: Value)')).not.toBeVisible();
    await expect(page.getByTestId('mcp-modal-save-button')).toBeEnabled();
  });
});
