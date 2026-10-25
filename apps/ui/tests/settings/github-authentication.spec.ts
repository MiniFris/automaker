import { expect, test } from '@playwright/test';
import { authenticateForTests } from '../utils';

test('does not check GitHub authentication on mount/refresh and requires explicit target consent', async ({
  page,
}) => {
  await authenticateForTests(page);
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
  const checks: unknown[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/setup/verify-github-auth') && request.method() === 'POST')
      checks.push(request.postDataJSON());
  });
  await page.goto('/setup');
  await page.getByTestId('setup-start-button').click();
  await page.getByTestId('theme-continue-button').click();
  await page.getByTestId('providers-next-button').click();
  const button = page.getByTestId('verify-github-auth-button');
  await expect(button).toBeVisible();
  await expect(page.getByText('Authentication not checked', { exact: true }).first()).toBeVisible();
  expect(checks).toEqual([]);
  const refresh = page.waitForResponse((response) =>
    response.url().endsWith('/api/setup/gh-status')
  );
  await page.getByTestId('refresh-github-status').click();
  await refresh;
  await expect(button).toBeEnabled();
  expect(checks).toEqual([]);
  let message = '';
  page.once('dialog', async (dialog) => {
    message = dialog.message();
    await dialog.dismiss();
  });
  const preview = page.waitForResponse((response) =>
    response.url().endsWith('/api/setup/github-authentication-target')
  );
  await button.click();
  const target = (await (await preview).json()).target;
  await expect(button).toBeEnabled();
  expect(checks).toEqual([]);
  for (const text of [target.hostname, target.cliPath, target.workingDirectory, target.instanceId])
    expect(message).toContain(text);
  page.once('dialog', (dialog) => dialog.accept());
  const verified = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/setup/verify-github-auth') &&
      response.request().method() === 'POST'
  );
  await button.click();
  const response = await verified;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    authenticationChecked: true,
    authenticated: true,
    user: 'test-fixture',
    target,
  });
  expect(checks).toEqual([{ confirmed: true, target }]);
  await expect(page.getByText('GitHub CLI is ready!', { exact: true })).toBeVisible();
  const refreshed = page.waitForResponse((response) =>
    response.url().endsWith('/api/setup/gh-status')
  );
  await page.getByTestId('refresh-github-status').click();
  await refreshed;
  await expect(page.getByText('Authentication not checked', { exact: true }).first()).toBeVisible();
  expect(checks).toHaveLength(1);
});
