# Feature storage, metrics and production artifact checkpoint

Branch: `refactor/backend-nestjs-migration`, after `bf5210e7`.

## Implemented

- Native FeatureStorageModule injects the scoped filesystem and canonical project
  validator into FeatureLoader. JSON/text/image/output/app-spec persistence,
  atomic writes and recovery use that instance. Canonical file lanes bound
  admission and drain; mutations fail on ambiguous reads, native create is
  exclusive and failed JSON commit retains referenced images. Loader drain runs
  in `beforeApplicationShutdown`, between producer destroy hooks and filesystem
  close. The native order test also passed with the old hook under the current
  module order: the phase change formalizes the boundary rather than claiming a
  reproduced failure of that existing order.
  See [feature filesystem audit](stage-5-native-feature-filesystem-audit.md).
- Production TypeScript excludes test-only `src/routes`. The build's emitted
  output guard requires main.js and rejects routes/legacy directories, including
  transitive imports that defeat a compiler exclusion. Source characterization
  handlers/tests remain available to Vitest; native production imports are zero.
  Signal smoke reuses the same artifact guard. Actual clean build succeeded.
- METRICS now aliases one application-owned bounded collector, with HTTP and
  provider aggregates, retained unknown cleanup counts and local correlation.
  Authenticated `/api/metrics` validates its response using a shared schema.
  Collector/observer tests and a real two-app HTTP/provider contract pass.
  See [metrics audit](observability-metrics-audit.md) and
  [operations](../../backend-observability.md).
- The final UI setup namespace/helpers moved to a typed domain factory with
  explicit transport/confirmation/translation ports. Existing preflight/consent,
  credential and provider/config matching remain intact. All 29 namespaces now
  live in domain clients; root auth/fetch/WS and compatibility bridge ownership
  remains explicit. See [setup audit](setup-client-extraction-audit.md).

## Final combined verification

| Check                                             | Result                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| Full server unit suite                            | 3835 passed, 40 skipped                                            |
| Full server contract suite                        | 420 passed                                                         |
| Full package/UI suite                             | 1533 passed                                                        |
| Production server build and emitted-output guard  | Passed; routes/legacy absent                                       |
| Production UI build                               | Passed, including Electron main/preload build                      |
| Server lint / UI typecheck                        | Passed                                                             |
| Full UI lint                                      | Exit 0; 3 warnings in unchanged running-agents/cursor-status files |
| Architecture fixtures                             | 11 passed                                                          |
| OpenAPI generation/structural checks              | 5 passed; fresh artifact                                           |
| Inventories, lockfile, formatting and diff checks | Passed                                                             |
| Production host lifecycle                         | SIGTERM/SIGINT exit 0, 54.9/54.1 ms                                |
| Idle performance budget                           | Passed; no unexpected resources after close                        |

Idle sample after the suites: import 531.7 ms, composition 55.5 ms, listen 3.07 ms,
100 health requests with p95 1.48 ms, RSS 200503296 bytes, shutdown 5.12 ms.
This remains a coarse local budget, not production load acceptance.

Contracts include the owned Gemini 0.65.0 policy fixture. No paid vendor calls or
operator profile imports were performed. Docker image/packaged Electron/Chromium
and real SSH acceptance remain historical evidence from the
[artifact checkpoint](verification-import-gemini-performance-checkpoint.md), not
new launches in this slice.

## Remaining original boundaries

The full goal remains active. FeatureLoader's native path is now scoped, but
FeatureStateManager and other service consumers still call global filesystem /
atomic helpers directly and need their own explicit ports. Other large services,
state/transaction boundaries, complete shared API contracts, workflow/execution
tracing and load/platform/operational gates retain their original requirements.

OpenAPI currently has 318 operations, 42 incomplete decorated/raw inputs, one
shared runtime response (`/api/metrics`) and 317 unverified responses. Runtime
response parsing is recognized conservatively; annotations do not fabricate
coverage. The collector does not supply queue/process metrics or distributed
tracing. Histories/caches are not made distributed by this migration.

Native feature lanes coordinate one application, not external concurrent writers;
exclusive create is protected across applications. Hardlinks are required for
exclusive publication. Power-loss fsync durability and temporary-file garbage
collection are not added by this slice. Project rollback continues to require
consistent project snapshots in addition to DATA_DIR.
