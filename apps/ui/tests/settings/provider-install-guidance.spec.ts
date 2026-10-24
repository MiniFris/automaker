import { expect, test } from '@playwright/test';
import { authenticateForTests } from '../utils';

test('shows native backend installation guidance without reporting installation', async ({
  page,
}) => {
  await authenticateForTests(page);
  // Make only browser-visible setup state deterministic; the instruction endpoint
  // still runs through the real Nest server. Never install a host CLI in this smoke.
  await page.route('**/api/settings/global', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: {
        ...body,
        settings: { ...body.settings, setupComplete: false, isFirstRun: true, uiLocale: 'en' },
      },
    });
  });
  await page.route('**/api/setup/claude-status', (route) =>
    route.fulfill({
      json: {
        success: true,
        installed: false,
        status: 'not_installed',
        method: 'none',
        path: null,
        version: null,
        auth: { authenticated: false, method: 'none' },
      },
    })
  );
  await page.goto('/setup');
  await page.getByTestId('setup-start-button').click();
  await page.getByTestId('theme-continue-button').click();
  const button = page.getByRole('button', { name: 'Show installation instructions' });
  await expect(button).toBeVisible();
  const completed = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/setup/install-claude') && response.request().method() === 'POST'
  );
  await button.click();
  const response = await completed;
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({
    success: false,
    requiresManualInstall: true,
    installationPerformed: false,
    target: { kind: 'host-application', provider: 'claude' },
  });
  await expect(page.getByText('$ No installer was run.', { exact: true })).toBeVisible();
  await expect(
    page.getByText(`Backend application: ${body.target.workingDirectory}`, { exact: false })
  ).toBeVisible();
  await expect(page.getByText(body.installCommand, { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Claude CLI not found', { exact: true })).toBeVisible();
  await expect(button).toBeEnabled();
  await expect(page.getByText('Claude CLI installed!', { exact: true })).not.toBeVisible();
});
