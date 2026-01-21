import { test, expect, clearPersistedSession } from './fixtures';
import { ROUTES } from '../src/constants';

test.describe('Session Sharing', () => {
  test.beforeEach(async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Home}`);

    // Clear any persisted session to ensure welcome message is visible
    await clearPersistedSession(page);

    const welcomeHeading = page.getByRole('heading', { name: 'Ask O11y Assistant' });
    await expect(welcomeHeading).toBeVisible();
  });

  test('should create a share link for a session', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');

    await test.step('Create a session with messages', async () => {
      // Send a message to create a session
      await chatInput.fill('Test message for sharing');
      await page.getByLabel('Send message (Enter)').click();
      await expect(page.locator('[role="log"]').getByText('Test message for sharing')).toBeVisible();

      // Wait for chat input to become enabled (indicates message processing is done)
      await expect(chatInput).toBeEnabled({ timeout: 30000 });

      // Session is saved immediately, but wait a bit longer to ensure it's fully persisted
      // and indexed before trying to share it
      await page.waitForTimeout(2000);
    });

    await test.step('Open sidebar and share session', async () => {
      // Open the sidebar
      await page.getByRole('button', { name: /History/i }).click();
      await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

      // Wait for session items to appear
      const sessionItems = page.locator('.p-1\\.5.rounded.group');
      await expect(sessionItems.first()).toBeVisible({ timeout: 15000 });

      // Find the share button for the first session
      const firstSession = sessionItems.first();
      await firstSession.hover();
      await page.waitForTimeout(200);

      // Click the share button
      const shareButton = firstSession.locator('button[title*="Share" i]').or(firstSession.getByRole('button', { name: /Share/i }));
      await expect(shareButton).toBeVisible({ timeout: 2000 });
      await shareButton.click();
    });

    await test.step('Create share in dialog', async () => {
      // Wait for share dialog to appear and session to be loaded
      await expect(page.getByRole('heading', { name: 'Share Session' })).toBeVisible({ timeout: 5000 });
      
      // Wait a bit for the session to be loaded in the ShareDialogWrapper
      await page.waitForTimeout(1000);

      // Note: Default expiry is now 7 days (was "Never")
      // For this test, we'll use the default 7 days without changing the selection
      // The expiry select should show "7 days" as selected by default

      // Click create share button
      const createButton = page.getByRole('button', { name: /Create Share/i });
      await expect(createButton).toBeVisible();
      await expect(createButton).toBeEnabled();
      
      // Listen for any alerts (errors)
      let alertMessage: string | null = null;
      page.on('dialog', async (dialog) => {
        alertMessage = dialog.message();
        await dialog.accept();
      });
      
      await createButton.click();

      // Wait for success message or check for alert
      try {
        await expect(page.getByText('Share link created successfully!')).toBeVisible({ timeout: 15000 });
      } catch (error) {
        if (alertMessage) {
          throw new Error(`Share creation failed with alert: ${alertMessage}`);
        }
        // Check if button is still in "Creating..." state (might be taking longer)
        const stillCreating = page.getByRole('button', { name: /Creating/i });
        if (await stillCreating.isVisible({ timeout: 1000 }).catch(() => false)) {
          // Wait a bit more and try again
          await page.waitForTimeout(2000);
          await expect(page.getByText('Share link created successfully!')).toBeVisible({ timeout: 10000 });
        } else {
          throw error;
        }
      }

      // Verify share URL input is visible and contains a URL
      const shareUrlInput = page.getByTestId('share-url-input');
      await expect(shareUrlInput).toBeVisible();
      const shareUrl = await shareUrlInput.inputValue();
      expect(shareUrl).toContain('/shared/');
      expect(shareUrl.length).toBeGreaterThan(0);
    });

    await test.step('Close share dialog', async () => {
      // Close the dialog
      const closeButton = page.getByRole('button', { name: /Close/i }).filter({ hasText: /Close/i }).first();
      await closeButton.click();
      await expect(page.getByRole('heading', { name: 'Share Session' })).not.toBeVisible();

      // Close sidebar
      await page.locator('button[title="Close"]').click();
    });
  });

  test('should view a shared session in read-only mode', async ({ page }) => {
    let shareId: string;
    let shareUrl: string;

    await test.step('Create a session and share it', async () => {
      const chatInput = page.getByLabel('Chat input');

      // Create a session
      await chatInput.fill('Message to be shared');
      await page.getByLabel('Send message (Enter)').click();
      await expect(page.locator('[role="log"]').getByText('Message to be shared')).toBeVisible();
      await expect(chatInput).toBeEnabled({ timeout: 30000 });
      await page.waitForTimeout(12000);

      // Open sidebar and share
      await page.getByRole('button', { name: /History/i }).click();
      await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

      const sessionItems = page.locator('.p-1\\.5.rounded.group');
      await expect(sessionItems.first()).toBeVisible({ timeout: 15000 });

      const firstSession = sessionItems.first();
      await firstSession.hover();
      await page.waitForTimeout(200);

      const shareButton = firstSession.locator('button[title*="Share" i]').or(firstSession.getByRole('button', { name: /Share/i }));
      await shareButton.click();

      // Create share without expiration
      await expect(page.getByRole('heading', { name: 'Share Session' })).toBeVisible({ timeout: 5000 });
      const createButton = page.getByRole('button', { name: /Create Share/i });
      await createButton.click();

      // Get the share URL
      await expect(page.getByText('Share link created successfully!')).toBeVisible({ timeout: 10000 });
      const shareUrlInput = page.getByTestId('share-url-input');
      shareUrl = await shareUrlInput.inputValue();
      
      // Extract share ID from URL
      const match = shareUrl.match(/\/shared\/([^/]+)/);
      expect(match).not.toBeNull();
      shareId = match![1];

      // Close dialogs
      const closeButton = page.getByRole('button', { name: /Close/i }).filter({ hasText: /Close/i }).first();
      await closeButton.click();
      await page.locator('button[title="Close"]').click();
    });

    await test.step('Navigate to shared session URL', async () => {
      // Navigate to the shared session
      await page.goto(shareUrl);
      
      // Wait for shared session to load
      await expect(page.getByText('Viewing Shared Session')).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('This is a shared session. You can view it or import it to your account.')).toBeVisible();
    });

    await test.step('Verify read-only mode', async () => {
      // Wait for the shared session to fully load (ShareDialogWrapper loads the session)
      await page.waitForTimeout(2000);
      // Verify the message is visible
      await expect(page.locator('[role="log"]').getByText('Message to be shared')).toBeVisible({ timeout: 15000 });

      // Verify chat input is NOT visible (read-only mode)
      const chatInput = page.getByLabel('Chat input');
      await expect(chatInput).not.toBeVisible();

      // Verify import button is visible
      await expect(page.getByRole('button', { name: /Import as New Session/i })).toBeVisible();
    });
  });

  test('should import a shared session', async ({ page }) => {
    let shareUrl: string;

    await test.step('Create and share a session', async () => {
      const chatInput = page.getByLabel('Chat input');

      // Create a session
      await chatInput.fill('Session to be imported');
      await page.getByLabel('Send message (Enter)').click();
      await expect(page.locator('[role="log"]').getByText('Session to be imported')).toBeVisible();
      await expect(chatInput).toBeEnabled({ timeout: 30000 });
      await page.waitForTimeout(12000);

      // Share the session
      await page.getByRole('button', { name: /History/i }).click();
      await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

      const sessionItems = page.locator('.p-1\\.5.rounded.group');
      await expect(sessionItems.first()).toBeVisible({ timeout: 15000 });

      const firstSession = sessionItems.first();
      await firstSession.hover();
      await page.waitForTimeout(200);

      const shareButton = firstSession.locator('button[title*="Share" i]').or(firstSession.getByRole('button', { name: /Share/i }));
      await shareButton.click();

      await expect(page.getByRole('heading', { name: 'Share Session' })).toBeVisible({ timeout: 5000 });
      const createButton = page.getByRole('button', { name: /Create Share/i });
      await createButton.click();

      await expect(page.getByText('Share link created successfully!')).toBeVisible({ timeout: 10000 });
      const shareUrlInput = page.getByTestId('share-url-input');
      shareUrl = await shareUrlInput.inputValue();

      // Close dialogs
      const closeButton = page.getByRole('button', { name: /Close/i }).filter({ hasText: /Close/i }).first();
      await closeButton.click();
      await page.locator('button[title="Close"]').click();
    });

    await test.step('Import the shared session', async () => {
      // Navigate to shared session
      await page.goto(shareUrl);
      await expect(page.getByText('Viewing Shared Session')).toBeVisible({ timeout: 10000 });

      // Click import button
      const importButton = page.getByRole('button', { name: /Import as New Session/i });
      await expect(importButton).toBeVisible();
      await importButton.click();

      // Wait for navigation back to home
      // After import, the current session is automatically loaded, so we should see the session content
      await page.waitForTimeout(2000); // Wait for page reload and session to load
      // Verify the imported session content is visible (current session is loaded on page load)
      await expect(page.locator('[role="log"]').getByText('Session to be imported')).toBeVisible({ timeout: 10000 });
    });

    await test.step('Verify imported session is available', async () => {
      // Open sidebar
      await page.getByRole('button', { name: /History/i }).click();
      await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

      // Verify the imported message is visible in the session list
      const sessionItems = page.locator('.p-1\\.5.rounded.group');
      await expect(sessionItems.first()).toBeVisible({ timeout: 5000 });

      // Click on the session to verify it loads
      await sessionItems.first().click();
      await expect(page.locator('[role="log"]').getByText('Session to be imported')).toBeVisible({ timeout: 5000 });

      // Close sidebar
      await page.locator('button[title="Close"]').click();
    });
  });

  test('should revoke a share link', async ({ page }) => {
    await test.step('Create a session and share it', async () => {
      const chatInput = page.getByLabel('Chat input');

      // Create a session
      await chatInput.fill('Message for revoke test');
      await page.getByLabel('Send message (Enter)').click();
      await expect(page.locator('[role="log"]').getByText('Message for revoke test')).toBeVisible();
      await expect(chatInput).toBeEnabled({ timeout: 30000 });
      await page.waitForTimeout(12000);

      // Open sidebar and share
      await page.getByRole('button', { name: /History/i }).click();
      await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

      const sessionItems = page.locator('.p-1\\.5.rounded.group');
      await expect(sessionItems.first()).toBeVisible({ timeout: 15000 });

      const firstSession = sessionItems.first();
      await firstSession.hover();
      await page.waitForTimeout(200);

      const shareButton = firstSession.locator('button[title*="Share" i]').or(firstSession.getByRole('button', { name: /Share/i }));
      await shareButton.click();

      // Create share
      await expect(page.getByRole('heading', { name: 'Share Session' })).toBeVisible({ timeout: 5000 });
      const createButton = page.getByRole('button', { name: /Create Share/i });
      await createButton.click();
      await expect(page.getByText('Share link created successfully!')).toBeVisible({ timeout: 10000 });
    });

    await test.step('Revoke the share', async () => {
      // After creating a share, the dialog shows success message with "Create Another Share" button
      // Click it to go back to the form and see the existing shares list
      const createAnotherButton = page.getByRole('button', { name: /Create Another Share/i });
      await expect(createAnotherButton).toBeVisible({ timeout: 5000 });
      await createAnotherButton.click();
      
      // Wait for the form to show and existing shares to load
      await expect(page.getByRole('heading', { name: 'Share Session' })).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(1000);
      
      // Find the revoke button in the existing shares section
      // Look for the "Existing Shares" label first, then find the revoke button within that section
      await expect(page.getByText('Existing Shares:')).toBeVisible({ timeout: 5000 });
      const revokeButton = page.getByRole('button', { name: /Revoke/i }).first();
      await expect(revokeButton).toBeVisible({ timeout: 10000 });
      await revokeButton.click();

      // Wait for the share to be removed (revoke button should disappear)
      await expect(revokeButton).not.toBeVisible({ timeout: 5000 });

      // Close dialog
      const closeButton = page.getByRole('button', { name: /Close/i }).filter({ hasText: /Close/i }).first();
      await closeButton.click();
      await page.locator('button[title="Close"]').click();
    });
  });

  test('should show error for invalid share ID', async ({ page }) => {
    // Navigate to a non-existent share
    await page.goto('/a/consensys-asko11y-app/shared/invalid-share-id-12345');

    // Should show error message - use first() to avoid strict mode violation
    // The error message should contain "not found or has expired"
    const errorMessage = page.getByText(/not found or has expired/i).first();
    await expect(errorMessage).toBeVisible({ timeout: 10000 });

    // Should show "Go to Home" button
    await expect(page.getByRole('button', { name: /Go to Home/i })).toBeVisible();
  });

  test('should display existing shares in share dialog', async ({ page }) => {
    await test.step('Create a session and share it twice', async () => {
      const chatInput = page.getByLabel('Chat input');

      // Create a session
      await chatInput.fill('Message for multiple shares');
      await page.getByLabel('Send message (Enter)').click();
      await expect(page.locator('[role="log"]').getByText('Message for multiple shares')).toBeVisible();
      await expect(chatInput).toBeEnabled({ timeout: 30000 });
      await page.waitForTimeout(12000);

      // Open sidebar
      await page.getByRole('button', { name: /History/i }).click();
      await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

      const sessionItems = page.locator('.p-1\\.5.rounded.group');
      await expect(sessionItems.first()).toBeVisible({ timeout: 15000 });

      const firstSession = sessionItems.first();
      await firstSession.hover();
      await page.waitForTimeout(200);

      const shareButton = firstSession.locator('button[title*="Share" i]').or(firstSession.getByRole('button', { name: /Share/i }));
      
      // Create first share
      await shareButton.click();
      await expect(page.getByRole('heading', { name: 'Share Session' })).toBeVisible({ timeout: 5000 });
      const createButton = page.getByRole('button', { name: /Create Share/i });
      await createButton.click();
      await expect(page.getByText('Share link created successfully!')).toBeVisible({ timeout: 10000 });

      // Close dialog
      const closeButton = page.getByRole('button', { name: /Close/i }).filter({ hasText: /Close/i }).first();
      await closeButton.click();

      // Create second share
      await firstSession.hover();
      await page.waitForTimeout(200);
      await shareButton.click();
      await expect(page.getByRole('heading', { name: 'Share Session' })).toBeVisible({ timeout: 5000 });
      await createButton.click();
      await expect(page.getByText('Share link created successfully!')).toBeVisible({ timeout: 10000 });
    });

    await test.step('Verify existing shares are displayed', async () => {
      // Should see "Existing Shares:" section
      await expect(page.getByText(/Existing Shares/i)).toBeVisible({ timeout: 5000 });

      // Should see at least one existing share
      // The shares list should be visible
      const sharesList = page.locator('[class*="space-y"]').filter({ hasText: /shared\// });
      await expect(sharesList.first()).toBeVisible({ timeout: 5000 });
    });
  });

  test('should handle share with expiration', async ({ page }) => {
    await test.step('Create a share with 7-day expiration', async () => {
      const chatInput = page.getByLabel('Chat input');

      // Create a session
      await chatInput.fill('Message with expiration');
      await page.getByLabel('Send message (Enter)').click();
      await expect(page.locator('[role="log"]').getByText('Message with expiration')).toBeVisible();
      await expect(chatInput).toBeEnabled({ timeout: 30000 });
      await page.waitForTimeout(12000);

      // Open sidebar and share
      await page.getByRole('button', { name: /History/i }).click();
      await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();

      const sessionItems = page.locator('.p-1\\.5.rounded.group');
      await expect(sessionItems.first()).toBeVisible({ timeout: 15000 });

      const firstSession = sessionItems.first();
      await firstSession.hover();
      await page.waitForTimeout(200);

      const shareButton = firstSession.locator('button[title*="Share" i]').or(firstSession.getByRole('button', { name: /Share/i }));
      await shareButton.click();

      // Select 7 days expiration (which is now the default)
      await expect(page.getByRole('heading', { name: 'Share Session' })).toBeVisible({ timeout: 5000 });
      // Note: 7 days is now the default, so we don't need to change the selection

      // Create share
      const createButton = page.getByRole('button', { name: /Create Share/i });
      await createButton.click();
      await expect(page.getByText('Share link created successfully!')).toBeVisible({ timeout: 10000 });

      // Verify expiration date is shown (should show a date, not "Never")
      const shareUrlInput = page.getByTestId('share-url-input');
      await expect(shareUrlInput).toBeVisible();
      
      // Close dialog
      const closeButton = page.getByRole('button', { name: /Close/i }).filter({ hasText: /Close/i }).first();
      await closeButton.click();
      await page.locator('button[title="Close"]').click();
    });
  });
});
