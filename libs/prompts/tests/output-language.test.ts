import { describe, expect, it } from 'vitest';
import { withOutputLanguage } from '../src/output-language.js';

describe('generation output language', () => {
  it.each([
    ['ru', 'Russian'],
    ['en', 'English'],
    [undefined, 'English'],
  ] as const)('resolves %s without treating user content as a template', (locale, language) => {
    const custom = 'Custom instructions: {outputLanguage}; keep src/app.ts and getUser()';
    const prompt = withOutputLanguage(custom, locale);
    expect(prompt).toContain(`Output language: ${language}.`);
    expect(prompt.startsWith(custom + '\n\n')).toBe(true);
    expect(prompt.slice(custom.length)).not.toContain('{outputLanguage}');
    expect(prompt).toContain('JSON/XML keys and tags');
    expect(prompt).toContain('enum values, dependency IDs');
    expect(prompt).toContain('Do not translate existing content');
  });
});
