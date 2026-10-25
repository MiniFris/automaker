# Template lifecycle, contract coverage and route retirement checkpoint

Branch: `refactor/backend-nestjs-migration`, after `aac73366`.

## Implementation

- Template commands and the complete clone workflow have explicit owners, bounded
  cancellation/drain and shutdown admission. Canonical target reservation and
  exclusive directory creation prevent concurrent attempts from deleting another
  attempt's directory. Cleanup verifies the created target's device/inode, retains
  unknown targets and cannot start late initialization or publish success after
  cancellation. Actual private Linux processes and held cleanup prove the lifecycle;
  no real GitHub request was made. See [template audit](templates-workflow-lifecycle-audit.md).
- Seventeen Features operations, two Context operations, ten Agent operations and
  Running Agents now execute shared response schemas. Projects overview remains
  covered. Public FeatureData remains an extensible dictionary; raw projected
  feature labels in Running Agents remain unconstrained too. Historical fields,
  null/absent values, extensions and HTTP 200 failure variants are preserved.
  See [feature audit](project-feature-response-contract-audit.md) and
  [Context/Agent audit](stage-8-context-agent-response-contracts-audit.md).
- Actual bulk-import testing found a functional bug: forwarding the whole request
  as options replaced every individual record with the serialized batch payload.
  The application now forwards only import options, and the adapter makes each
  record authoritative after options are merged. Real native partial/all-success
  imports and an untyped-options regression test verify the correction.
- OpenAPI recognizes same-controller passthrough cancellation helpers only when
  their response references remain restricted to inspected header/listener/read
  operations. External forwarding, body/fluent writes, response aliases, implicit
  Response-bound callbacks and recursive/unknown helper paths remain unverified.
  Three negative/positive fixture groups run in the normal OpenAPI check command.
- Removed four more old Running Agents/Sessions route files. Their characterization
  assertions now exercise native HTTP/read-model or application-repository ports;
  the session identity case still proves persisted model/provider/binding selection.
  Ninety route files remain for other characterization fixtures, outside production.

## Verification

| Check                                                        | Result                                                    |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| Full server unit suite                                       | 3906 passed, 40 existing skips                            |
| Final full server contract suite                             | 545 passed                                                |
| Full package/UI suite                                        | 1563 passed                                               |
| Server/shared and UI production builds                       | Passed                                                    |
| Server/UI lint and UI typecheck                              | Passed                                                    |
| Architecture / OpenAPI checks                                | 13 / 13 passed (10 artifact + 3 ownership fixture groups) |
| Repository-wide format check, diff, lockfile and inventories | Passed                                                    |
| Final production SIGTERM/SIGINT smoke                        | Exit 0; 190.3 / 181.8 ms                                  |
| Final idle performance budget                                | Passed; no unexpected resources after close               |

After the initial full suites, source review confirmed that Running Agents projects
raw FeatureData labels without normalization. Its schema was widened to preserve
those values; the added rich-label HTTP case, repeated complete contract suite,
shared/server builds and UI typecheck passed. Existing typed identity/count fields
remain validated. Earlier suite results are not summed into the final counts.
No timeout/retry changes were made.

Final idle sample: import 540.2 ms, composition 68.9 ms, listen 2.67 ms, health p95
2.15 ms, RSS 213979136 bytes, shutdown 5.42 ms. This is the existing local idle
regression budget, not a workload SLO. OpenAPI retains 318 operations: 296 shared/
no-input operations, 22 incomplete context inputs, 60 runtime responses and 258
unverified responses. Full shared contract coverage remains open.

## Remaining original work

The goal remains active: 258 response operations and 22 raw-context input gaps are
still explicit in OpenAPI. Remaining characterization factories, typed configuration/
platform boundaries, non-Linux process-tree ownership, state/use-case and dependency
rules, workflow observability, workload acceptance and final packaging/operational
evidence retain the original plan scope. Previously verified artifacts are not
presented as fresh acceptance of these sources. No paid model/vendor authentication,
user container/listener/profile changes, push or deployment occurred.
