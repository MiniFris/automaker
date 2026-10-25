# E2E image upload and settings fixture fixes

2026-10-25, branch `refactor/backend-nestjs-migration`.

The initial full Playwright verification returned 86 passed, three failed and two
existing skips. Serial reproduction confirmed image upload and Cursor disconnect;
the credential wizard failure depended on initial routing state.

## Changes

- `/api/fs/save-image` and `/api/fs/save-board-background` now accept the existing
  browser client's optional `mimeType` string hint (bounded to 255 characters).
  The shared strict schema previously rejected it with HTTP400. Storage still
  validates the filename extension and existing encoded/decoded size limits;
  metadata does not choose the output path or bypass file checks. OpenAPI is updated.
- Real HTTP regression cases first failed on both endpoints before the schema fix.
  They now verify browser and legacy requests preserve decoded bytes, while numeric
  MIME hints, unknown keys and unsupported extensions still return HTTP400.
- Settings browser fixtures install their setup-state GET override before auth can
  navigate, and clear synchronous settings/setup caches before each document.
  The disconnect test models a completed setup; the credential test models the
  wizard and later settings phase. This isolates routing from the shared E2E
  backend's current setup progress without changing production navigation.
- Cursor disconnect assertions use the current passive authentication notice and
  visible reconnect action. App disconnect does not establish invalid CLI login.
  Exact native target/confirmation bodies, connected=false, cancel/no-mutation,
  reload persistence and reconnect assertions remain in place. Credential
  target/store/verify/delete requests also continue through the real Nest backend.

## Verification

Focused Playwright: **3 passed**, one worker, zero retries. Native filesystem/Git
contracts: **8 passed**, including two new parameterized image regressions.
Package/UI: **1765 passed**. OpenAPI: **21 passed**. Shared contracts/backend build,
UI typecheck and route inventory check passed.

Full parallel Playwright: **89 passed, two existing skips, zero failures and
zero flaky cases**, two workers and zero retries (approximately three minutes).
The original skips (list-view priority and profile creation) retain their
pre-existing status. The previously failing credential wizard also passed in
this parallel run.
No live provider/model calls or operator-container rebuilds are part of these runs.

```sh
TEST_PORT=43407 TEST_SERVER_PORT=43408 NODE_ENV=test VITE_SKIP_SETUP=true \
  AUTOMAKER_API_KEY=test-api-key-for-e2e-tests \
  npm exec -- playwright test --workers=2 --retries=0 --trace=retain-on-failure
```

Run Playwright from `apps/ui`; direct execution avoids the legacy pretest script
that kills shared test ports and resets repository-local server settings. The
Playwright webServer config owns fresh UI/backend processes; the Nest E2E entrypoint
owns a temporary data profile. Ports43407/43408 keep the running operator stack separate.

Logs/reports: `/tmp/automaker-e2e-fixed-focused-final.{log,json}`,
`/tmp/automaker-e2e-fixed-full.{log,json}`, `/tmp/automaker-e2e-fix-files-contract.log`,
`/tmp/automaker-e2e-fix-packages.log` and `/tmp/automaker-e2e-fix-openapi.log`.
