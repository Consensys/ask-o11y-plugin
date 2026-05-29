import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import pluginJson from '../src/plugin.json';

async function openSettingsTab(page: Page, tabId: string): Promise<void> {
  await page.locator(`[data-testid="data-testid ac-settings-tab-${tabId}"]`).click();
}

test.describe('Service Graph settings', () => {
  test('renders Graphiti topology inside plugin settings and sends graph limits', async ({ appConfigPage, page }) => {
    void appConfigPage;
    const topologyRequests: string[] = [];

    await page.route(`**/api/plugins/${pluginJson.id}/resources/api/agent/topology**`, async (route) => {
      topologyRequests.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          enabled: true,
          source: 'graphiti',
          nodes: [
            { id: 'checkout', label: 'checkout', type: 'service' },
            { id: 'payments', label: 'payments', type: 'service' },
            { id: 'ledger', label: 'ledger', type: 'service' },
          ],
          edges: [
            { id: 'checkout->payments', source: 'checkout', target: 'payments', label: 'calls' },
            { id: 'payments->ledger', source: 'payments', target: 'ledger', label: 'depends' },
          ],
          rawFactCount: 2,
        }),
      });
    });

    await openSettingsTab(page, 'service-graph');

    await expect(page.getByRole('group', { name: /service graph/i })).toBeVisible();
    await expect(page.locator('[data-testid="data-testid ac-service-graph-summary"]')).toContainText('3 services');
    await expect(page.locator('[data-testid="data-testid ac-service-graph-summary"]')).toContainText('2 links');
    await expect(page.getByTestId('service-graph-scene')).toBeVisible();
    await expect
      .poll(() => topologyRequests.some((url) => url.includes('maxNodes=100') && url.includes('maxEdges=200')))
      .toBe(true);

    await page.locator('[data-testid="data-testid ac-service-graph-max-nodes"]').fill('2');
    await page.locator('[data-testid="data-testid ac-service-graph-max-edges"]').fill('1');
    await page.locator('[data-testid="data-testid ac-refresh-service-graph"]').click();

    await expect
      .poll(() => topologyRequests.some((url) => url.includes('maxNodes=2') && url.includes('maxEdges=1')))
      .toBe(true);
  });

  test('does not expose a standalone service graph route', async ({ gotoPage, page }) => {
    await gotoPage('/topology');

    await expect(page.getByRole('heading', { name: 'Ask O11y Assistant' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Service Graph' })).not.toBeVisible();
  });
});
