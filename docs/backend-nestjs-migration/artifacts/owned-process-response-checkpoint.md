# Owned local processes and response contracts checkpoint

Branch: `refactor/backend-nestjs-migration`, after `56a4cccc`.

## Implementation

- Native dev port selection skips occupied ports. Native start/stop paths no longer
  kill port occupants or related livereload ports on any OS. Persisted records
  without a process handle cannot adopt ownership from a port or control another
  application's process.
- Linux dev/test processes use a supervisor created immediately from the spawned
  ChildProcess. It captures the original generation/PGID/SID, validates authority
  before TERM/KILL, and acquires continuity anchors only while the original leader
  is verifiable. A later numeric scan does not grant permission to kill a process
  or group. Close is bounded/idempotent; root exit alone does not confirm group
  cleanup. Unknown outcomes retain identity and block replay.
- An initial missing PID plus the original ChildProcess's affirmative pre-spawn
  error proves no process was created. Ready still rejects, but close/completion
  release the empty slot without a signal. An absent final event, post-spawn error
  or defined-PID identity failure cannot take that path.
- Native Linux dev/test stop, natural exit and application shutdown await the same
  proof before finalization. Windows/macOS retain their explicit existing lifecycle
  compatibility path; complete tree ownership on those platforms remains open.
  Standalone constructor behavior is separate. See
  [process ownership audit](native-local-process-ownership-audit.md).
- Native admission reserves the canonical worktree and original alias synchronously
  before preflight awaits. Same-path/alias requests cannot launch duplicate commands;
  retained unknown identities still block reuse. Port allocation rechecks and reserves
  after the asynchronous probe, so independent worktrees cannot publish the same
  candidate. Failed known-no-child starts and closing admission release their own
  reservations; unknown outcomes retain them. Deterministic delayed-probe/preflight
  tests cover these races without host port allocation.
- Nine notification/history operations now validate typed success payloads at
  runtime, including nested records, replay results and single/all mutation variants.
  Historical timestamps, stored type/trigger strings, nullable optional values and
  extensions are preserved. See [response audit](stage-8-notification-history-response-contracts-audit.md).
- Template clone and workspace config/directories add three more runtime response
  contracts. Workspace configured/default-only/diagnostic variants retain their
  existing shape, and known fields are validated across every union branch.
  Native HTTP tests exercise private real filesystem listing, an explicit offline
  clone-command port, denied/malformed requests, all config variants and malformed
  application payload rejection at all three response boundaries. No real GitHub
  request or clone was made.

## Verification

| Check                                               | Result                                                   |
| --------------------------------------------------- | -------------------------------------------------------- |
| Final full server unit suite                        | 3894 passed, 40 existing skips                           |
| Final full server contract suite                    | 507 passed                                               |
| Full package/UI suite                               | 1555 passed                                              |
| Server/shared and UI production builds              | Passed                                                   |
| Server/UI lint and UI typecheck                     | Passed                                                   |
| Architecture / OpenAPI fixture checks               | 13 / 9 passed                                            |
| Formatting/diff, lockfile and generated inventories | Passed                                                   |
| Production SIGTERM/SIGINT lifecycle smoke           | Exit 0; 692.8 / 683.1 ms during concurrent contract work |
| Final idle performance budget                       | Passed; no unexpected resources after close              |

Source review after the initial green suites identified the affirmative no-spawn
case and deterministic asynchronous worktree/port admission races. Focused tests
and corrections preceded the final complete unit/contract runs above. Earlier
successful runs are not added to those counts. No test timeout/retry changes were
made. Process fixtures only signaled their own explicitly guarded groups; delayed
admission/probe tests used injected ports without touching host listeners.

Final idle sample: import 636.1 ms, composition 68.1 ms, listen 2.66 ms, health p95
1.98 ms, RSS 208375808 bytes, shutdown 5.60 ms. This remains the existing local idle
regression budget rather than a workload SLO. OpenAPI now has 318 operations,
296 shared/no-input operations, 22 incomplete context inputs, 30 runtime success
responses and 288 unverified responses. Full shared contract coverage remains open.

## Remaining original work

This is not final migration completion. Non-Linux local tree ownership, remaining
terminal/platform/config boundaries, characterization route source removal,
full public response/context coverage, broader state/dependency decomposition,
workflow observability, workload acceptance and final packaging/operational gates
remain governed by the original plan. In particular, native template command-runner
spawn/close ownership is a separate concrete consumer of the same process concerns;
the offline response fixture does not certify it.

Previous Docker/packaged Electron and broad target/browser evidence is historical.
All destructive process signals in this slice were confined to private spawned
fixture groups with explicit guards; private ephemeral listeners tested noninterference.
Normal host service ports, user containers/listeners and operator profiles were not
modified. No paid model/vendor authentication, push or deployment was performed.
