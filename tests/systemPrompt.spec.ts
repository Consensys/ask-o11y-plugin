import { test, expect } from './fixtures';
import { testIds } from '../src/components/testIds';

test.describe('System Prompt Configuration', () => {
  test('should display system prompt configuration with mode switching', async ({ appConfigPage, page }) => {
    // Suppress the appConfigPage unused variable warning
    void appConfigPage;

    await test.step('Verify initial display', async () => {
      // The System Prompt fieldset should be visible (use exact match)
      await expect(page.getByText('System Prompt', { exact: true })).toBeVisible();

      // The description text should be visible
      await expect(page.getByText('Customize the system prompt that instructs the AI assistant')).toBeVisible();

      // The View Default Prompt button should be visible
      const viewDefaultButton = page.locator('[data-testid="data-testid ac-view-default-prompt"]');
      await expect(viewDefaultButton).toBeVisible();
    });

    await test.step('Show textarea in replace mode', async () => {
      // Initially, the custom prompt textarea should not be visible (default mode)
      const customPromptTextarea = page.locator('[data-testid="data-testid ac-custom-system-prompt"]');
      await expect(customPromptTextarea).not.toBeVisible();

      // Click on "Replace with custom prompt" option
      await page.getByLabel('Replace with custom prompt').click();

      // Now the custom prompt textarea should be visible
      await expect(customPromptTextarea).toBeVisible();

      // The character count should be visible
      const charCount = page.locator('[data-testid="data-testid ac-custom-prompt-char-count"]');
      await expect(charCount).toBeVisible();
      await expect(charCount).toContainText('Characters:');
    });

    await test.step('Show textarea in append mode', async () => {
      // Click on "Append to default prompt" option
      await page.getByLabel('Append to default prompt').click();

      // The custom prompt textarea should be visible
      const customPromptTextarea = page.locator('[data-testid="data-testid ac-custom-system-prompt"]');
      await expect(customPromptTextarea).toBeVisible();

      // The placeholder should indicate appending instructions
      await expect(customPromptTextarea).toHaveAttribute('placeholder', /Additional instructions/);
    });
  });

  test('should interact with default prompt modal', async ({ appConfigPage, page }) => {
    void appConfigPage;

    await test.step('Open modal and verify contents', async () => {
      // Click "View Default Prompt" button
      const viewDefaultPromptButton = page.locator('[data-testid="data-testid ac-view-default-prompt"]');
      await expect(viewDefaultPromptButton).toBeVisible();
      await viewDefaultPromptButton.click();

      // The modal should be visible (use heading for exact match)
      await expect(page.getByRole('heading', { name: 'Default System Prompt' })).toBeVisible();

      // The prompt content should be visible
      const promptContent = page.locator('[data-testid="data-testid ac-default-prompt-content"]');
      await expect(promptContent).toBeVisible();
    });

    await test.step('Verify copy button', async () => {
      // The copy button should be visible
      const copyButton = page.locator('[data-testid="data-testid ac-copy-default-prompt"]');
      await expect(copyButton).toBeVisible();
      await expect(copyButton).toContainText('Copy to Clipboard');
    });

    await test.step('Close modal', async () => {
      // Close button should be visible
      const closeButton = page.locator('[data-testid="data-testid ac-close-default-prompt"]');
      await expect(closeButton).toBeVisible();

      // Click close button
      await closeButton.click();

      // Modal should be closed (heading should not be visible)
      await expect(page.getByRole('heading', { name: 'Default System Prompt' })).not.toBeVisible();
    });
  });

  test('should manage save button state and character count', async ({ appConfigPage, page }) => {
    void appConfigPage;

    await test.step('Disable save with empty replace mode', async () => {
      // Click on "Replace with custom prompt" option
      await page.getByLabel('Replace with custom prompt').click();

      // The save button should be disabled when the prompt is empty
      const saveButton = page.locator('[data-testid="data-testid ac-save-system-prompt"]');
      await expect(saveButton).toBeDisabled();
    });

    await test.step('Enable save with content and update character count', async () => {
      // Check initial character count
      const charCount = page.locator('[data-testid="data-testid ac-custom-prompt-char-count"]');
      await expect(charCount).toContainText('Characters: 0');

      // Fill in the custom prompt
      const customPromptTextarea = page.locator('[data-testid="data-testid ac-custom-system-prompt"]');
      await customPromptTextarea.fill('Test prompt');

      // Character count should update
      await expect(charCount).toContainText('Characters: 11');

      // The save button should now be enabled
      const saveButton = page.locator('[data-testid="data-testid ac-save-system-prompt"]');
      await expect(saveButton).toBeEnabled();
    });
  });

  test('should switch between modes correctly', async ({ appConfigPage, page }) => {
    void appConfigPage;

    const customPromptTextarea = page.locator('[data-testid="data-testid ac-custom-system-prompt"]');

    // Start in default mode - textarea should not be visible
    await expect(customPromptTextarea).not.toBeVisible();

    // Switch to replace mode
    await page.getByLabel('Replace with custom prompt').click();
    await expect(customPromptTextarea).toBeVisible();

    // Switch to append mode
    await page.getByLabel('Append to default prompt').click();
    await expect(customPromptTextarea).toBeVisible();

    // Switch back to default mode
    await page.getByLabel('Use default prompt').click();
    await expect(customPromptTextarea).not.toBeVisible();
  });

  test('should enable save button in default mode', async ({ appConfigPage, page }) => {
    void appConfigPage;

    // In default mode, save button should be enabled (no custom prompt required)
    const saveButton = page.locator('[data-testid="data-testid ac-save-system-prompt"]');
    await expect(saveButton).toBeEnabled();
  });
});
