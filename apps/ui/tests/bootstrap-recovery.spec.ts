import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('automaker-disable-splash', 'true');
  });
});

for (const pathname of ['/src/renderer.tsx', '/src/store/setup-store.ts']) {
  test(`shows a recoverable startup error after ${pathname} fails and reloads only on request`, async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem('automaker-ui-locale', 'en'));
    let failing = true;
    let requests = 0;
    await page.route(
      (url) => url.pathname === pathname,
      async (route) => {
        requests++;
        if (failing) await route.abort('internetdisconnected');
        else await route.continue();
      }
    );
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Unable to load Automaker');
    await expect(page.locator('.app-shell-spinner')).toBeHidden();
    expect(requests).toBe(1);
    // Seed once, not in addInitScript: otherwise reload could hide storage deletion.
    await page.evaluate(() => localStorage.setItem('bootstrap-recovery-fixture', 'preserved'));
    expect(await page.evaluate(() => localStorage.getItem('bootstrap-recovery-fixture'))).toBe(
      'preserved'
    );
    failing = false;
    await alert.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect(page.locator('#app > .app-shell')).toHaveCount(0);
    await expect(page.getByTestId('app-container')).toBeVisible();
    expect(requests).toBe(2);
    expect(await page.evaluate(() => localStorage.getItem('bootstrap-recovery-fixture'))).toBe(
      'preserved'
    );
  });
}

test('localizes the startup error without loading application modules or reflecting the failed URL', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('automaker-ui-locale', 'ru'));
  await page.route(
    (url) => url.pathname === '/src/renderer.tsx',
    (route) => route.abort('failed')
  );
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Не удалось загрузить Automaker');
  await expect(alert.getByRole('button', { name: 'Перезагрузить', exact: true })).toBeVisible();
  await expect(alert).not.toContainText('/src/renderer.tsx');
});

test('does not replace a healthy application when an optional image fails', async ({ page }) => {
  await page.route(
    (url) => url.pathname === '/logo.png',
    (route) => route.abort('failed')
  );
  await page.goto('/');
  await expect(page.locator('#app > .app-shell')).toHaveCount(0);
  await expect(page.getByTestId('app-container')).toBeVisible();
  await expect(page.getByText('Unable to load Automaker', { exact: true })).toHaveCount(0);
});
