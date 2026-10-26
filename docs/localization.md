# Interface languages

Automaker supports English and Russian. Choose **Settings → Appearance → Interface
language**. The same selector is available on the login and setup screens.

The initial language follows the browser (`ru`/`ru-*` selects Russian, all other
languages select English). An explicit selection takes precedence and is saved in
`localStorage` under `automaker-ui-locale`. It survives reloads and UI/container
updates on the same browser origin, and synchronizes across tabs. It is a personal
client preference, not a server/project setting. Clearing browser data resets it.
Disabled browser storage does not prevent switching the current tab's language.

Switching does not remount the application or restart tasks, terminals, editors or
forms. Dates and numbers follow the selected locale. Russian counts use
`Intl.PluralRules` (e.g. 1 файл, 2 файла, 5 файлов, 21 файл, 111 файлов).

## What is translated

Navigation, built-in screens and dialogs, setup/login, global/project settings,
provider settings, execution-environment warnings, labels, tooltips, accessibility
text, built-in notifications and model descriptions are in the catalogs.

Model/provider names, agent names, project names/descriptions, code, file paths, shell commands, prompt templates,
terminal/log output, Git commit messages, remote-service errors and model output
are content and are not automatically translated after creation. New task text
uses the selected language as described below. Unknown interface keys fall
back to English. No text or user data is sent to a translation service at runtime.

Built-in pipeline stage names are localized with `getPipelineStepLabel` at the
display boundary only. Custom stage names, stored stage names/IDs and instructions
stay unchanged. Workflow status labels use `getWorkflowStatusLabel`; filter values
remain protocol IDs. Do not pass model, project or agent names to `translate`, even
when their text happens to match an existing interface key.

The Russian draft was prepared using machine translation of interface strings
only, with the user's permission. Common terminology, permission/security text
and timeout descriptions have a separate reviewed override layer. Some less-used
long descriptions may still benefit from linguistic editing.

## Language of generated tasks

The UI sends its current language as optional `outputLocale: "en" | "ru"` on title
and description enhancement, backlog planning, specification creation/regeneration,
feature generation from a specification, and ideation initial messages, subsequent
messages, and generated suggestions. Clients omitting it use English. Unsupported
values are rejected by request validation. The language stays a personal browser
preference; it is not stored in shared server/project settings.

`withOutputLanguage` in `libs/prompts/src/output-language.ts` appends a common rule
after prompt assembly, including custom prompts. Its built-in `{outputLanguage}`
placeholder resolves to English or Russian; placeholders inside user content and
custom prompts are left intact. Generated titles, descriptions, explanations,
implementation details, user stories, rationales, acceptance criteria and readable
specification text follow this rule. Code, commands, file paths, proper names,
JSON/XML keys/tags, IDs and enum values retain their required representation.

Accepted background jobs capture the request language. Specification generation
and its subsequent feature generation share the same captured language. Switching
the UI affects future requests; it neither restarts work nor translates existing
tasks, cached results, imported issues, or manually entered text. Static project
analysis suggestions are separate from model-generated ideation suggestions.

The rule is an instruction to the model, not a separate translation request or
an output-language validator. Automated tests verify propagation and formatting
with offline providers; model compliance requires a live generation check.

## Maintaining translations

- `apps/ui/src/lib/i18n.ts`: `translate`, `useUiLocale`, `useLocalizedMemo`,
  `formatCount`, `getFormattingLocale`.
- `apps/ui/src/locales/en.json`: generated English source-key inventory.
- `apps/ui/src/locales/ru.json`: base Russian translations.
- `apps/ui/src/locales/ru-reviewed.json`: reviewed translations; these take priority.
- `apps/ui/src/locales/codemirror-ru.json`: built-in editor search/replace, folding,
  diagnostics and diff phrases. A locale extension reconfigures the editor without
  translating source text or resetting the document/selection.

Use English source text as the key and named interpolation values:

```tsx
function Greeting({ name }: { name: string }) {
  useUiLocale();
  return <p>{translate('Hello, {name}', { name })}</p>;
}
```

Translate only application-owned copy, never user content. Interpolation values
are inserted once and are not re-translated or interpreted as placeholders. React
still escapes them normally. Use `formatCount(count, 'file')` for count phrases,
not an English `s` suffix. Format dates/numbers with `getFormattingLocale()`.

Module-level display configuration uses getters so it does not freeze the initial
language. Memos producing translated copy, JSX or display metadata use
`useLocalizedMemo(factory, dependencies)` to invalidate on a language change while
preserving the ordinary dependencies. Protocol identifiers, stored values,
commands, model IDs and API payload keys stay unchanged.

```bash
node scripts/check-ui-localization.mjs --write # regenerate English inventory
node scripts/check-ui-localization.mjs         # completeness + placeholder checks
node scripts/check-ui-localization.mjs --audit # unmarked literal JSX text
npx vitest run --project ui
```

The audit is a static aid, not proof that arbitrary runtime/backend strings are
translated; review new default props, formatting helpers and dynamic metadata.

`scripts/translate-ui-catalog.mjs --allow-external-translation` is an optional
maintainer-only draft preparation tool. It requires permission before sending
new English interface keys to Google Translate's public endpoint; it never runs
in the app. Review its results, especially technical identifiers and commands.
Reviewed overrides are never overwritten. The translation service is best-effort;
the app does not depend on its availability.

## Deployment

For interface-only catalog updates, only the UI needs rebuilding. The generated
task language feature changes both UI requests and backend prompt assembly, so
rebuild/deploy both UI and server for that feature. Existing project data,
credentials and model settings require no migration. The Docker UI can be updated with
`docker compose -f docker-compose.yml up -d --no-deps ui` after building its image.
