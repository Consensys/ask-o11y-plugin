import { AppConfigPage, AppPage, test as base } from '@grafana/plugin-e2e';
import pluginJson from '../src/plugin.json';
import * as fs from 'fs';
import * as path from 'path';

type AppTestFixture = {
  appConfigPage: AppConfigPage;
  gotoPage: (path?: string) => Promise<AppPage>;
};

// Coverage output directory
const COVERAGE_DIR = path.join(process.cwd(), 'coverage-e2e', '.nyc_output');

// Ensure coverage directory exists
if (process.env.COVERAGE === 'true') {
  fs.mkdirSync(COVERAGE_DIR, { recursive: true });
}

export const test = base.extend<AppTestFixture>({
  appConfigPage: async ({ gotoAppConfigPage }, use) => {
    const configPage = await gotoAppConfigPage({
      pluginId: pluginJson.id,
    });
    await use(configPage);
  },
  gotoPage: async ({ gotoAppPage }, use) => {
    await use((path) =>
      gotoAppPage({
        path,
        pluginId: pluginJson.id,
      })
    );
  },

  // Auto-use fixture for coverage collection
  page: async ({ page }, use, testInfo) => {
    // Use the page as normal
    await use(page);

    // After test: collect coverage if enabled
    if (process.env.COVERAGE === 'true') {
      try {
        // Get Istanbul coverage from the browser's window object
        const coverage = await page.evaluate(() => {
          // Istanbul stores coverage in window.__coverage__
          return (window as unknown as { __coverage__?: Record<string, unknown> }).__coverage__;
        });

        if (coverage) {
          // Generate a unique filename for this test's coverage
          const sanitizedTitle = testInfo.title.replace(/[^a-zA-Z0-9]/g, '_');
          const coverageFile = path.join(COVERAGE_DIR, `coverage_${sanitizedTitle}_${Date.now()}.json`);
          fs.writeFileSync(coverageFile, JSON.stringify(coverage));
        }
      } catch {
        // Coverage collection failed, likely no instrumented code loaded
        // This is expected for some pages
      }
    }
  },
});

export { expect } from '@grafana/plugin-e2e';
