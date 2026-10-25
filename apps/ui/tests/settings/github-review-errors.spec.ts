import { expect, test } from '@playwright/test';
import { authenticateForTests } from '../utils';

test('keeps the application session for a typed review permission denial without replaying a mutation', async ({
  page,
}) => {
  await authenticateForTests(page);
  let writes = 0,
    logouts = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/auth/logout')) logouts++;
  });
  await page.route('**/api/github/resolve-pr-comment', async (route) => {
    writes++;
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        errorCode: 'FORBIDDEN',
        error: 'Review thread does not belong to the project repository.',
      }),
    });
  });
  await page.goto('/settings');
  const result = await page.evaluate(async () => {
    const url = '/src/lib/http-api-client.ts';
    const { getHttpApiClient } = await import(/* @vite-ignore */ url);
    let loggedOut = false;
    window.addEventListener(
      'automaker:logged-out',
      () => {
        loggedOut = true;
      },
      { once: true }
    );
    let error = '';
    try {
      await getHttpApiClient().github.resolveReviewThread('/owned-fixture', 'PRRT_owned', true);
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    }
    const status = await fetch('/api/settings/status', { credentials: 'include' });
    return { error, loggedOut, status: status.status };
  });
  expect(result).toEqual({
    error: 'Review thread does not belong to the project repository.',
    loggedOut: false,
    status: 200,
  });
  expect(writes).toBe(1);
  expect(logouts).toBe(0);
});
