# Bounded request context migration (wave 16)

The 22 remaining controller `@Req()` parameters are removed. This changes extraction ownership, without changing credential precedence, admission policy, HTTP statuses, response payloads, or cancellation behavior.

| Former Request consumers                                         | Owned replacement                                                                                                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | -------------------- | --- | ---------- |
| Settings main 2 and execution-environment 11                     | Removed unused parameters; existing validated bodies and response-close AbortController lifecycle retained                                                                     |
| Setup credentials store/delete; Claude/Codex/GitHub verification | `@ClientIdentity()` supplies exactly Express `ip                                                                                                                               |     | socket.remoteAddress |     | 'unknown'` |
| Auth login                                                       | Same `@ClientIdentity()`; login attempts and body validation unchanged                                                                                                         |
| Auth status                                                      | `@HttpAuthentication()` supplies explicit absent/string/invalid credential slots; AuthService checks header API key, header session, query API key, query session, then cookie |
| Auth logout                                                      | `@SessionCookie()` supplies only the selected cookie, preserving opaque legacy JSON-cookie values                                                                              |
| Terminal logout                                                  | `@TerminalLogoutToken()` supplies only the original string header/body selector; empty header falls back to body, wrong types ignored                                          |

The four decorators live in `apps/server/src/core/http/request-context.decorators.ts`. Each extraction path calls a public schema in `libs/contracts/src/domains/request-context.ts`. Truthy non-string auth material remains invalid at its original priority; it neither becomes a new 400 nor falls through to lower-priority valid material. Falsey auth material remains absent. AuthService retains the existing HTTP guard and WebSocket upgrade APIs, sharing the same extraction/classification and authentication logic.

These schemas validate transport context boundaries, not authorization. Cookie logout content intentionally remains opaque because earlier JSON cookies were forwarded as-is; cookie authenticity still belongs to AuthState. This slice does not claim that existing opaque Settings business payloads have become richer shared request schemas.

## Evidence

- New `request-context.contract.test.ts`: 17 offline native tests covering status source precedence, repeated queries, JSON cookies, login and all Setup5 identity consumers under spoofed forwarding headers, terminal logout ignored types/empty fallback, validation-before-admission, and real AuthState invalid arrays/objects at every priority.
- Existing native Setup53, Settings21 and execution-environment23 cases passed with the new extraction; no provider/runtime network calls used.
- Focused core units: 69 passed, including 22 new extractor cases and existing AuthService/AuthGuard coverage.
- Shared schema tests: 2 passed, including invalid slot shape and opaque cookie/string terminal boundary.
- Owned production ESLint and server TypeScript: exit 0. Root performed the coordinated shared build.
- Logs: `/tmp/automaker-request-context-{unit,native,native-final,shared,lint,types}.log`.

No generated OpenAPI inventory or metadata exceptions are introduced by this slice. Root owns implementation-based generator recognition of these validated context decorators.
