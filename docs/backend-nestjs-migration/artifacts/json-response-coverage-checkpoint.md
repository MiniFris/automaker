# Complete JSON response schema checkpoint

Branch: `refactor/backend-nestjs-migration`, after `4dc61259`.

## Implementation

- All 50 Setup operations now execute shared response schemas. Existing target,
  consent, verification, manual install/authentication and passive presence
  semantics remain intact. Historical permissions read values retain their port
  boundary. See [Setup audit](setup-response-contracts-audit.md).
- All 59 Worktree JSON operations validate their actual producer envelopes and
  owned nested data: reads, mutations/workflows, host actions, text and process
  operations. Historical metadata-only bindings and unvalidated upstream PR
  internals remain opaque. Cancellation listeners still release in `finally`.
  See [Worktree audit](worktree-response-contracts-audit.md).
- Six Git and sixteen FS JSON operations validate real worker/filesystem output,
  including empty/unborn repositories, conflicts, optional merge state, operation
  outcomes and Date serialization. Image/download retain their binary protocols;
  private fixtures verify image/file/ZIP bytes, headers and cleanup. See
  [FS/Git audit](files-git-response-audit.md).
- Models available/providers, prompt enhancement and all ten Terminal JSON
  operations now parse shared schemas. Terminal session Dates become the same ISO
  strings as before; disabled/authentication, missing/closing session, admission,
  resize, settings and cleanup error statuses retain their behavior. Native
  response fixtures use private data and explicit producer fakes; existing actual
  terminal restart, PTY drain, stop and input tests remain part of verification.
- Manual JSON ownership has an explicit source proof: every body write uses the
  same imported shared parser; status-only setters and readonly connection state
  are permitted. Unparsed error branches, differing parsers, fluent writers,
  response aliases and external escapes remain unverified. Output schema metadata
  keeps global/middleware error ranges separate from parsed handler envelopes.

## Coverage boundaries

OpenAPI records 318 operations: **316 shared runtime JSON responses** and two
unverified binary responses. It still records 296 shared/no-input operations and
22 incomplete request-context inputs. This closes the missing JSON response
families, not the remaining binary/context work or the entire migration goal.

## Verification

| Check                                                 | Result                                      |
| ----------------------------------------------------- | ------------------------------------------- |
| Final full server unit suite                          | 3927 passed, 40 existing skips              |
| Final full server contract suite                      | 769 passed                                  |
| Final full package/UI suite                           | 1728 passed                                 |
| Shared/server and UI production builds                | Passed                                      |
| Server/UI lint and UI typecheck                       | Passed                                      |
| Architecture / OpenAPI ownership checks               | 13 / 16 passed                              |
| Repository formatting, diff, inventories and lockfile | Passed                                      |
| Final production SIGTERM / SIGINT                     | Exit 0; 228.8 / 252.1 ms                    |
| Final idle performance budget                         | Passed; no unexpected resources after close |

The final full suites include corrected legacy fixtures: terminal creation uses
the actual service Date type, catalog discovery supplies required model metadata,
and query mocks supply the complete catalog envelope. No timeout/retry settings
were changed. Model response schemas reuse the same record definition in Setup
and the general catalog, preserving nullable historical metadata. Focused results
are not added to these full-suite totals.

Final idle sample: import 726.5 ms, composition 67.6 ms, listen 2.75 ms,
health p95 1.83 ms, RSS 223608832 bytes, shutdown 4.84 ms. This is the existing
local idle regression budget, not a workload SLO or fresh Docker/Electron
acceptance.

## Remaining original scope

Binary contract metadata and request-context inputs remain explicit. Test-only
route retirement, native terminal/configuration/filesystem boundaries, OS process
ownership, state/use-case boundaries, workflow observability, workload acceptance
and fresh final packaging/operational evidence retain the original plan scope.
No paid models/vendor authentication, user container/listener/profile changes,
push or deployment are performed by these response-contract fixtures.
