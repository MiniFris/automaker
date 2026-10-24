# State transactions, execution filesystem and core contracts checkpoint

Branch: `refactor/backend-nestjs-migration`, after `0f195fac`.

## Implementation

- FeatureStateManager uses FeatureLoader transactions for status, plans/tasks,
  summaries and reconciliation. Strict read, predicate, mutation and atomic commit
  share the canonical file lane. Pipeline interruption preservation is evaluated
  inside the transaction; events follow commit and unknown IO is not swallowed.
  See [state audit](stage-5-feature-state-transactions-audit.md).
- AgentExecutor, ExecutionService, PipelineOrchestrator, RecoveryService and
  related facade IO receive the native application's filesystem explicitly.
  Context/memory writes retain captured run-incarnation guards. Recovery rejects
  ambiguous IO, corruption and unknown version/shape before replay or state clear;
  true ENOENT remains optional and query-only syntax fallback is explicit.
  See [execution audit](stage-6-execution-filesystem-audit.md).
- Terminal inline body validators moved to shared schemas with the same wire
  errors, bounds, defaults, loose fields and accepted array/no-op cases. IDs remain
  opaque strings; service bounds alias the shared constants.
  See [terminal audit](terminal-input-contract-audit.md).
- Five health and four auth success responses now use shared runtime schemas.
  The native wire contract checks all nine routes, cookie login/logout, token
  authentication and readiness/liveness behavior. Logout without the required
  JSON content type still returns 415. The generator recognizes guarded whole-body
  safeParse and header-only passthrough responses without inventing error schemas.

## Verification

| Check                                               | Result                                                     |
| --------------------------------------------------- | ---------------------------------------------------------- |
| Full server unit suite, final run                   | 3835 passed, 40 skipped                                    |
| Full server contract suite                          | 437 passed                                                 |
| Full packages/UI suite                              | 1535 passed                                                |
| Real SSH feature/terminal/worker acceptance         | 32 passed                                                  |
| Managed Docker base acceptance                      | 11 passed                                                  |
| Docker opt-ins                                      | All 4 distinct opt-in cases passed across the focused runs |
| Chromium native workflows                           | 18 passed, one worker, no retries                          |
| Production server/UI builds                         | Passed                                                     |
| Linux Electron packaged build                       | Passed                                                     |
| Fresh production Docker image build/smoke           | Passed                                                     |
| Packaged Electron renderer/backend/PTY smoke        | Passed                                                     |
| Server lint, UI typecheck, formatting/diff/lockfile | Passed                                                     |
| Architecture / OpenAPI structural checks            | 11 / 7 passed                                              |
| Route/dependency/API-consumer inventories           | Regenerated and checked                                    |
| Host SIGTERM/SIGINT smoke                           | Exit 0, 91.6/107.3 ms                                      |
| Final idle budget                                   | Passed; no unexpected resources after close                |

The initial full unit run found five failures in one summary fixture whose loader
mock lacked the new transaction port. The fixture now uses the original read and
persist mocks through that port; summary/event assertions were preserved. Its
110-case focused group and the repeated full unit suite passed. Production code
was not weakened with a fallback for an incomplete mock.

All 15 distinct managed Docker cases were exercised: 11 base cases plus interactive
PTY, manual test cleanup, preview and real target SDK installation. The SDK case
installs pinned Claude/Codex/Copilot packages and executes their version commands;
it does not call a model. The first opt-in run passed PTY/manual tests/install but
preview correctly refused all occupied host ports 3100–3119. Those listeners were
observed and left running. Docker fixtures now use 43300–43319, like the separately
isolated SSH/integration ranges. Preview and its two setup prerequisites then
passed. Filtered cases in those focused runs were not claimed as additional passes.

Idle sample: import 642.2 ms, composition 76.2 ms, listen 3.63 ms, 100 health samples
with p95 1.70 ms, RSS 204201984 bytes, shutdown 4.49 ms. This is a local idle budget,
not an approved production load SLO.

## Reusable artifact evidence

The fresh image is `automaker-nest-wave7-production-smoke:latest` (manifest id
`sha256:5a1751f40ccc00e49a8b2864d0b132470bc45ef4ebedb1caadb8baa28dee64be`).
`scripts/smoke-production-docker.mjs --image <local-image>` requires an explicit
image, pins its local ID and creates only its own isolated container/data. Actual
readiness/auth, feature CRUD/denied-root handling, ZIP decoding, metrics JSON,
absence of dev toolchain/routes/legacy and SIGTERM exit 0 passed on Node 22.23.4.
The owned container was removed after verification.

`scripts/smoke-packaged-electron.mjs --executable <linux-unpacked/automaker>` ran
under Xvfb outside the workspace with private HOME/config/userData/API key. Actual
packaged state, mounted renderer/preload, JSON health/auth, compiled artifact,
HTTP/WebSocket PTY output/exit 0, terminal disappearance, backend closure and profile
removal passed. The runner's initial CommonJS import interop error happened before
launch; it was fixed, and that unused private profile was removed after confirming
no process referenced it. The successful runner cleaned its own profile normally.

Only previous smoke images/bundles owned by this task were replaced. Existing user
containers/listeners and operator profiles were not stopped or changed. Browser
acceptance ran after Docker/SSH network work, on ports 34117/34118. No paid model or
vendor authentication calls were made.

## Remaining original work

The complete goal remains active. The shared artifact currently has 318 operations,
37 incomplete inputs, 10 shared-runtime success responses and 308 unverified
responses; this is explicit progress, not complete shared contract coverage. Error
schemas and binary/stream contracts retain their separate requirements.

Other actual global IO consumers, including PlanApprovalService and non-auto-mode
services, still need explicit native boundaries. Full workflow/execution tracing,
queue/process telemetry, workload performance scenarios, remaining service/state
decomposition and operational/platform gates remain governed by the original plan.
Linux artifacts and local target acceptance do not prove native Windows/macOS or
old-binary/canary rollout. Existing per-application file lanes are not distributed
locks for external writers.
