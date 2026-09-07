import { test, expect, clearPersistedSession } from './fixtures';
import { ROUTES } from '../src/constants';

const SKILLS_URL = /\/api\/plugins\/consensys-asko11y-app\/resources\/api\/skills/;

const bundledSkills = [
  {
    name: 'investigating-alerts',
    description: 'Investigates firing alerts and performs root cause analysis.',
    source: 'bundled',
    customized: false,
    enabled: true,
    hidden: false,
    hasUserPrompt: true,
    model: 'large',
    maxIterations: 60,
  },
  {
    name: 'querying-profiles',
    description: 'Analyzes continuous profiling data from Pyroscope.',
    source: 'bundled',
    customized: false,
    enabled: true,
    hidden: false,
    hasUserPrompt: false,
  },
  {
    name: 'analyzing-cloudwatch',
    description: 'Queries AWS CloudWatch metrics through Grafana.',
    source: 'bundled',
    customized: false,
    enabled: true,
    hidden: false,
    hasUserPrompt: false,
  },
];

test.describe('Skills in chat', () => {
  test.beforeEach(async ({ gotoPage, page }) => {
    await page.route(SKILLS_URL, (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ skills: bundledSkills }),
      })
    );
    await gotoPage(`/${ROUTES.Home}`);
    await clearPersistedSession(page);
  });

  test('offers skills as slash commands in the input', async ({ page }) => {
    const chatInput = page.getByLabel('Chat input');
    await expect(chatInput).toHaveAttribute(
      'placeholder',
      expect.stringContaining('type / to pick a skill')
    );

    // Typing / opens the command menu with the pickable skills.
    await chatInput.fill('/');
    const menu = page.locator('[data-testid="data-testid chat-skill-command-menu"]');
    await expect(menu).toBeVisible();
    await expect(page.locator('[data-testid="data-testid chat-skill-command-item-querying-profiles"]')).toBeVisible();
    await expect(page.locator('[data-testid="data-testid chat-skill-command-item-analyzing-cloudwatch"]')).toBeVisible();

    // Filtering narrows the menu; picking completes the command.
    await chatInput.fill('/analyz');
    await expect(page.locator('[data-testid="data-testid chat-skill-command-item-querying-profiles"]')).toBeHidden();
    await page.locator('[data-testid="data-testid chat-skill-command-item-analyzing-cloudwatch"]').click();
    await expect(chatInput).toHaveValue('/analyzing-cloudwatch ');
    await expect(page.locator('[data-testid="data-testid chat-active-skill-analyzing-cloudwatch"]')).toBeVisible();
  });

  test('quick suggestion with a bound skill pre-fills the slash command', async ({ page }) => {
    await page.getByText('Build a dashboard').click();

    const chatInput = page.getByLabel('Chat input');
    await expect(chatInput).toHaveValue(
      '/building-dashboards Help me build a dashboard for system performance metrics'
    );
  });

  test('assistant message shows skill chips from the run_started event', async ({ page }) => {
    // Mock the agent run: run_started carries the active skills.
    await page.route(
      /\/api\/plugins\/consensys-asko11y-app\/resources\/api\/agent\/runs\/[^/]+\/events/,
      (route) => {
        const body = [
          'data: {"type":"run_started","data":{"runId":"run-sk1","skills":[{"name":"investigating-alerts","description":"Investigates firing alerts."}]},"sequence":0}',
          'data: {"type":"content","data":{"content":"Investigated."},"sequence":1}',
          'data: {"type":"done","data":{"totalIterations":1},"sequence":2}',
          '',
        ].join('\n');
        return route.fulfill({ contentType: 'text/event-stream', body });
      }
    );
    await page.route(
      /\/api\/plugins\/consensys-asko11y-app\/resources\/api\/agent\/run$/,
      (route) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ runId: 'run-sk1', sessionId: 'sess-sk1', status: 'running', model: 'base' }),
        })
    );

    const chatInput = page.getByLabel('Chat input');
    await chatInput.fill('investigate HighErrorRate');
    await page.getByLabel('Send message (Enter)').click();

    const chip = page.locator('[data-testid="data-testid chat-skill-chip-investigating-alerts"]');
    await expect(chip).toBeVisible({ timeout: 15000 });
    await expect(chip).toContainText('investigating-alerts');
  });

  test('visualizes a skill the agent loads mid-run via load_skill', async ({ page }) => {
    await page.route(
      /\/api\/plugins\/consensys-asko11y-app\/resources\/api\/agent\/runs\/[^/]+\/events/,
      (route) => {
        const body = [
          'data: {"type":"run_started","data":{"runId":"run-sk2"},"sequence":0}',
          'data: {"type":"tool_call_start","data":{"id":"tc1","name":"load_skill","arguments":"{\\"skill\\":\\"writing-promql-and-logql\\"}"},"sequence":1}',
          'data: {"type":"tool_call_result","data":{"id":"tc1","name":"load_skill","content":"## PromQL\\nUse rate().","isError":false},"sequence":2}',
          'data: {"type":"content","data":{"content":"Here is the guide."},"sequence":3}',
          'data: {"type":"done","data":{"totalIterations":2},"sequence":4}',
          '',
        ].join('\n');
        return route.fulfill({ contentType: 'text/event-stream', body });
      }
    );
    await page.route(
      /\/api\/plugins\/consensys-asko11y-app\/resources\/api\/agent\/run$/,
      (route) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ runId: 'run-sk2', sessionId: 'sess-sk2', status: 'running', model: 'base' }),
        })
    );

    const chatInput = page.getByLabel('Chat input');
    await chatInput.fill('how do I write logql');
    await page.getByLabel('Send message (Enter)').click();

    // The self-loaded skill appears as a chip on the reply...
    const chip = page.locator('[data-testid="data-testid chat-skill-chip-writing-promql-and-logql"]');
    await expect(chip).toBeVisible({ timeout: 15000 });

    // ...and the tool execution entry shows the friendly skill name.
    await page.getByRole('button', { name: /Tool Execution/ }).click();
    await expect(page.locator('[data-testid="chat-load-skill-writing-promql-and-logql"]')).toBeVisible();
    await expect(page.locator('[data-testid="chat-load-skill-writing-promql-and-logql"]')).toContainText(
      'Skill: writing-promql-and-logql'
    );
  });
});

test.describe('Skills in AppConfig', () => {
  test('lists bundled skills with enable toggles and editors', async ({ appConfigPage, page }) => {
    void appConfigPage;
    await page.route(SKILLS_URL, (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          skills: bundledSkills.map((skill) => ({ ...skill, raw: `---\nname: ${skill.name}\n---\nbody` })),
        }),
      })
    );
    await page.locator('[data-testid="data-testid ac-settings-tab-skills"]').click();

    const section = page.locator('[data-testid="data-testid ac-skills-section"]');
    await expect(section).toBeVisible();
    await expect(section).toContainText('investigating-alerts');
    await expect(section).toContainText('Bundled');
    await expect(page.locator('[data-testid="data-testid ac-skill-card-querying-profiles"]')).toBeVisible();
    await expect(page.locator('[data-testid="data-testid ac-skill-toggle-analyzing-cloudwatch"]')).toBeVisible();
    await expect(page.locator('[data-testid="data-testid ac-skill-edit-investigating-alerts"]')).toBeVisible();
    await expect(page.locator('[data-testid="data-testid ac-skill-add"]')).toBeVisible();
  });
});
