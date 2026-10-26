import { test, expect } from '@playwright/test';
import {
  authenticateForTests,
  setupProjectWithFixture,
  clickAddFeature,
  fillAddFeatureDialog,
} from '../utils';

test('uses the chosen interface language for native task enhancement and remembers it after reload', async ({
  page,
}) => {
  await setupProjectWithFixture(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem('automaker-ui-locale'))
      localStorage.setItem('automaker-ui-locale', 'en');
  });
  await page.route('**/api/settings/global', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: { ...body, settings: { ...body.settings, setupComplete: true, isFirstRun: false } },
    });
  });
  expect(await authenticateForTests(page)).toBe(true);
  for (const [locale, label, enhanceSection, enhanceButton] of [
    ['ru', 'Русский', 'Улучшение с помощью ИИ', 'Улучшение'],
    ['en', 'English', 'Enhance with AI', 'Enhance'],
  ]) {
    await page.goto('/settings?view=appearance');
    await expect(page.getByTestId('settings-view')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.getByRole('combobox', { name: /Interface language|Язык интерфейса/ }).click();
    await page.getByRole('option', { name: label, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);

    await page.goto('/board');
    await expect(page.getByTestId('board-view')).toBeVisible();
    await clickAddFeature(page);
    await fillAddFeatureDialog(page, 'Implement getUser() in src/user.ts');
    const dialog = page.getByTestId('add-feature-dialog');
    await dialog.getByRole('button', { name: enhanceSection, exact: true }).click();
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/enhance-prompt') && response.request().method() === 'POST'
    );
    await dialog.getByRole('button', { name: enhanceButton, exact: true }).click();
    const response = await responsePromise;
    expect(response.request().postDataJSON()).toMatchObject({
      outputLocale: locale,
      originalText: 'Implement getUser() in src/user.ts',
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      enhancedText: 'Mock agent output for testing.',
    });
    await expect(dialog.locator('textarea').first()).toHaveValue('Mock agent output for testing.');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  }
});
