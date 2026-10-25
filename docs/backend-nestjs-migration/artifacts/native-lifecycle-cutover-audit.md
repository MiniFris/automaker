# Native lifecycle cutover

Scope: remove the production `LegacyModule` / `createLegacyApplication` bridge,
without changing HTTP authentication, route bodies or introducing another service bag.

## Ownership and retirement

- Deleted `legacy-application.ts`, `legacy/legacy.module.ts`,
  `legacy/legacy.tokens.ts` and the bridge-specific shutdown fixture. No source or
  test imports/callers remain. `AutomakerNestApplication` exposes the native app,
  host, port and start operation; contracts use native HTTP/event providers.
- `ApplicationRuntimeLifecycle` is a real injected root provider. Native
  `AgentStateModule`, `AutoModeModule`, `TerminalRuntimeModule` and
  `LocalProcessRuntimeModule` supply the existing runtime instances.
- Managed dev/test runtimes are now separate Nest providers, once per application.
  `WorktreeProcessService` and lifecycle cleanup receive those same instances.
  Native module/lifecycle code does not call the old WeakMap `getManaged*` helpers.
  Helpers remain for direct legacy route fixtures; their retirement is separate.
- Optional startup tasks preserve settings migration/logging, required agent
  initialization, feature reconciliation and dev-server recovery. Readiness is
  set after blocking work, including when optional tasks are disabled. The obsolete
  background global Claude authentication probe is removed; native setup services
  retain ownership of setup/status observations.
- `.env` loading and process exception installation occur only in the production
  entrypoint. Importing the factory neither loads dotenv nor initializes global
  allowed paths, reads Claude authentication, or adds exception listeners.
  The entrypoint requires the actual CLI file URL to match `import.meta.url`, or
  the explicit `AUTOMAKER_RUN_MAIN=1` fixture opt-in. Production-mode library
  imports no longer start a server merely because `NODE_ENV` is not `test`.

## Startup and shutdown barriers

Each actual startup promise stays tracked independently of the 120-second startup
deadline. Timeout latches stopping and fails startup; it does not claim to cancel
I/O. Admission checks between migration, settings, agent initialization and recovery
prevent late completion from starting the next owner. Cleanup waits up to five
seconds for actual startup work, reports unconfirmed cleanup and still attempts
the remaining owners. A late callback cannot erase that cached failure.

Root `onModuleDestroy` synchronously closes AutoMode admission before its first
await, then persists agent/feature interruption, aborts AutoMode, drains
tracked resume executions, then cleans terminal, local tests/dev and managed
tests/dev. Resume drain is bounded at five seconds; a pending execution remains a
cleanup failure. No provider is constructed during shutdown. This phase completes
before the scoped filesystem's `beforeApplicationShutdown` barrier. Existing
provider/repository `onApplicationShutdown` hooks remain registered. Infrastructure
drain hooks remain separate from runtime cleanup; terminal/local/managed runtime
cleanup has exactly one lifecycle owner.

The orchestration cutover supplies the shutdown admission latch and recovery-loop
checks so an aborted startup resume cannot proceed to its next feature.

## Scoped working-directory policy

No replacement process-global `initAllowedPaths()` was introduced. Native agent
service, session loader, chat SDK builder and ideation service receive validators
from their application's `SecurityService`. All SDK option builders accept an
explicit validator; only direct legacy constructors retain the previous default.
Native AutoMode/pipeline/execution validator forwarding is coordinated with the
orchestration cutover, including the distinction between local host paths and
already-bound remote target directories.

This does not claim removal of every legacy filesystem helper, singleton or
settings migration implementation. In particular the existing Electron settings
migration remains an explicit invoked operation; its raw filesystem implementation
is outside this lifecycle change.

## Targeted evidence

- Native lifecycle unit cases: **11 passed**, including synchronous admission
  before startup drain, persistence before abort, admission-failure attempt-all,
  held migration/settings/dev
  initialization, timeout, late completion, actual drain, stopped readiness,
  attempt-all failure, idempotence and tracked full recovery execution.
- Options/worktree/SDK-policy units: **16 passed**; import/exception/ideation units:
  **41 passed**. Existing agent builder/conversation units: **33 passed** before
  the independent tool-policy follow-up; that owner reruns the changed builder.
- Native bootstrap policy, shell, managed runtime/foundation, agent lease/state:
  **24 contracts passed**. Managed runtime contract additionally rechecked the
  actual ordering through `filesystem.close` to provider disposal: **1 passed**
  (already included in the 24 distinct cases).
- Active agent SIGTERM/SIGINT: **2 passed**; failed SIGTERM cleanup with later
  provider disposal and nonzero exit: **1 passed**.
- Separate Node child in `NODE_ENV=production`, with Vitest environment flags
  removed and an owned `.env` fixture: **1 passed**. Import exits by itself without
  server startup, environment mutation, or exception/signal listener installation.
- Targeted source ESLint and the final server TypeScript check passed after the
  parallel orchestration planning-option type mismatch was resolved.
  No Docker, SSH, browser, packaged build or full-suite runs were started for this
  cutover.

The shared inventories are regenerated by the parent after all owners freeze.
Earlier completion audits describing a live production LegacyModule are historical
evidence superseded by this source cutover, not evidence that every stage-10
packaging/performance/rollback requirement has been completed.
