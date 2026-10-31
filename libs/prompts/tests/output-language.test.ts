import { describe, expect, it } from 'vitest';
import { withOutputLanguage, withAgentOutputLanguage } from '../src/output-language.js';

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

it.each([
  ['ru', 'Russian'],
  ['en', 'English'],
  [undefined, 'English'],
] as const)(
  'sets agent progress and final report language to %s while preserving protocol tokens',
  (locale, language) => {
    const custom = 'Custom instructions {outputLanguage}; keep src/app.ts and getUser()';
    const prompt = withAgentOutputLanguage(custom, locale);
    expect(prompt).toContain(`Agent communication language: ${language}.`);
    expect(prompt.startsWith(custom)).toBe(true);
    expect(prompt).toContain('progress updates');
    expect(prompt).toContain('task completion reports');
    expect(prompt).toContain('<summary>...</summary>');
    expect(prompt).toContain('[SPEC_GENERATED]');
    expect(prompt).toContain('Do not translate tool output or rewrite earlier messages');
  }
);
