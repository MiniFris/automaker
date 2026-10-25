# Preview configuration, planning/settings contracts and pipeline retirement

Branch: `refactor/backend-nestjs-migration`, after `43d31e00`.

## Implementation

- Native HTTP, WebSocket admission, managed dev servers, gateways and preview
  relays now share an immutable application-owned preview policy. Configuration
  changes in another application or in the ambient environment cannot change its
  origins, URL, binding or alias resolution. Reserved preview origins remain
  untrusted by the API after their sessions expire. Malformed origins are denied.
  Configuration validates every public origin and bounds reserved ports to 256
  within 1–64535, allowing the existing target-port offset of 1000.
  See [preview evidence](preview-policy-configuration-audit.md).
- Shared runtime response schemas now cover nineteen main Settings operations,
  twenty-seven AppSpec/BacklogPlan/Ideation operations and six Pipeline operations.
  The Settings count includes the existing retired credentials write returning
  HTTP 410. Historical stored values and extensible metadata retain their wire
  semantics. See [Settings](stage-5-settings-response-contracts-audit.md) and
  [planning/ideation](planning-ideation-response-audit.md).
- Removed seven old pipeline route files and moved their characterization checks
  to native HTTP, including validation, delegation and safe producer failures.
  Thirty-five native pipeline cases include actual filesystem CRUD and malformed
  application responses. Eighty-three test-only route files remain outside the
  production dependency graph.
- Native pipeline mutations now reject malformed JSON or unsupported stored
  structures with HTTP 503 before changing bytes. Previously a malformed file
  could become an empty default and then be overwritten by a mutation. Query-only
  fallback and explicit validated full replacement retain their behavior; the
  latter permits intentional recovery of a corrupt file.

## Verification

| Check                                                       | Result                                      |
| ----------------------------------------------------------- | ------------------------------------------- |
| Full server unit suite                                      | 3927 passed, 40 existing skips              |
| Full server contract suite                                  | 581 passed                                  |
| Full package/UI suite                                       | 1573 passed                                 |
| Server/shared and UI production builds                      | Passed                                      |
| Server/UI lint and UI typecheck                             | Passed                                      |
| Architecture / OpenAPI checks                               | 13 / 13 passed                              |
| Real local SSH managed preview, including Chromium/Vite/HMR | 6 passed                                    |
| Repository-wide format, diff, lockfile and inventory checks | Passed                                      |
| Production SIGTERM/SIGINT smoke                             | Exit 0; 187.5 / 301.8 ms                    |
| Idle performance budget                                     | Passed; no unexpected resources after close |

Tests ran after the coordinated source freeze; no timeouts or retries were
changed. SSH/browser fixtures use private directories and the dedicated
43200–43219 preview range. These checks do not replace fresh final Docker/Electron
acceptance or workload SLO evidence.

## Remaining scope

OpenAPI contains 318 operations: 296 shared/no-input operations, 22 incomplete
context inputs, 112 shared runtime responses and 206 unverified responses.
These counts describe actual runtime schema ownership, including the typed HTTP
410 retirement response; they do not assert complete API coverage.

The original goal remains active. Remaining response/input coverage, test-only
route retirement, platform/configuration boundaries, non-Linux process ownership,
state/use-case boundaries, workflow observability, workload acceptance and final
packaging/operational evidence remain required by the plan. No paid model/vendor
authentication, user container/listener/profile changes, push or deployment is
part of this checkpoint.
