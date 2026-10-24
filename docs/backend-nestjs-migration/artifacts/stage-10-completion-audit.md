# Stage 10 cutover/production audit

Read-only audit of the original `10-cutover-and-hardening.md`, against current source
and existing recorded evidence. No build, network, Docker, SSH, browser or benchmark
was launched for this audit. Root's combined checkpoint and Linux packaged run are
separate, still-to-be-recorded evidence. Historical snapshots are not current results.

## Implementation and evidence map

| Original area                                | What currently exists                                                                                                                                                                                                                          | Remaining / qualification                                                                                                                                                                                                                                                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 10.1 all HTTP owners / old entrypoint        | Existing generated inventory lists 317 Nest owners; `main.ts` is the production entry, Docker CMD and Electron paths target main; server clean-build removes old dist.                                                                         | Root must regenerate/check inventory after this combined batch. Source/compiled old index were absent during inspection.                                                                                                                                                                                           |
| 10.1 legacy middleware / wrapper composition | Nest directly owns providers, agents, settings, project stores, terminal and orchestration. Old legacy service bag/factory provider file is retired.                                                                                           | Live `LegacyModule`/`createLegacyApplication` startup/shutdown bridge remains. Removing old router middleware is not proof this bridge disappeared.                                                                                                                                                                |
| 10.1 route factories / singleton getters     | Nine unused terminal route/common files retired in stage 9; several other route groups already retired.                                                                                                                                        | Many legacy route factories remain. `getTerminalService` still has a legacy settings-route/test-shim caller. Other getter/registry cleanup remains in stage 11.                                                                                                                                                    |
| 10.1 temporary flags / deleted-import checks | Existing ownership inventory checks and server build detect concrete missing imports.                                                                                                                                                          | No blanket proof that all temporary ownership descriptors/flags are gone; that original item remains open.                                                                                                                                                                                                         |
| 10.2 dependency rules                        | ESLint rejects direct env/cwd reads in `src/core`/`src/modules` except config parsing. Source inspection found no explicit `Scope.REQUEST`/REQUEST injection.                                                                                  | This is narrower than all requested rules: services/providers, public module exports, Nest-free domain/application, singleton instances and controller shell/cycle enforcement are not comprehensively guarded.                                                                                                    |
| 10.3 config/probes/cookies                   | Typed runtime config validation, protected/public health routes, CORS allowlist/local-origin handling, JSON content-type/50 MiB body limit, production secure/lax cookies and preview guards exist.                                            | Deployment/proxy behavior and private-network matrix need explicit evidence; do not enable trust-all proxy settings to make a check pass.                                                                                                                                                                          |
| 10.3 limits / shutdown                       | Dedicated download bounds exist; WS limits/admission and owned socket drain are implemented in stage 9; production signal smoke and active-resource contracts exist.                                                                           | Download archive ownership/scoped FS still needs migration. Docker-stop and active workload cleanup require their corresponding target evidence, not only idle health.                                                                                                                                             |
| 10.4 performance comparison                  | `measure-server-baseline.mjs` measures import/init/health latency/RSS/shutdown and exits naturally. Historical baseline records 154 MiB legacy vs 192.2 MiB native RSS, different startup phases explicitly separated.                         | Not a fresh result or an approved regression budget. No benchmark threshold assertions/CI benchmark job found; large lists, sustained streams and repeated FD/process workloads are not proved by 100 health requests.                                                                                             |
| 10.5 security review                         | Auth, typed path policy, token reuse/expiry, managed execution ownership, secret/error redaction and native WS boundaries have specific contracts.                                                                                             | Individual green contracts are not blanket sign-off for all auth inheritance, SSRF, shell paths, CSRF, metadata/DTO/log leakage or file races. Remaining native/legacy FS and SDK consumers are explicitly recorded elsewhere.                                                                                     |
| 10.6 Standalone/Web                          | Server production build, native lifecycle smoke and real UI regression commands exist; server packaging prepares a production-dependency bundle.                                                                                               | Fresh combined runs and actual production-dependency artifact boot are required before claiming this matrix complete. A build alone does not prove setup/project/agent/terminal workflows.                                                                                                                         |
| 10.6 Docker                                  | Production Dockerfile targets `dist/main.js`, owns a non-root app user and healthcheck. Managed target integration tests exercise actual Docker execution.                                                                                     | Managed execution image tests do not prove clean production image install, existing-volume upgrade, permissions or container stop. Audit found missing contracts workspace manifest before npm ci; root has now added it and removed duplicate spec-parser COPY. Actual clean build/run remains separate evidence. |
| 10.6 Electron                                | `prepare-server.mjs` installs server dependencies with `--omit=dev`, copies workspace builds, replaces symlinks and supplies main entry. afterPack rebuilds server natives. Current root change excludes developer `.env` from extraResources. | New `smoke-packaged-linux.mjs` verifies actual packaged identity, isolated profile, dynamic backend URL, 200 readiness/401 protected route, real packaged node-pty and backend disappearance after close. Script presence is not a successful run; root must record build/run result.                              |
| 10.7 storage/rollback                        | Durable queue deliveries, deletion tombstones and execution intents are implemented with forward recovery contracts; backups/storage format decisions are documented.                                                                          | No executable downgrade preflight/contract was found for the explicitly named markers. Safe current-version recovery does not make an older binary safe against the same DATA_DIR. Require a consistent snapshot or explicit conversion, not automatic deletion of safety markers.                                 |
| 10.8 docs                                    | Migration, contracts, config decisions, protocol and execution-environment references exist.                                                                                                                                                   | Some inventory/baseline documents intentionally describe stage 0/history. Current operations docs must distinguish those snapshots from actual main entry/lifecycle/packaging and provide a tested rollback procedure.                                                                                             |

## Conditional acceptance versus unconditional claims

- The original Electron requirement says packaged macOS/Windows/Linux **where
  runners are available**. Linux is available here and is the immediate actual
  packaged gate; absent local macOS/Windows runners are not fabricated failures or
  a demand to provision machines without authorization. Existing release CI builds
  those platforms, but a build matrix is not an executed renderer/PTY smoke result.
- Optional live-provider/vendor acceptance is not converted into mandatory paid
  API calls. Offline contracts must state their scope; no account-authentication
  claim is inferred from installed CLI/SDK detection.
- Canary/prerelease/production rollout and monitoring are operational stages.
  This audit does not authorize publishing a public release, pushing another branch,
  changing a production installation or using real user credentials/data.
- Keep the original performance, rollback and applicable package gates visible.
  Do not close them solely because route ownership is Nest or unit counts increased.

## Concrete next evidence/actions, without adding new requirements

1. Run root's actual Linux packaged artifact smoke after network-mutating tests,
   record its real result and fix only observed packaging issues.
2. Verify the corrected production Docker workspace/build path independently of
   managed-worker transport tests; document existing-volume upgrade and stop scope.
3. Run a fresh comparable benchmark when the runner is idle, then establish the
   originally requested budgets/CI regression checks rather than relabeling old RSS.
4. Implement/test the already-specified downgrade marker preflight and snapshot/
   conversion procedure before promising rollback to an older backend.
5. Finish live legacy bridge/getter/factory and remaining native FS/SDK isolation
   work; add the missing dependency rules and align current operations documentation.

This audit is not a declaration of complete stage 10 or an expansion into optional
hardening. It separates existing implementation, available tests, pending actual
acceptance and conditional/operator-only work in the original plan.

## Observed packaged startup regression and targeted correction

The actual Linux artifact smoke exposed overlapping port selection: with 3007 and
3008 occupied, both unbound backend and static selections chose 3009. Static HTML
then satisfied the old HTTP-200-only backend check. This was a readiness false
positive, not evidence of an authentication bypass.

Static port selection now excludes the selected backend port before either binds.
The startup probe requires bounded JSON health. External-server mode uses public
`/api/health` without an API key. Embedded mode authenticates detailed health and
checks a fresh launch UUID response header plus the expected data directory; it
also verifies the spawned child has not exited. A previous child's late event
cannot clear a newer child reference. The UUID is snapshot-scoped, format-checked,
and returned only by protected detailed health; its JSON body is unchanged. This
is a startup handshake, not continuous runtime takeover protection.

Targeted evidence: UI port/probe tests **12 passed**, native startup-header contracts
**3 passed**, UI and server TypeScript checks passed. These cover occupied defaults,
HTML/invalid JSON, another launch using the same API key, wrong data directory,
oversized/never-ending health, public no-key access and unauthorized/invalid-nonce
header suppression.

Root then rebuilt the actual Linux package and ran it outside the workspace with an
isolated HOME: renderer mounted, readiness 200, unauthorized detailed health 401,
bundled node-pty process exit 0, backend closed after application close. Production
Docker build/smoke also passed before this final startup-header addition: readiness
200, unauthorized detailed health 401, no TypeScript runtime dependency, SIGTERM 0.
Current combined evidence and remaining qualifications are recorded in the
[resumed checkpoint](resumed-goal-checkpoint.md); the earlier audit table describes
what was known before these runs and does not supersede that evidence.
