# Execution settings, AutoMode, integrations and usage response checkpoint

Branch: `refactor/backend-nestjs-migration`, after `5939bf37`.

## Implementation

- Twenty execution-environment settings operations now validate actual nested
  configuration, consent, Docker/SSH diagnostics, preparation and provider status
  DTOs. Saved binding metadata preserves unvalidated historical extensions;
  optional fields are not silently made stricter. See
  [environment audit](execution-environment-response-contracts-audit.md).
- Seventeen AutoMode JSON operations validate accepted/status/stop/verification/
  commit/reconciliation/approval responses, including false booleans, nullable
  branches and commit hashes, different global/project statuses and legacy numeric
  concurrency. Execution streams remain outside this JSON claim. See
  [AutoMode audit](auto-mode-response-audit.md).
- Twelve GitHub and two MCP operations validate their response envelopes and
  owned nested records. Upstream GitHub records and saved validation analysis
  retain their existing opaque storage boundaries. Missing MCP discovery tools
  remain missing rather than becoming an empty list. See
  [integration audit](integration-response-contracts-audit.md).
- Nine provider usage/model/status/configuration/verification operations now
  execute shared response schemas. Nullable usage, historical cached model array
  entries and existing error bodies/statuses are retained. See
  [usage audit](provider-usage-response-audit.md).
- OpenAPI distinguishes status-only passthrough from manual body ownership.
  Inspected status setters can retain Nest serialization and a shared body schema
  under `default`; fluent body writers and response alias escapes still fail the
  ownership proof. Fifteen generator/ownership checks include these boundaries.

## Verification

| Check                                                       | Result                                      |
| ----------------------------------------------------------- | ------------------------------------------- |
| Full server unit suite                                      | 3927 passed, 40 existing skips              |
| Final full server contract suite                            | 645 passed                                  |
| Full package/UI suite                                       | 1599 passed                                 |
| Server/shared and UI production builds                      | Passed                                      |
| Server/UI lint and UI typecheck                             | Passed                                      |
| Architecture / OpenAPI checks                               | 13 / 15 passed                              |
| Repository-wide format, diff, lockfile and inventory checks | Passed                                      |
| Production SIGTERM/SIGINT smoke                             | Exit 0; 223.4 / 254.6 ms                    |
| Idle performance budget                                     | Passed; no unexpected resources after close |

The query-input fixture now supplies the actual Codex model reply fields instead
of an incomplete success-only mock. Its six query compatibility cases pass under
the response schema. No production behavior, timeout or retry setting was changed
to accommodate that fixture.

The complete contract suite passed after correcting that fixture. Focused results
are not added to the full-suite totals. Final idle sample: import 673.3 ms,
composition 58.4 ms, listen 2.56 ms, health p95 2.00 ms, RSS 212754432 bytes,
shutdown 4.99 ms. The idle regression budget does not establish a workload SLO or
replace fresh final Docker/Electron acceptance.

## Remaining scope

OpenAPI now records 318 operations, 296 shared/no-input operations, 22 incomplete
inputs, 172 shared runtime response operations and 146 unverified responses. The
runtime count includes typed non-2xx envelopes where the handler owns status.
This is progress on contract coverage, not completion of the original goal.

Remaining shared inputs/responses, test-only route retirement, configuration/
platform boundaries, non-Linux process ownership, state/use-case boundaries,
workflow observability, workload acceptance and fresh final packaging/operational
evidence remain in scope. No model calls, vendor authentication, user container/
listener/profile changes, push or deployment are required for this checkpoint.
