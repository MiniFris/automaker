# Stage 10 cutover/production audit

Reconciled against current source and recorded checkpoints during wave 8. This documentation update starts no build, test, benchmark,
container or GUI. Recorded artifact runs below belong to their named checkpoints;
they are not new measurements of the frozen wave 8 source. Stage 10 as a whole is
not declared complete.

## Gates with existing evidence

| Original area                                     | Current implementation and evidence                                                                                                                                                                                                                                                                                                                                                                                                      | Scope of the conclusion                                                                                                                                                                                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10.1 native composition / entrypoint              | `LegacyModule`, `LEGACY_APPLICATION` and `createLegacyApplication` were deleted. `apps/server/src/main.ts`, `app.module.ts` and `core/lifecycle/application-runtime.lifecycle.ts` compose and clean up injected owners. [Native cutover](native-cutover-checkpoint.md) and [lifecycle audit](native-lifecycle-cutover-audit.md) record two-app isolation, startup barriers, tracked resume, interruption and attempt-all shutdown tests. | The live legacy bridge is gone. Earlier audit statements that it remains live are superseded. Factory providers constructing native services are not legacy instance wrappers.                                                        |
| 10.1 emitted production artifact                  | `apps/server/scripts/check-build.mjs` requires `main.js` and rejects emitted `routes/` and `legacy/`; clean production builds and artifact startup passed in [artifact checkpoint](state-execution-contract-checkpoint.md).                                                                                                                                                                                                              | Test characterization route source may remain without being production composition. The source removal checklist is still distinct.                                                                                                   |
| 10.2 initial architecture guards                  | `apps/server/eslint.config.mjs` rejects service/provider imports of routes/controllers, core/module imports of routes, module ambient env/cwd and direct controller filesystem/process imports. Architecture fixture checks passed in the artifact checkpoint.                                                                                                                                                                           | These static guards do not prove every public-export, framework-free domain, computed import or module-cycle rule.                                                                                                                    |
| 10.3 config / HTTP / probes                       | `core/config/runtime-config.ts`, `core/http/platform-middleware.ts`, auth and health owners implement typed config, existing CORS/local-origin handling, JSON/content-type/body limits, cookies and liveness/readiness. `nest-shell.contract.test.ts`, auth/security contracts and actual production artifact smokes record behavior.                                                                                                    | Existing behavior is implemented and tested; this is not a deployment-wide proxy/CORS/security sign-off.                                                                                                                              |
| 10.3 resources / shutdown                         | `core/lifecycle/application-shutdown.ts`, `core/http/shared-http-server.adapter.ts` and terminal lifecycle retain failed cleanup, bound transport shutdown and run later hooks. Active PTY and failed-cleanup contracts exist. Download uses native scoped streams; see [download/prompt audit](download-prompt-filesystem-audit.md).                                                                                                    | Closing transport does not cancel or confirm a pending syscall. Unknown resource cleanup remains failure.                                                                                                                             |
| 10.4 idle performance / CI budgets                | `scripts/measure-server-baseline.mjs`, budget tests and `.github/workflows/backend-performance.yml` implement thresholds with a real negative-budget check; [budget audit](performance-budget-and-boundaries-audit.md). The artifact checkpoint records idle p95 1.70 ms, RSS 204201984 bytes and no unexpected resources after close.                                                                                                   | These are coarse local idle checks, not sustained workload or production SLO acceptance. Workflow presence is not a claimed remote CI run.                                                                                            |
| 10.6 production Docker                            | `scripts/smoke-production-docker.mjs` ran against the owned wave 7 image: JSON readiness/auth, feature CRUD and denied-root handling, actual ZIP extraction, metrics, no dev toolchain/routes/legacy and SIGTERM exit 0. The owned container was removed.                                                                                                                                                                                | Actual clean production image boot/stop is proved for that artifact. It does not by itself prove old-volume upgrade or every permission scenario.                                                                                     |
| 10.6 packaged Linux Electron                      | `scripts/smoke-packaged-electron.mjs` ran under Xvfb outside the workspace with private HOME/config/userData/key. Actual packaged identity, renderer/preload, JSON health/auth, compiled artifact, HTTP/WS PTY output/exit 0, session disappearance, backend closure and owned profile removal passed.                                                                                                                                   | This is an actual Linux packaged run, not only UI build output. The earlier dynamic-port/HTML-readiness defect was fixed; port exclusion and own-startup JSON handshake have focused tests. It does not prove Windows/macOS behavior. |
| 10.6 managed target behavior                      | The [artifact checkpoint](state-execution-contract-checkpoint.md) records 32 real SSH cases and all 15 distinct Docker cases, including PTY, manual cleanup, preview and pinned SDK installation/version commands.                                                                                                                                                                                                                       | No paid model or vendor authentication calls were made. Managed target acceptance and production backend image acceptance are separate results.                                                                                       |
| 10.7 executable downgrade guard / fixture restore | `scripts/check-backend-downgrade.mjs`, [guard audit](downgrade-preflight-audit.md) and [operations procedure](../../backend-storage-downgrade.md) cover explicit target, read-only marker/quarantine checks and whole-snapshot restore into a fresh sibling. Pending native import intents are covered.                                                                                                                                  | The executable guard and owned fixture restore portion is implemented. It is not a promise that an actual selected old binary can read upgraded storage.                                                                              |
| Native legacy profile import                      | [Import audit](legacy-profile-import-audit.md) and [verification/import checkpoint](verification-import-gemini-performance-checkpoint.md) record snapshot-configured source access, scoped destination, no-overwrite publication, staged recovery and startup failure barrier.                                                                                                                                                           | Earlier audit statements that native settings migration still directly uses ambient env/raw filesystem are superseded. Other consumers still need their own scoped boundaries.                                                        |

The recorded wave 7 artifact checkpoint includes 3835 server units (40 existing
skips), 437 contracts, 1535 package/UI cases and 18 Chromium cases, with production
builds and inventory/lock/format checks. Those counts identify that historical
checkpoint; wave 8 results are recorded separately by the owning checkpoint.

## Concrete remaining runtime and source work

- Terminal explicit stop still acknowledges acceptance rather than confirming
  cleanup or reporting uncertainty end-to-end. In
  `apps/server/src/modules/terminal/terminal.controller.ts:deleteSession`, boolean
  `killSession` yields 200. `services/terminal-service.ts:killSession` starts
  `lifecycle.close()` without awaiting it, logs failure and retains identity.
  `getAllSessions` has no closing/unknown field. In
  `apps/ui/src/components/views/terminal-view.tsx`, kill removes the layout even
  after HTTP/network failure. Existing session GET 503 and WS 4005 correctly prevent
  recreation, but do not close this original stage-9 requirement.
- Native TerminalService still needs an application-owned path/filesystem/home
  boundary. `modules/terminal/terminal-runtime.module.ts` injects SettingsService
  and maxSessions; `services/terminal-service.ts:resolveWorkingDirectory` uses
  `os.homedir()` and the module-global `../lib/secure-fs.js.stat`. Native PTY process
  ownership does not establish scoped filesystem ownership.
- Other actual global/default IO consumers remain outside the scoped native
  owners already migrated. Their concrete call chains must be migrated separately;
  passing source exclusion or idle tests does not replace that work.
- Legacy route factories remain in `apps/server/src/routes` for source/test
  characterization. The remaining `getManagedDevServerService` and
  `getManagedTestRunnerService` exports in `services/execution-environment` are
  WeakMaps keyed by SettingsService, called from old route adapters. They are not
  native module owners. `getTerminalService` is no longer present; the earlier
  claim of a remaining settings caller was historical and is superseded.
- Deleting source-only compatibility factories/getters, accounting for temporary
  flags, and completing public-module/cycle/framework-free dependency rules remain
  source/architecture gates. There is no new evidence of a live legacy bridge.

## Remaining evidence and operational boundaries

- Large feature-list workloads, sustained events/terminal/provider streams and
  repeated workflow FD/child-process checks still need the original workload
  evidence. Deterministic backpressure tests and idle resource counts prove their
  own bounded behavior, not an unmeasured stress run.
- Auth inheritance, SSRF, shell boundaries, DTO/log secret leakage, proxy/cookie
  deployment combinations and path races need their concrete review/test scope;
  individual green contracts are not blanket security approval.
- Production image clean boot/stop and managed Docker cases do not certify an
  existing-data-volume upgrade or a particular previous artifact's rollback.
  Old-binary staging, canary, prerelease/release and monitoring remain operational
  gates. This work does not authorize publishing or operating on real user data.
- Packaged Windows/macOS acceptance is conditional on available runners, as the
  original plan states. Missing local runners and optional vendor credentials do
  not create unconditional new paid/live acceptance requirements.
- Operations documentation must distinguish current lifecycle/config/contracts
  from historical inventories and include tested commands and rollback limits.
  Existing API, observability and storage procedures provide part of that evidence;
  the full documentation checklist is not declared complete.

The original stage-10 checklist should be updated from these bounded conclusions,
not closed wholesale because route ownership is native or test counts grew.
