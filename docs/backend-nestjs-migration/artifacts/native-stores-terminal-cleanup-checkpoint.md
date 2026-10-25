# Native stores, terminal cleanup and retired routes checkpoint

Branch: `refactor/backend-nestjs-migration`, after `7ceacc4f`.

## Implementation

- Authentication state and Codex model cache receive the native application's
  filesystem. Explicit module dependency/order keeps accepted auth/cache writes
  ahead of filesystem close; bounded drains retain their failed close results.
  API-key/session formats and permissions remain unchanged. Optional malformed
  cache data remains recoverable; ambiguous storage IO is not reported as success.
  See [auth/cache audit](native-auth-cache-filesystem-audit.md).
- Notifications and event history use canonical project lanes, atomic JSON commits
  and strict authoritative reads. Symlink aliases share one lane. Event/index
  updates retain referenced data after failed index commits, including an error
  reported after rename. Cleanup failures remain explicit; unreferenced files can
  remain after failed cleanup, without introducing a new journal format.
  See [notification/history audit](stage-8-notification-history-filesystem-audit.md).
- Native terminal DELETE waits for actual owned PTY/group cleanup before 200.
  Unconfirmed cleanup returns static 503 diagnostics and retains identity. UI stop
  and restore preserve failed/unknown panels rather than recreating them. Native
  working-directory preflight uses application policy, filesystem and snapshot
  paths even for fallback. Missing/unauthorized HOME never falls back to ambient
  home; denied/EIO requests do not start a PTY. Standalone compatibility callers
  retain their separate legacy defaults.
  See [terminal audit](terminal-confirmed-stop-audit.md).
- Removed 84 unreachable route files (including ideation, MCP, agent and filesystem
  factories). TypeScript import and all-string-literal reachability from server
  source/tests found no callers. Ninety-four route files still reachable by
  characterization tests remain excluded from production; this is not a claim
  that every old source factory has been removed.
- Global HTTP server-error diagnostics contain only a fixed category, status and
  correlation id. Raw exception strings/objects can embed credentials or prompts
  and are no longer logged there. Four regression cases cover Error, arbitrary
  thrown object, HTTP exception and domain exception. Wire envelopes are preserved;
  this does not certify every other logger.
- Contributor documentation now links the native architecture/lifecycle/contract
  workflow in [backend architecture](../../backend-architecture.md).

## Verification

| Check                                                                 | Result                                      |
| --------------------------------------------------------------------- | ------------------------------------------- |
| Full server unit suite, final isolated run                            | 3852 passed, 40 skipped                     |
| Full server contract suite                                            | 473 passed                                  |
| Full packages/UI suite                                                | 1549 passed                                 |
| Server/shared and UI production builds                                | Passed                                      |
| Server/UI lint, UI typecheck, lockfile                                | Passed                                      |
| Architecture / OpenAPI structural checks                              | 11 / 9 passed                               |
| Formatting/diff, generated route/dependency/consumer inventory checks | Passed                                      |
| SIGTERM/SIGINT production lifecycle smoke                             | Exit 0; 272.2 / 153.8 ms                    |
| Final idle performance budget                                         | Passed; no unexpected resources after close |

The initial full unit run had one 10-second timeout in the bootstrap-import test
while build, lint, architecture, package and contract jobs were running concurrently.
There was no assertion failure or timeout change. After those jobs finished, the
complete unit suite passed; the same bootstrap-import case took 2556 ms. This records
the observed scheduling difference without claiming a separately established cause.
Future checkpoint suites should start after dependent builds and avoid placing all
cold-import jobs under simultaneous load.

Final idle sample: import 570.0 ms, composition 81.0 ms, listen 3.22 ms, health p95
2.10 ms, RSS 212946944 bytes, shutdown 4.83 ms. This remains the existing local idle
regression budget rather than a workload SLO. The generated OpenAPI inventory remains
318 operations, 22 incomplete raw-context inputs and 18 runtime success responses;
300 responses remain unverified.

## Remaining original work

The goal remains active. Remaining native ambient filesystem chains include issue
validation storage, dev/test preflight, settings agent discovery, worktree metadata
deletion and broader terminal platform helpers. Two managed dev/test compatibility
getters and the remaining characterization route factories still require retirement.
Full public response/context coverage, broader dependency/state decomposition,
workflow/execution tracing, queue/process telemetry, workload acceptance and
operational rollout evidence remain governed by the original plan.

Actual Docker/SSH/Chromium and packaged Linux Electron acceptance was last recorded
at `cad18752`; these intermediate source changes do not inherit fresh artifact
certification from that run. No user containers/listeners or operator profiles were
changed, and no paid model/vendor authentication calls were made.
