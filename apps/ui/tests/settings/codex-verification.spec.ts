import { expect, test } from '@playwright/test';
import { authenticateForTests } from '../utils';

test('requires Codex query consent and verifies an unsaved key without storing it', async ({
  page,
}) => {
  await authenticateForTests(page);
  await page.goto('/settings?view=api-keys');
  const key = 'sk-unsaved-offline-browser-fixture-123456';
  const queries: unknown[] = [];
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'POST') return;
    if (request.url().endsWith('/api/setup/verify-codex-auth'))
      queries.push(request.postDataJSON());
    if (
      request.url().endsWith('/api/setup/store-api-key') ||
      request.url().endsWith('/api/settings/credentials')
    )
      writes.push(request.url());
  });
  await page.getByTestId('openai-api-key-input').fill(key);
  const button = page.getByTestId('test-openai-connection');
  let message = '';
  page.once('dialog', async (dialog) => {
    message = dialog.message();
    await dialog.dismiss();
  });
  const preview = page.waitForResponse((response) =>
    response.url().includes('/api/setup/codex-verification-target?authMethod=api_key')
  );
  await button.click();
  const target = (await (await preview).json()).target;
  await expect(button).toBeEnabled();
  expect(queries).toEqual([]);
  for (const value of [target.endpoint, target.model, target.workingDirectory, target.instanceId])
    expect(message).toContain(value);
  expect(message).not.toContain(key);
  page.once('dialog', (dialog) => dialog.accept());
  const completed = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/setup/verify-codex-auth') &&
      response.request().method() === 'POST'
  );
  await button.click();
  const response = await completed;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    authenticated: true,
    verification: 'verified',
    target,
    authType: 'api_key',
  });
  await expect(page.getByTestId('openai-test-connection-result')).toBeVisible();
  expect(queries).toEqual([{ confirmed: true, target, apiKey: key }]);
  expect(writes).toEqual([]);
  // The E2E verification runtime is explicitly offline, not a real model query.
});
