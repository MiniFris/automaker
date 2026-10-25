import { expect, test } from '@playwright/test';
import { authenticateForTests } from '../utils';

test('cancels, stores and deletes an application key through confirmed native targets', async ({
  page,
}) => {
  // Cold auth may visit the UI; both server rendering hints and synchronous
  // local settings must already describe this test's wizard state at that point.
  await page.addInitScript(() => {
    localStorage.removeItem('automaker-settings-cache');
    localStorage.removeItem('automaker-setup');
  });
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
  // Only passive installation/auth hints are overridden for rendering the input.
  // Target, credential writer and persistence run on the real Nest backend.
  await page.route('**/api/setup/claude-status', (route) =>
    route.fulfill({
      json: {
        success: true,
        installed: true,
        status: 'installed',
        method: 'path',
        version: 'fixture',
        path: '/fixture/claude',
        auth: { authenticated: false, method: 'none' },
      },
    })
  );
  expect(await authenticateForTests(page)).toBe(true);
  const writes: unknown[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/setup/store-api-key') && request.method() === 'POST')
      writes.push(request.postDataJSON());
  });
  await page.goto('/setup');
  await page.getByTestId('setup-start-button').click();
  await page.getByTestId('theme-continue-button').click();
  await page.getByRole('tab', { name: 'Claude', exact: true }).click();
  await page.getByRole('button', { name: 'Use Anthropic API Key instead', exact: true }).click();
  const apiKey = 'sk-ant-native-browser-fixture-123456';
  await page.getByLabel('Anthropic API Key', { exact: true }).fill(apiKey);
  const save = page.getByRole('button', { name: 'Save API Key', exact: true });
  let message = '';
  page.once('dialog', async (dialog) => {
    message = dialog.message();
    await dialog.dismiss();
  });
  const preview = page.waitForResponse((response) =>
    response.url().includes('/api/setup/credential-target?provider=anthropic')
  );
  await save.click();
  const target = (await (await preview).json()).target;
  await expect(save).toBeEnabled();
  expect(writes).toEqual([]);
  for (const text of [
    target.workingDirectory,
    target.credentialsPath,
    target.instanceId,
    target.provider,
  ])
    expect(message).toContain(text);
  expect(message).not.toContain(apiKey);
  page.once('dialog', (dialog) => dialog.accept());
  const stored = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/setup/store-api-key') && response.request().method() === 'POST'
  );
  await save.click();
  expect((await stored).status()).toBe(200);
  expect(writes).toEqual([{ confirmed: true, target, apiKey }]);
  setupComplete = true;
  await page.goto('/settings?view=api-keys');
  const remove = page.getByTestId('delete-anthropic-key');
  await expect(remove).toBeVisible();
  await expect(page.getByTestId('anthropic-api-key-input')).toHaveValue('');
  const testStored = page.getByTestId('test-claude-connection');
  await expect(testStored).toBeEnabled();
  page.once('dialog', (dialog) => dialog.accept());
  const checked = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/setup/verify-claude-auth') &&
      response.request().method() === 'POST'
  );
  await testStored.click();
  const checkedResponse = await checked;
  expect(checkedResponse.status()).toBe(200);
  expect(checkedResponse.request().postDataJSON()).not.toHaveProperty('apiKey');
  const replacement = 'sk-ant-native-settings-fixture-123456';
  await page.getByTestId('anthropic-api-key-input').fill(replacement);
  page.once('dialog', (dialog) => dialog.accept());
  const settingsStored = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/setup/store-api-key') && response.request().method() === 'POST'
  );
  await page.getByTestId('save-settings').click();
  expect((await settingsStored).status()).toBe(200);
  await expect(page.getByTestId('save-settings')).toContainText('Saved!');
  expect(writes).toEqual([
    { confirmed: true, target, apiKey },
    { confirmed: true, target, apiKey: replacement },
  ]);
  page.once('dialog', (dialog) => dialog.accept());
  const deleted = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/setup/delete-api-key') && response.request().method() === 'POST'
  );
  await remove.click();
  const response = await deleted;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ target, operation: 'delete', configured: false });
  expect((await (await page.request.get('/api/setup/api-keys')).json()).hasAnthropicKey).toBe(
    false
  );
});
