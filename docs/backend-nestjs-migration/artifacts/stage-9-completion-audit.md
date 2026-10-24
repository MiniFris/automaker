# Stage 9 completion audit

Audit of the original `09-websockets-and-terminal.md` requirements, not a replacement
or reduction of their scope. Original unchecked boxes include work already present.
This audit records implementation and targeted evidence; the combined stage checkpoint
and real platform/package acceptance remain separate.

## Requirement map

| Original requirement                                                       | Current implementation and evidence                                                                                                                                                                                                                                           | Assessment                                                                      |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 9.1 shared initialized HTTP server and pathname upgrade router             | `WebSocketTransportService.onApplicationBootstrap` obtains the adapter's server; one upgrade listener dispatches both paths. `nest-shell.contract` verifies shared listener and both endpoints.                                                                               | Implemented                                                                     |
| 9.1 connection auth before handler                                         | `AuthService.authenticateUpgrade` runs before `handleUpgrade`. Native contracts cover API key, cookie, one-time token/reuse and expired token. Terminal's additional password gate retains existing 4001/4003 close semantics, before any terminal output/input subscription. | Implemented; wire compatibility retained                                        |
| 9.1 URL/query/header/frame limits                                          | Explicit 4096-byte URL, 16 KiB headers and 1 MiB WS maxPayload; malformed upgrade errors become 400. Controlled tests verify header/URL admission; real client oversize frame receives 1009.                                                                                  | Implemented; parser defaults are not the only guard                             |
| 9.1 connection IDs/correlation                                             | Both event and terminal connections use sanitized `createCorrelationId`.                                                                                                                                                                                                      | Implemented                                                                     |
| 9.1 heartbeat/idle/close policy                                            | Shared heartbeat marks alive on pong, pings at 30 s and terminates missed heartbeat clients. Close policies reside in the transport provider.                                                                                                                                 | Implemented; controlled heartbeat tests                                         |
| 9.1 bounded sends/slow client isolation                                    | Application-byte budget includes next encoded packet plus bufferedAmount. Broken senders terminate individually; other subscribers still receive ordered events.                                                                                                              | Implemented; deterministic slow/broken viewer tests, not a WAN stress benchmark |
| 9.1 reject shutdown upgrades                                               | HTTP adapter `beforeClose` marks closing at prepareClose. WS upgrade and terminal input gates observe it; WS also closes at onModuleDestroy.                                                                                                                                  | Implemented; new admission tests                                                |
| 9.2 typed bus, envelope and ordering                                       | Gateway now subscribes to `EVENT_BUS.subscribeAll`; adapter retains individual unsubscribe and disposal. Envelope remains `{type,payload}`. Two native viewers receive typed bus messages.                                                                                    | Implemented                                                                     |
| 9.2 subscriber cleanup, clients/reconnect, bounded history                 | Per-client unsubscribe on close/error; no event replay buffer. Existing HTTP EventHistory remains the history boundary, not duplicated by WS. Native shell contract covers multi-viewer terminal reconnect and startup allowance.                                             | Implemented; no new wire replay protocol                                        |
| 9.3 native terminal owner and role separation                              | `TerminalRuntimeModule` constructs one TerminalService; REST controller/access guard, `TerminalSessionLifecycle`/PTY implementation, and WS transport are separate owners. Native runtime composition contract checks provider identity.                                      | Implemented                                                                     |
| 9.3 limits/password/input/resize/ping and multi-viewers                    | Runtime maxSessions, TerminalAccessService token/password gates, old message shapes and 100 ms resize coalescing retained. Existing native shell contracts cover input/resize/ping/multiple viewers and no repeated startup claim.                                            | Implemented                                                                     |
| 9.3 metadata cleanup and immutable execution binding                       | Real session exit removes resize/connection metadata. Unknown session identity is retained by TerminalService, REST rejects with 503 and WS with 4005 before connected/startup.                                                                                               | Implemented; existing closing-admission/drain contracts                         |
| 9.3 passive layout inspection                                              | Session getters do not prepare environments or start PTYs. Native missing-session lookup returns 404, rather than creating a replacement.                                                                                                                                     | Implemented; existing native shell contract                                     |
| 9.4 local and managed PTY port                                             | TerminalService dispatches local PTY or ManagedTerminalPty framed transport; both expose write/resize/onData/onExit/kill. Target-side supervisor tests exist in the SSH configuration.                                                                                        | Implemented; fresh Docker/SSH acceptance belongs to combined checkpoint         |
| 9.4 lost heartbeat/transport is not exit proof                             | Managed exit requires exitConfirmed; transport loss retains unknown identity and refuses replay/fallback. Existing managed terminal loss cases remain unchanged.                                                                                                              | Implemented; real peer acceptance not rerun by this audit worker                |
| 9.4 backend restart does not replay startup                                | New native real-PTY restart contract writes one owned effect, closes the app, restarts with the same data directory and reconnects the old ID. Result is 4004, zero sessions, unchanged effect file.                                                                          | Implemented; Linux native contract                                              |
| 9.4 browser disconnect is not session deletion                             | Socket cleanup only unregisters viewers; explicit terminal session delete/stop owns kill/confirmation. Existing multi-viewer/reconnect tests cover this distinction.                                                                                                          | Implemented                                                                     |
| 9.4 explicit stop confirms or reports uncertainty                          | Existing TerminalSessionLifecycle and managed terminal tests retain unknown state instead of discarding identity; target-side process cleanup is separately observed.                                                                                                         | Implemented; fresh real transport acceptance still required                     |
| 9.5 reject upgrades/input, service closing, bounded cleanup, close WS/HTTP | prepareClose admission → WS onModuleDestroy close 1012 → 1 s grace/2 s hard WS drain; terminal cleanup remains independently checked; HTTP adapter grants 5 s then destroys only its own connections, with 6 s total confirmation deadline.                                   | Implemented; does not equate transport close with domain syscall cleanup        |

## Changes closing actual migration gaps

- WS no longer waits until `onApplicationShutdown` (after HTTP disposal) to reject
  input/upgrades or start close handshakes. Unresponsive peers cannot hold the
  WS server indefinitely. Both server close attempts are awaited and failures are static.
- HTTP adapter owns only sockets from its own server. New requests receive 503 at
  prepareClose, held requests are disconnected after grace, and close is idempotent.
  Unconfirmed closure is sticky even after a late callback. `assertCleanupConfirmed`
  is checked by the root's managed close after later provider disposal hooks.
- Transport closure never marks an in-flight filesystem write/read as canceled.
  The FS owner's retained work and failed cleanup remain a separate application failure.
- The real SSH terminal REST fixture now uses `createNestApplication`, native
  TerminalAccessService credentials and the native TerminalService. It no longer
  tests `createTerminalRoutes` with a singleton mock. Other real SSH service cases
  remain unchanged; the combined checkpoint must run this migrated REST case.
  Its first combined acceptance exposed Nest's default POST 201 for native session
  create/resize, while the retired Express routes returned 200. Explicit
  `@HttpCode(200)` now preserves all four terminal POST success statuses, without
  changing the old 400/401/403/404/429 failures. Native auth/logout and the actual
  SSH session/resize requests keep assertions at 200, not weakened expectations.
- After that fixture migration, all nine dead `routes/terminal/**` router/common/
  handler files had no external source or test importers and were retired. Their
  former process-global terminal auth token state is no longer retained in source.
  These source deletions are recoverable in Git, not runtime/user-data cleanup.
  `getTerminalService` itself is deliberately **not** removed: a remaining legacy
  `routes/settings/routes/update-global.ts` caller is reachable through the legacy
  settings router in `tests/unit/routes/execution-environments.test.ts`, and an old
  singleton unit still exists. Native SettingsRuntimeEffectsService already uses
  the injected TerminalService. Retiring that last test shim/getter remains part
  of the broad singleton/legacy cleanup gate, not certified by this audit.

## Targeted verification

All commands use the isolated Node 22.22.3 in PATH. No full suites, Docker or
Chromium acceptance were started by this worker. After root's combined SSH run
exposed the POST status regression, one explicitly authorized SSH REST case was
rerun against the corrected native controller.

- `test:unit -- tests/unit/core/shared-http-server-adapter.test.ts tests/unit/modules/websocket-transport.test.ts tests/unit/core/security-eventing-lifecycle.test.ts`: **16 passed**.
- `test:contract -- tests/contract/websocket-transport.contract.test.ts tests/contract/nest-shell.contract.test.ts tests/contract/terminal-closing-admission.contract.test.ts`: **23 passed**.
- `test:unit -- tests/unit/services/terminal-service.test.ts tests/unit/services/terminal-session-lifecycle.test.ts tests/unit/services/terminal-pty-ownership.test.ts`: **58 passed**.
- `test:contract -- tests/contract/terminal-drain.contract.test.ts tests/contract/shutdown-failure-signal.contract.test.ts`: **2 passed**.
- `test:contract -- tests/contract/terminal-restart.contract.test.ts`: **1 passed**.
- Server no-emit typecheck passed after correcting a generic EventType comparison;
  no test timeouts/retries were raised. Managed terminal/worker tests are excluded
  from the unit configuration and must run through `test:ssh`, not be silently
  counted as passed by an unmatched unit selection.
- After dead-route retirement, the final combined targeted selection passed:
  **74 unit tests in 6 files**, **27 contract tests in 7 files**, no-emit typecheck
  and changed-file formatting/diff checks. These totals overlap the selections
  above and must not be added to them as extra coverage.
- After the POST 200 fix: native WS contracts **4 passed**, targeted real SSH
  `managed-terminal.test.ts -t 'authenticates REST sessions'` **1 passed, 6 filtered**;
  both runners exited 0 before the browser/package network barrier was released.

## Still not proved by these targeted runs

- Combined full checkpoint, Docker PTY, target-side terminal worker and full
  Web/renderer regressions on the merged tree. Native REST over real SSH has now
  passed its targeted case; the larger shared transport checkpoint is root's scope.
- Packaged Electron renderer/WS acceptance and actual Windows/macOS PTY/process-tree
  behavior. A browser or UI bundle build is not a substitute for these gates.
- OS/process containment against deliberately escaped process groups, blocked
  filesystem syscalls, cross-process app ownership and global worst-case shutdown
  budget. The adapter does not pretend a disconnected client canceled its domain job.

Stage 9 is not declared complete solely from this file. Its original exit criteria
still require the combined checkpoint and applicable external platform evidence.
