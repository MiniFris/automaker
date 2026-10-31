import { test, expect } from '@playwright/test';
import { DEFAULT_FEATURE_TEMPLATES } from '@automaker/types';
import { authenticateForTests, setupProjectWithFixture } from '../utils';

test('localizes built-in template menus, settings and created task descriptions in the chosen interface language', async ({
  page,
}) => {
  await setupProjectWithFixture(page);
  await page.addInitScript((templates) => {
    if (!localStorage.getItem('automaker-ui-locale'))
      localStorage.setItem('automaker-ui-locale', 'en');
    const cached = JSON.parse(localStorage.getItem('automaker-settings-cache') || '{}');
    localStorage.setItem(
      'automaker-settings-cache',
      JSON.stringify({ ...cached, featureTemplates: templates })
    );
  }, DEFAULT_FEATURE_TEMPLATES);
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
          setupComplete: true,
          isFirstRun: false,
          featureTemplates: DEFAULT_FEATURE_TEMPLATES,
        },
      },
    });
  });
  // Creation uses the real backend; this test does not start an agent on the fixture project.
  await page.route('**/api/auto-mode/run-feature', (route) =>
    route.fulfill({ json: { success: true } })
  );
  expect(await authenticateForTests(page)).toBe(true);
  const names = [
    'Запустить тесты, линтер и форматирование',
    'Написать тесты для текущих изменений',
    'Проверить и описать недавние изменения',
    'Исправить ошибки линтера',
    'Обновить и проверить зависимости',
    'Провести ревью кода и исправить проблемы',
  ];
  for (const [locale, label] of [
    ['ru', 'Русский'],
    ['en', 'English'],
  ] as const) {
    await page.goto('/settings?view=appearance');
    await page.waitForLoadState('networkidle');
    await page.getByRole('combobox', { name: /Interface language|Язык интерфейса/ }).click();
    await page.getByRole('option', { name: label, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await page.goto('/settings?view=templates');
    await expect(
      page.getByText(locale === 'ru' ? names[0] : DEFAULT_FEATURE_TEMPLATES[0].name, {
        exact: true,
      })
    ).toBeVisible();
    await page.goto('/board');
    await expect(page.getByTestId('board-view')).toBeVisible();
    await page.locator('[data-testid$="add-feature-dropdown-trigger"]').first().click();
    for (const [index, template] of DEFAULT_FEATURE_TEMPLATES.entries()) {
      await expect(page.getByTestId(`template-menu-item-${template.id}`)).toContainText(
        locale === 'ru' ? names[index] : template.name
      );
    }
    const creation = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/features/create') && response.request().method() === 'POST'
    );
    await page.getByTestId('template-menu-item-run-tests-lint-format').click();
    const response = await creation;
    expect(response.status()).toBe(200);
    const description = response.request().postDataJSON().feature.description;
    expect(description).toBe(
      locale === 'ru'
        ? 'Запусти все тесты и проверки линтера, отформатируй код проекта. Исправь обнаруженные проблемы. Перед завершением убедись, что код проходит все проверки качества.'
        : DEFAULT_FEATURE_TEMPLATES[0].prompt
    );
    const created = (await response.json()).feature;
    expect(created.description).toBe(description);
    expect(created.title).toBe(description.slice(0, 100));
  }
});
