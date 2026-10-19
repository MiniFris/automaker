# Interface localization

## Scope

English and Russian UI, including setup/login, navigation, project and global
settings, providers, execution environments, board, agents, dialogs, notifications,
accessibility labels, and date/number formatting. Project content, source code,
commands, model identifiers, and model output must not be translated.

## Stages

1. [x] Add a small local translation runtime, reactive language selection, persistent
       browser preference, browser-language detection and an English fallback.
2. [x] Extract interface copy into an auditable catalog and migrate render paths,
       configuration labels and notifications. Prepare the Russian catalog (external
       machine translation of interface strings only was approved by the user).
3. [x] Review terminology and safety/permission messages, cover dynamic text and
       locale-specific formatting, add catalog completeness and interaction tests.
4. [x] Run unit tests, lint and production build. Document remaining limitations and
       deployment requirements. Do not recreate the server or mutate project data.

## Design

- English source text is the stable translation key. Unknown keys fall back to
  English; interpolation values are never translated.
- Language is a client preference, stored independently from server settings so
  that login/setup screens and different users of one server work correctly.
- React components subscribe to the locale without remounting the application,
  preserving forms, running tasks and terminal sessions.
- Translation catalogs ship with the UI; there is no runtime translation service.
- Catalog checks reject missing Russian strings and mismatched placeholders.

## Verification (2026-10-19)

- 4,603 application source keys plus the built-in CodeMirror Russian phrases.
- All 459 UI unit tests passed (49 files); UI lint passed.
- Catalog completeness, interpolation and unmarked-JSX audits passed.
- Production Docker build passed; UI-only deployment was approved by the user.
- Browser smoke covered login, language persistence/reload, switching both ways,
  provider/Direct pages, collapsed timeout panels and execution warnings.
- Regression tests cover unchanged API provider IDs/timeout units, retained form
  drafts, stable sidebar collapse keys, and unchanged editor text/selection.
- Follow-up regressions preserve model/agent/project names, localize all seven
  pipeline templates without rewriting stored data, update memoized status badges
  on locale changes, and preserve filter category names and API status IDs.
- Server container identity/start time is unchanged; it was not recreated.
- Standalone UI typecheck still reports the two pre-existing optional-string
  errors in `board-view.tsx`; no new typecheck errors were introduced.

See [localization.md](localization.md) for maintenance and translation boundaries.
