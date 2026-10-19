import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/locales/en.json';
import ru from '@/locales/ru.json';
import reviewed from '@/locales/ru-reviewed.json';

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('locale and persistence', () => {
  it('detects Russian and sets the document language before rendering', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ru-RU');
    const i18n = await import('@/lib/i18n');
    expect(i18n.getUiLocale()).toBe('ru');
    expect(document.documentElement.lang).toBe('ru');
    expect(i18n.translate('Settings')).toBe('Настройки');
    expect(i18n.getFormattingLocale()).toBe('ru-RU');
  });
  it('prefers a saved language and restores it on a fresh module load', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ru-RU');
    localStorage.setItem('automaker-ui-locale', 'en');
    let i18n = await import('@/lib/i18n');
    expect(i18n.getUiLocale()).toBe('en');
    i18n.setUiLocale('ru');
    expect(localStorage.getItem(i18n.UI_LOCALE_STORAGE_KEY)).toBe('ru');
    vi.resetModules();
    i18n = await import('@/lib/i18n');
    expect(i18n.getUiLocale()).toBe('ru');
  });
  it('falls back to English for unsupported browser languages and invalid stored values', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('fr-FR');
    localStorage.setItem('automaker-ui-locale', 'unsupported');
    const i18n = await import('@/lib/i18n');
    expect(i18n.getUiLocale()).toBe('en');
    expect(i18n.translate('Settings')).toBe('Settings');
    expect(i18n.getFormattingLocale()).toBe('en-US');
  });
  it('keeps working when local storage is disabled', async () => {
    vi.spyOn(window.Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(window.Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const i18n = await import('@/lib/i18n');
    expect(() => i18n.setUiLocale('ru')).not.toThrow();
    expect(i18n.getUiLocale()).toBe('ru');
  });
  it('observes language changes from another tab', async () => {
    const i18n = await import('@/lib/i18n');
    i18n.setUiLocale('en');
    localStorage.setItem(i18n.UI_LOCALE_STORAGE_KEY, 'ru');
    window.dispatchEvent(
      new window.StorageEvent('storage', { key: i18n.UI_LOCALE_STORAGE_KEY, newValue: 'ru' })
    );
    expect(i18n.getUiLocale()).toBe('ru');
    expect(document.documentElement.lang).toBe('ru');
  });
});

describe('translation contracts', () => {
  it('has a non-empty Russian translation for every English interface key', () => {
    const catalog: Record<string, string> = { ...ru, ...reviewed };
    const placeholders = (text: string) => [...text.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort();
    for (const key of Object.keys(en)) {
      expect(catalog[key]?.trim(), key).toBeTruthy();
      expect(placeholders(catalog[key]), key).toEqual(placeholders(key));
    }
  });
  it('uses English for unknown keys and never translates interpolation values', async () => {
    const i18n = await import('@/lib/i18n');
    i18n.setUiLocale('ru');
    expect(i18n.translate('Unknown server message')).toBe('Unknown server message');
    const input = 'Save <script> {value2}';
    expect(i18n.translate('Unknown {value1}', { value1: input, value2: 'wrong' })).toBe(
      `Unknown ${input}`
    );
    expect(i18n.translate('toString')).toBe('toString');
  });
  it.each([
    [0, '0 файлов'],
    [1, '1 файл'],
    [2, '2 файла'],
    [5, '5 файлов'],
    [11, '11 файлов'],
    [14, '14 файлов'],
    [21, '21 файл'],
    [22, '22 файла'],
    [101, '101 файл'],
    [111, '111 файлов'],
    [1.5, '1,5 файла'],
  ])('formats Russian file counts: %s', async (count, expected) => {
    const i18n = await import('@/lib/i18n');
    i18n.setUiLocale('ru');
    expect(i18n.formatCount(count, 'file')).toBe(expected);
  });
  it('preserves English pluralization and formats task counts in Russian', async () => {
    const i18n = await import('@/lib/i18n');
    i18n.setUiLocale('en');
    expect(i18n.formatCount(1, 'file')).toBe('1 file');
    expect(i18n.formatCount(2, 'file')).toBe('2 files');
    i18n.setUiLocale('ru');
    expect(i18n.formatCount(21, 'feature')).toBe('21 задача');
    expect(i18n.formatCount(22, 'feature')).toBe('22 задачи');
  });
});
