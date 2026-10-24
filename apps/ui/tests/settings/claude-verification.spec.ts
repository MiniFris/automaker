import { expect, test } from '@playwright/test';
import { authenticateForTests } from '../utils';

test('never verifies Claude on setup and requires consent for the host verification query', async ({
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
  const queries: unknown[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/setup/verify-claude-auth'))
      queries.push(request.postDataJSON());
  });
  await page.goto('/setup');
  await page.getByTestId('setup-start-button').click();
  await page.getByTestId('theme-continue-button').click();
  const button = page.getByRole('button', { name: 'Verify Claude connection', exact: true });
  await expect(button).toBeVisible();
  expect(queries).toEqual([]);
  let message = '';
  page.once('dialog', async (dialog) => {
    message = dialog.message();
    await dialog.dismiss();
  });
  const preview = page.waitForResponse((response) =>
    response.url().includes('/api/setup/claude-verification-target?authMethod=cli')
  );
  await button.click();
  const target = (await (await preview).json()).target;
  await expect(button).toBeEnabled();
  for (const value of [
    target.endpoint,
    target.model,
    target.workingDirectory,
    target.instanceId,
    'charges',
  ])
    expect(message).toContain(value);
  expect(queries).toEqual([]);
  page.once('dialog', (dialog) => dialog.accept());
  const completed = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/setup/verify-claude-auth') &&
      response.request().method() === 'POST'
  );
  await button.click();
  const response = await completed;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    success: true,
    target,
    authenticated: true,
    verification: 'verified',
    authType: 'cli',
  });
  expect(queries).toEqual([{ confirmed: true, target }]);
  // This explicit E2E composition substitutes an offline probe; no upstream charges.
  expect(target.endpoint).toBe('https://claude-verification.fixture.invalid/');
});
