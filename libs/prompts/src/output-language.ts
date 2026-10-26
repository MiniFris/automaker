import type { OutputLocale } from '@automaker/types';

export const OUTPUT_LANGUAGE_RULE = `Output language: {outputLanguage}.
Write newly generated task titles, descriptions, explanations, implementation details,
user stories, rationales, human-readable specification text, and acceptance criteria in {outputLanguage}.
Use this language even when the source material or examples use another language.
Preserve code, commands, file paths, API identifiers, JSON/XML keys and tags,
enum values, dependency IDs, and proper names in their original form.
Keep the required output structure unchanged. Do not translate existing content
unless the requested operation explicitly rewrites it.`;

/** Resolve only the built-in rule: user content is never treated as a template. */
export function withOutputLanguage(prompt: string, locale: OutputLocale = 'en'): string {
  const language = locale === 'ru' ? 'Russian' : 'English';
  const rule = OUTPUT_LANGUAGE_RULE.replace(/\{outputLanguage\}/g, language);
  return `${prompt}\n\n${rule}`;
}
