import { expect, test } from '@playwright/test';
import { authenticateForTests } from '../utils';

test('requires explicit native consent to import a browser key and leaves its backup intact', async ({
  page,
}) => {
  await authenticateForTests(page);
  const preview = await page.request.get('/api/setup/credential-target?provider=openai');
  const target = (await preview.json()).target;
  expect(
    (
      await page.request.post('/api/setup/delete-api-key', { data: { confirmed: true, target } })
    ).status()
  ).toBe(200);
  const apiKey = 'sk-legacy-browser-import-fixture-123456';
  const backup = JSON.stringify({ state: { apiKeys: { openai: apiKey } } });
  await page.addInitScript((value) => localStorage.setItem('automaker-storage', value), backup);
  await page.route('**/api/settings/global', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: {
        ...body,
        settings: { ...body.settings, setupComplete: true, isFirstRun: false, uiLocale: 'en' },
      },
    });
  });
  const bulk: string[] = [],
    writes: unknown[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().endsWith('/api/settings/credentials'))
      bulk.push(request.url());
    if (request.method() === 'POST' && request.url().endsWith('/api/setup/store-api-key'))
      writes.push(request.postDataJSON());
  });
  try {
    await page.goto('/settings?view=api-keys');
    const section = page.getByRole('region', { name: 'Legacy browser credential import' });
    await expect(section).toBeVisible();
    expect(writes).toEqual([]);
    expect(bulk).toEqual([]);
    expect((await (await page.request.get('/api/setup/api-keys')).json()).hasOpenaiKey).toBe(false);
    await section.getByRole('button', { name: 'Inspect legacy browser keys' }).click();
    const button = section.getByRole('button', { name: 'Import legacy openai key' });
    await expect(button).toBeVisible();
    expect(await page.locator('body').textContent()).not.toContain(apiKey);
    expect(writes).toEqual([]);
    let message = '';
    page.once('dialog', async (dialog) => {
      message = dialog.message();
      await dialog.dismiss();
    });
    await button.click();
    await expect(button).toBeEnabled();
    expect(message).not.toContain(apiKey);
    expect(message).toContain(target.instanceId);
    expect(writes).toEqual([]);
    page.once('dialog', (dialog) => dialog.accept());
    await button.click();
    await expect(
      section.getByText('Imported; authentication not checked', { exact: true })
    ).toBeVisible();
    expect(writes).toEqual([{ confirmed: true, target, apiKey }]);
    expect(bulk).toEqual([]);
    expect((await (await page.request.get('/api/setup/api-keys')).json()).hasOpenaiKey).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('automaker-storage'))).toBe(backup);
  } finally {
    await page.request.post('/api/setup/delete-api-key', { data: { confirmed: true, target } });
  }
});
