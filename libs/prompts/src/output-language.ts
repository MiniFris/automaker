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

export const AGENT_OUTPUT_LANGUAGE_RULE = `Agent communication language: {outputLanguage}.
Write all user-facing progress updates, intermediate explanations, planning narratives,
available reasoning summaries, task completion reports, and the narrative content inside
<summary>...</summary> in {outputLanguage}, even when the task, previous session, tool output,
or examples use another language. Apply this to every stage of this execution.
Preserve code, commands, file paths, API identifiers, proper names, JSON/XML keys and tags,
enum values, task IDs, required structural section names, and machine-readable markers
such as [SPEC_GENERATED], [TASK_START], [TASK_COMPLETE], and [PHASE_COMPLETE] exactly.
Do not translate tool output or rewrite earlier messages. Keep the required output structure.`;

export function withAgentOutputLanguage(prompt: string, locale: OutputLocale = 'en'): string {
  const rule = AGENT_OUTPUT_LANGUAGE_RULE.replace(
    /\{outputLanguage\}/g,
    locale === 'ru' ? 'Russian' : 'English'
  );
  return `${prompt}\n\n${rule}`;
}
