# Agent storage, recovery and session contracts checkpoint

Branch: `refactor/backend-nestjs-migration`, after `cad18752`.

## Implementation

- Native agent metadata, history, execution journals, delivery journals and
  deletion artifacts use the application's filesystem. Shutdown drains execution
  settlement, delivery writes and the repository in that order before closing the
  filesystem. Persisted formats and no-replay decisions are unchanged.
  See [agent persistence audit](stage-7-scoped-agent-persistence-audit.md).
- Prompt context and image reads receive the same explicit filesystem. Recovery
  state commits atomically, serializes save/read/clear operations and drains accepted
  writes. Both snapshot paths filter running features by project. Recovery reads
  feature backups through the FeatureLoader transaction lane with strict errors.
  See [prompt/recovery audit](stage-6-prompt-recovery-io-audit.md).
- Shared schemas cover additional setup/provider queries, settings provider names,
  ideation categories and terminal authentication. Literal refresh semantics,
  service-specific validation messages and shutdown precedence are preserved.
  See [query audit](query-input-contract-audit.md).
- Seven session operations and project overview validate success responses against
  shared runtime schemas. Session metadata preserves historical optional fields,
  opaque timestamps and extension fields; execution bindings retain their version 1
  shape. Native HTTP tests exercise CRUD, archive visibility, stored message/binding
  extensions, minimal legacy metadata and real overview feature counts.
- OpenAPI query parameters now derive requiredness from their runtime input schema.
  The generated inventory contains 318 operations, 296 shared/no-input operations,
  22 raw-request-context input gaps, 18 shared-runtime responses and 300 unverified
  responses. These counts explicitly do not claim full public contract coverage.

## Verification

| Check                                                                 | Result                                      |
| --------------------------------------------------------------------- | ------------------------------------------- |
| Full server unit suite, final run                                     | 3839 passed, 40 skipped                     |
| Full server contract suite                                            | 456 passed                                  |
| Full packages/UI suite, final run                                     | 1541 passed                                 |
| Prompt/recovery native contracts after image compatibility correction | 6 passed                                    |
| Architecture / OpenAPI structural checks                              | 11 / 9 passed                               |
| Server/shared and UI production builds                                | Passed                                      |
| Server/UI lint, UI typecheck, lockfile                                | Passed                                      |
| Formatting/diff and route/dependency/consumer inventory checks        | Passed                                      |
| Final SIGTERM/SIGINT lifecycle smoke                                  | Exit 0; 41.0 / 59.1 ms                      |
| Final idle performance budget                                         | Passed, no unexpected resources after close |

The initial unit run found two image-test failures. One assertion omitted the
new explicit filesystem argument; the other exposed an unintended compatibility
change for genuinely missing attachments. Both image conversion paths now retain
best-effort behavior only for true ENOENT. EIO/denied reads reject before content
construction or provider execution, covered by explicit assertions. The corrected
focused tests, repeated full unit/package suites and native prompt contracts passed.

Final idle sample: import 485.7 ms, composition 66.0 ms, listen 2.78 ms, health p95
1.48 ms, RSS 212082688 bytes, shutdown 4.84 ms. This is the existing local idle
regression budget, not a workload SLO.

Fresh Docker/Electron artifacts and Local/Docker/SSH/Chromium acceptance were last
verified at `cad18752`, as recorded in the preceding checkpoint. They were not
rebuilt for this intermediate slice and are not presented as acceptance of these
new sources. No paid model calls or external vendor authentication were used.

## Remaining original work

This checkpoint does not finish the migration. Remaining source work includes
native ambient filesystem consumers (notification/history, authentication storage,
provider cache and validation storage), unused source route factories and compatibility
getters, terminal explicit-stop outcome reporting, full response/context contracts,
dependency rules and workflow observability. The original workload and operational
acceptance gates remain separate from local idle performance and Linux artifact
evidence. PlanApprovalService is not an ambient filesystem consumer; the prior
checkpoint's remaining-work wording has been corrected after source inspection.
