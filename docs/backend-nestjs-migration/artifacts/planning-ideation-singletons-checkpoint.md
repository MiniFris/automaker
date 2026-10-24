# Planning, ideation and singleton retirement checkpoint

Branch: `refactor/backend-nestjs-migration`. Previous checkpoints remain historical
evidence; this document records the next bounded implementation slice.

## Concrete changes

- App-spec/backlog workflows now live in native modules with required run context,
  scoped filesystem/query boundaries and per-application job registries. Jobs keep
  ownership until their promises settle, reject admission during shutdown and
  abort/drain accepted work. Running Agents queries those registries rather than
  route globals. Five obsolete route workflow files and two legacy adapters were
  removed. Admission's canonical project path is passed through to the workflow.
  See [planning audit](planning-workflow-ownership-audit.md).
- Ideation owns bounded background/foreground work, cancellation and shutdown
  drain. Session stop retains ownership until the held message settles. Its own
  persistence uses the injected filesystem. Conversion publishes a durable intent
  and a stable feature identity through exclusive hardlinks; strict reads and
  provenance prevent overwriting an unrelated or unreadable feature. Retry after
  idea deletion failure/restart retains the committed feature, including edits.
  See [ideation audit](stage-8-ideation-lifecycle-conversion-audit.md).
- Eight singleton API families were removed. Native event hooks receive their Ntfy
  dependency through DI; pipeline consumers require explicit pipeline ownership.
  Unmounted transport fixtures use explicit service instances. Context-keyed
  managed dev/test compatibility helpers remain outside native composition.
  See [singleton audit](service-singleton-retirement-audit.md).
- ESLint now rejects old route imports/re-exports from native core/modules as well
  as services/providers. Nine positive/negative architecture fixtures pass.
- Commit `6b85f1dc` contains the independently tested shared input schemas,
  generated OpenAPI artifact/API policy and 28 UI domain client factories.
  See [API/client audit](shared-inputs-openapi-client-audit.md).

## Verification

| Check                                           | Result                                                |
| ----------------------------------------------- | ----------------------------------------------------- |
| Full server unit suite                          | 3825 passed, 40 skipped                               |
| Full server contract suite                      | 412 passed                                            |
| Full packages/UI suite                          | 1528 passed                                           |
| Canonical-path final delta                      | 10 targeted unit tests passed after the full unit run |
| Server/UI production builds                     | Passed, including UI Electron main/preload build      |
| Server/UI changed-client lint, UI typecheck     | Passed                                                |
| Architecture guard fixtures                     | 9 passed                                              |
| OpenAPI artifact/structural checks              | Fresh artifact, 4 passed                              |
| Formatting, diff, lockfile and inventory checks | Passed                                                |
| Production host lifecycle smoke                 | SIGTERM/SIGINT exit 0, 56.6/43.1 ms                   |
| Coarse local performance budget                 | Passed; no unexpected resources after shutdown        |

The final canonical-path change was verified with its targeted tests and rebuilt
server rather than repeating unaffected full suites. Targeted native scenarios
include two-application job isolation, held provider cancellation/drain, default
backlog generation/persistence, spec provider chaining, conversion collision/EIO,
concurrent publication and delete-failure/restart retry.

Performance sample: import 1154.3 ms, composition 161.5 ms, listen 15.8 ms,
100 health requests with p95 4.23 ms, RSS 204435456 bytes, shutdown 4.80 ms.
Other local suites were running concurrently; this is a coarse budget check,
not an approved production load SLO.

The full contract run included the existing owned Gemini 0.65.0 distribution
fixture. No paid model/auth calls were made. Real SSH, managed Docker, production
Docker image and packaged Electron/Chromium acceptance were last run in the
[preceding artifact checkpoint](verification-import-gemini-performance-checkpoint.md);
they were not repeated in this slice. UI production build is distinct from a new
packaged Electron launch.

## Remaining original work

The complete migration goal remains active. Explicit remaining boundaries include
generic feature storage/FeatureLoader and other default filesystem consumers,
test-only legacy route factories/dead production shipping, the rest of the large
service responsibility splits, full shared response/input schema coverage, and
observability/load scenarios. In particular the current default `METRICS` provider
is still `NoopMetrics`; HTTP correlation context does not by itself provide
workflow/provider traces or operational metrics.

OpenAPI lists 317 operations but marks 42 inputs and all response schemas as
incomplete/unverified. UI setup consent orchestration, auth/transport and direct
filesystem helpers remain in the root client. These are not certified complete
by the green suites above.

Conversion hardlink support is required; atomic publication does not promise
power-loss fsync durability or temp garbage collection. Rollback must restore
consistent project snapshots as well as DATA_DIR. The existing DATA_DIR-only
preflight does not inspect external project conversion intents/provenance; see
[rollback operations](../../backend-storage-downgrade.md). Platform runners and
operational old-binary/canary rollout remain subject to their original gates.
