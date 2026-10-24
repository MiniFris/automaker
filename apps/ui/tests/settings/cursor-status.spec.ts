import { expect, test } from '@playwright/test';
import { authenticateForTests } from '../utils';

test('shows passive Cursor status on setup and settings without claiming account verification', async ({
  page,
}) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await authenticateForTests(page);
  let setupComplete = false;
  await page.route('**/api/settings/global', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: {
        ...body,
        settings: {
          ...body.settings,
          setupComplete,
          isFirstRun: !setupComplete,
          uiLocale: 'en',
        },
      },
    });
  });
  const authCommands: string[] = [];
  let statusReads = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'GET' &&
      new URL(request.url()).pathname === '/api/setup/cursor-status'
    )
      statusReads++;
    if (
      request.method() === 'POST' &&
      /\/(?:auth-cursor|verify-cursor-auth)$/.test(new URL(request.url()).pathname)
    )
      authCommands.push(request.url());
  });
  await page.goto('/setup');
  await page.getByTestId('setup-start-button').click();
  await page.getByTestId('theme-continue-button').click();
  await page.getByRole('tab', { name: /Cursor/ }).click();
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByText('Authentication not checked', { exact: true })).toBeVisible();
  await expect(panel.getByText('Authenticated', { exact: true })).not.toBeVisible();
  await expect(
    panel.getByRole('button', { name: 'Copy login command', exact: true })
  ).toBeVisible();
  const beforeCopy = statusReads;
  await page.clock.install();
  await panel.getByRole('button', { name: 'Copy login command', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('cursor-agent login');
  await page.clock.fastForward(5000);
  expect(statusReads).toBe(beforeCopy);
  await page.clock.resume();
  expect(authCommands).toEqual([]);
  setupComplete = true;
  await page.goto('/settings?view=cursor-provider');
  await expect(page.getByText('Authentication not checked', { exact: true })).toBeVisible();
  const refreshed = page.waitForResponse((response) =>
    response.url().endsWith('/api/setup/cursor-status')
  );
  await page.getByTestId('refresh-cursor-cli').click();
  const response = await refreshed;
  expect(await response.json()).toMatchObject({
    auth: {
      authenticated: false,
      authenticationChecked: false,
      scope: 'host',
      hasEnvApiKey: false,
      hasCredentialsFile: false,
    },
  });
  await expect(page.getByText('Authenticated', { exact: true })).not.toBeVisible();
  expect(authCommands).toEqual([]);
  await page.getByRole('button', { name: 'Disconnect from Automaker', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Disconnect provider?' })
    .getByRole('button', { name: /^Disconnect/ })
    .click();
  const reconnect = page.getByRole('button', { name: 'Reconnect to Automaker', exact: true });
  await expect(reconnect).toBeVisible();
  await expect(page.getByText('Authentication not checked', { exact: true })).toBeVisible();
  await reconnect.click();
  await page
    .getByRole('dialog', { name: 'Reconnect provider?' })
    .getByRole('button', { name: /^Reconnect/ })
    .click();
  await expect(
    page.getByRole('button', { name: 'Disconnect from Automaker', exact: true })
  ).toBeVisible();
  await expect(page.getByText('Authenticated', { exact: true })).not.toBeVisible();
  expect(authCommands).toHaveLength(1); // Explicit application reconnect, not a CLI login.
  expect(authCommands[0]).toMatch(/auth-cursor$/);
});
