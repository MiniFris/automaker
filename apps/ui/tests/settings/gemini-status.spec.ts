import { expect, test } from '@playwright/test';
import { authenticateForTests } from '../utils';

test('stores and deletes a confirmed Google key without claiming verification or exposing it after reload', async ({
  page,
}) => {
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
        settings: { ...body.settings, setupComplete, isFirstRun: !setupComplete, uiLocale: 'en' },
      },
    });
  });
  const openGemini = async () => {
    await page.getByTestId('setup-start-button').click();
    await page.getByTestId('theme-continue-button').click();
    await page.getByRole('tab', { name: /Gemini/ }).click();
  };
  await page.goto('/setup');
  await openGemini();
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByText('Authentication not checked', { exact: true })).toBeVisible();
  const apiKey = 'opaque-google-browser-fixture-123456';
  const input = page.getByLabel('Gemini API key', { exact: true });
  await input.fill(apiKey);
  const save = panel.getByRole('button', { name: 'Save API Key', exact: true });
  const writes: unknown[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/setup/store-api-key'))
      writes.push(request.postDataJSON());
  });
  let message = '';
  page.once('dialog', async (dialog) => {
    message = dialog.message();
    await dialog.dismiss();
  });
  const preview = page.waitForResponse((response) =>
    response.url().includes('/api/setup/credential-target?provider=google')
  );
  await save.click();
  const target = (await (await preview).json()).target;
  await expect(save).toBeEnabled();
  expect(writes).toEqual([]);
  expect(message).not.toContain(apiKey);
  for (const value of [
    target.instanceId,
    target.workingDirectory,
    target.credentialsPath,
    'google',
  ])
    expect(message).toContain(value);
  page.once('dialog', (dialog) => dialog.accept());
  await save.click();
  const remove = page.getByRole('button', { name: 'Delete API key', exact: true });
  await expect(remove).toBeVisible();
  await expect(input).toHaveValue('');
  expect(writes).toEqual([{ confirmed: true, target, apiKey }]);
  await expect(panel.getByText('Authenticated', { exact: true })).not.toBeVisible();
  expect((await (await page.request.get('/api/setup/api-keys')).json()).hasGoogleKey).toBe(true);
  await page.reload();
  await openGemini();
  await expect(input).toHaveValue('');
  await expect(remove).toBeVisible();
  await expect(panel.getByText('Authentication not checked', { exact: true })).toBeVisible();
  setupComplete = true;
  await page.goto('/settings?view=gemini-provider');
  await expect(input).toHaveValue('');
  await expect(remove).toBeVisible();
  await expect(page.getByText('Authentication not checked', { exact: true })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  const deleted = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/setup/delete-api-key') && response.request().method() === 'POST'
  );
  await remove.click();
  expect((await deleted).status()).toBe(200);
  await expect(remove).not.toBeVisible();
  expect((await (await page.request.get('/api/setup/api-keys')).json()).hasGoogleKey).toBe(false);
});
