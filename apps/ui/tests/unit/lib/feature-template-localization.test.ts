import { afterEach, expect, it } from 'vitest';
import { DEFAULT_FEATURE_TEMPLATES } from '@automaker/types';
import { getUiLocale, setUiLocale } from '@/lib/i18n';
import { localizeFeatureTemplate } from '@/lib/feature-template-localization';

const originalLocale = getUiLocale();
afterEach(() => setUiLocale(originalLocale));

it('localizes all six default names and prompts without changing stored fields or model preferences', () => {
  expect(DEFAULT_FEATURE_TEMPLATES).toHaveLength(6);
  for (const template of DEFAULT_FEATURE_TEMPLATES) {
    const stored = Object.freeze({
      ...template,
      model: { model: 'claude-sonnet' },
      enabled: false,
      order: 9,
    });
    setUiLocale('ru');
    const russian = localizeFeatureTemplate(stored);
    expect(russian.name).not.toBe(template.name);
    expect(russian.prompt).not.toBe(template.prompt);
    expect(russian.name).toMatch(/[А-Яа-я]/);
    expect(russian.prompt).toMatch(/[А-Яа-я]/);
    expect(russian).toMatchObject({
      id: template.id,
      model: stored.model,
      enabled: false,
      order: 9,
    });
    setUiLocale('en');
    expect(localizeFeatureTemplate(stored)).toEqual(stored);
  }
});

it('preserves each user-edited field even when its text matches another translated key', () => {
  setUiLocale('ru');
  const original = DEFAULT_FEATURE_TEMPLATES[0];
  const renamed = localizeFeatureTemplate({ ...original, name: 'Fix lint errors' });
  expect(renamed.name).toBe('Fix lint errors');
  expect(renamed.prompt).not.toBe(original.prompt);
  const edited = localizeFeatureTemplate({
    ...original,
    prompt: 'Custom src/app.ts getUser() instructions',
  });
  expect(edited.name).not.toBe(original.name);
  expect(edited.prompt).toBe('Custom src/app.ts getUser() instructions');
});

it('leaves custom and unknown templates unchanged, including matching names and reserved IDs', () => {
  setUiLocale('ru');
  const custom = { ...DEFAULT_FEATURE_TEMPLATES[0], isBuiltIn: false };
  const unknown = { ...DEFAULT_FEATURE_TEMPLATES[0], id: 'user-template' };
  expect(localizeFeatureTemplate(custom)).toBe(custom);
  expect(localizeFeatureTemplate(unknown)).toBe(unknown);
});
