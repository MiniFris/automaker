# Transport contexts, binary contracts, terminal configuration and workflow metrics

Branch: `refactor/backend-nestjs-migration`, after `6ccaf59d`.

## Implementation

- Removed all 22 raw Request parameters: thirteen were unused cancellation-helper
  arguments; the others now receive narrow parsed client identity, authentication,
  cookie or terminal token contexts. Header/query/cookie precedence, truthy invalid
  credential rejection, Express IP fallback and ignored legacy token types remain
  unchanged. Source inspection follows actual `createParamDecorator` return paths
  through local projection helpers to shared parsers; unknown decorators are not
  silently counted as validated. Normalized context schemas are identified as such
  in OpenAPI, rather than pretending they are raw wire bodies. See
  [request-context evidence](request-context-audit.md).
- Image and download use shared binary runtime descriptors. Image bytes, MIME,
  cache and length are checked before send. File/ZIP headers are checked before
  the existing bounded stream; its maxBytes comes from the validated descriptor.
  Streaming cancellation, temporary cleanup and existing byte budgets remain.
  OpenAPI uses shared media/header definitions and binary payload schemas. The
  reviewed executable source graph is pinned independently of comments/formatting;
  bypassed parsing, unchecked send or unbounded stream changes invalidate coverage
  and require renewed source review and byte/lifecycle checks. See
  [binary evidence](files-binary-response-contracts-audit.md).
- Native terminal shell/WSL discovery, child environment and locale now use the
  application snapshot and a narrow host port. RC generation uses scoped FS,
  canonical cwd, per-project serialization and unique atomic temporary files;
  its existing content/version format is preserved. Accepted configuration work
  drains before FS closes and cannot create a late PTY. Two real private PTYs,
  denied symlinks, EIO and held RC IO exercise the boundary. See
  [terminal evidence](terminal-host-configuration-audit.md).
- Metrics add passive application-owned gauges for active agent executions,
  mutation lanes, loaded sessions/queues, terminal sessions, local dev/test state,
  pending starts, unknown cleanup, startup tasks and resumed jobs. There are at
  most 32 gauge registrations; unavailable diagnostics produce null, not zero.
  Readers do not discover, signal or prune processes or read repositories.
- Startup duration and agent execution/mutation observations carry correlation
  context. A native HTTP → real agent coordinator → offline provider workflow
  proves one request id, held active counts, queue depth, confirmed stop and
  isolation from a second application. Unit fixtures prove correlated operation/
  provider logs without payload/id metric labels and passive diagnostics without
  process inspection. Local unknown-cleanup gauges describe retained owner state,
  not an OS-wide leak census; queue depth describes loaded sessions, not a scan of
  every persisted queue.

## Coverage

OpenAPI records 318 shared/no-input operations, zero incomplete context markers,
316 shared JSON runtime responses, two shared binary responses and zero unverified
response operations. Intentional opaque business metadata remains opaque. Default
middleware/global error envelopes retain their separate documented limits; these
route counts do not assert uniform machine-readable errors or stricter legacy data.

## Verification

| Check                                                    | Result                                      |
| -------------------------------------------------------- | ------------------------------------------- |
| Full server unit suite                                   | 3956 passed, 40 existing skips              |
| Full server contract suite                               | 796 passed                                  |
| Full package/UI suite                                    | 1750 passed                                 |
| Server/shared and UI production builds                   | Passed                                      |
| Server/UI lint and UI typecheck                          | Passed                                      |
| Architecture / OpenAPI and source-proof checks           | 13 / 21 passed                              |
| Repository format, diff, inventories and lockfile checks | Passed                                      |
| Production SIGTERM / SIGINT smoke                        | Exit 0; 310.7 / 361.7 ms                    |
| Idle performance budget                                  | Passed; no unexpected resources after close |

Final idle sample: import 643.3 ms, composition 59.6 ms, listen 3.16 ms,
health p95 1.42 ms, RSS 228290560 bytes, shutdown 5.05 ms. This is the existing
idle regression budget, not sustained workload or fresh packaged-artifact proof.
Focused results are not added to full-suite totals. No timeout/retry changes were
made; all external provider behavior in these fixtures is explicitly offline.

## Remaining original work

The goal remains active. Remaining test-only route retirement, logging policy and
other configuration boundaries, workflow/execution observability, OS ownership
limitations, workload acceptance, final artifact refresh and operational/doc gates
remain subject to the original plan. No paid model/vendor authentication, user
container/listener/profile changes, push or deployment occurred in this checkpoint.
