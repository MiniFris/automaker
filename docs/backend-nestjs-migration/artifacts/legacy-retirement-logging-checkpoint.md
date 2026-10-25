# Native characterization, legacy route retirement and logging ownership

Date: 2026-10-25. Branch: `refactor/backend-nestjs-migration`.

## Delivered behavior

All remaining 83 TypeScript files under `apps/server/src/routes` and the unused
legacy worktree composition helper are removed. Native controller inventory still
contains 318 operations. The inventory generator now reads native controllers only;
source/build/architecture checks reject reintroducing legacy route sources.
Characterization fixtures use real Nest HTTP boundaries, injected offline ports,
private Git repositories and an owned SSH peer. Moving Settings fixtures from the
route tier to the native module tier changes classification, not prior coverage:
the previous contract config already included those route fixtures.

Native characterization exposed and corrected these production differences:

- Remote/pinned Git writes require the inspected target. Missing target IDs are
  auto-filled only for an unbound Local runtime. `useWorktrees:false` cannot discard
  a saved remote feature pin; init-script admission checks the target before ACK.
- Optional project/worktree paths remain optional in guards when a session ID or
  another schema field supplies the lookup. Missing managed session IDs return
  `DEV_SESSION_GONE`/`TEST_SESSION_GONE` with404 and do not create host processes.
- An unborn repository gets its compatible initial commit before worktree creation.
  Branch switching stashes tracked changes while preserving purely untracked files.
  Adding a remote keeps atomic Git non-overwrite behavior even if prelisting fails;
  command failure remains500 without exposing command output.
- Worktree listing recovers rebase branch names, retains detached entries, ignores
  vanished paths without pruning, discovers valid same-repository worktrees and
  preserves manually selected PR metadata. Metadata writes reject corruption and
  symlink escape and use unique exclusive temporary files plus atomic rename.
- Commit/PR text generation honors saved provider-specific deadlines, aborts and
  confirms underlying settlement, and drains accepted queries on application close.
  Unconfirmed cleanup blocks replacement and a later clean-close claim. Timeout
  errors retain the controlled public message and have code `TIMEOUT`.

The shared logger remains browser-compatible. Native applications own their
mutable logging policies via an explicit async context bridge. HTTP, WebSocket,
startup and shutdown callbacks use that owner; updating A does not reconfigure B.
Disabling request logging preserves correlation and metrics. Direct service calls
outside an application context retain the documented global fallback. See the
[logging audit](application-logging-policy-audit.md) and
[Settings fixture audit](legacy-settings-fixtures-retirement-audit.md).

Strict shared request schemas intentionally reject unknown/malformed fields at the
HTTP boundary. Managed tests now assert that rejection before any dispatch, rather
than expecting legacy factories to ignore extra request fields.

## Validation

- Server unit:4026 passed,40 skipped.
- Native contract suite:727 passed,1 opt-in skip. The count changed because78
  Settings fixtures moved to the unit tier; the total is not a lost-coverage claim.
- Package/UI unit projects:1751 passed.
- Real SSH:19 environment/Git cases and16 managed dev/test cases passed, including
  actual Chromium/Vite/HMR. These use a private ssh2 peer, not an operator SSH host.
- Native unborn-repository integration:1 passed.
- Architecture:13 passed; OpenAPI ownership/context/binary proofs:21 passed.
- Server/packages and Web builds, UI typecheck and server/UI error-only lint passed.
- Lifecycle SIGTERM/SIGINT:exit0 in209.3/226.2ms. Idle performance budget passed:
  import763.6ms, composition135.7ms, listen3.87ms, health p95 4.17ms,
  RSS227713024bytes, close7.12ms; no unexpected active resources.
- Generated inventories are current:318native operations;316JSON and2binary
  response contracts, no incomplete inputs or unverified responses.
- Full repository formatting and diff checks passed.

The [real workload probe](workload-acceptance.md) and current artifact acceptance
are tracked separately.
Offline Git/gh shims supply only explicitly declared fetch/list/failure outcomes;
Git mutations execute against private actual repositories. No model/vendor calls,
user containers, profiles or global Git configuration are used.

## Remaining scope

This removes the final legacy route implementation; it does not complete the whole
migration plan. Source-current packaged Docker/Linux Electron acceptance,
upgrade/restart and selected-artifact rollback, broader dependency/config rules,
execution correlation and conditional Windows/macOS/deployment acceptance remain
separate gates. Workload measurements establish their explicit local budgets, not
production SLOs. Existing opaque business values and generic error ranges retain
those documented contract limits.
