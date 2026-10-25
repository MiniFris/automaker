# Backend API contracts

The HTTP API currently advertises contract version `13` through
`X-Automaker-API-Version`. Moving a handler into Nest or moving an unchanged schema
into a shared package does not change that version.

Shared runtime schemas live in `libs/contracts/src`. Domain-specific schemas use
public imports such as `@automaker/contracts/domains/worktree`; the root import
continues to expose existing contracts. Server-local `*.schemas.ts` files re-export
these schemas to preserve existing imports. Clients should import the shared
package rather than server source. Runtime refinements remain authoritative:
JSON Schema cannot express every cross-field Zod refinement.

## Generated OpenAPI artifact

After building shared packages, run:

```sh
npm run inventory:server
npm run generate:backend:openapi
npm run check:backend:openapi
```

The committed artifact is
`docs/backend-nestjs-migration/artifacts/openapi.json` (OpenAPI 3.1). Generation
reads the native route inventory and controller syntax, then loads only shared
schemas. It never starts an application or imports controllers/providers.
`inventory:server:check` and `check:backend:openapi` run in CI. A route/schema change
must regenerate the artifact in the same branch as its implementation.

Every native HTTP route has an operation. `x-request-contract` explicitly marks
unresolved inputs, including raw request access; `x-unresolved-inputs` identifies
the gap. Responses remain `x-response-contract: unverified` until backed by a
shared response schema and a wire contract test. Unconstrained schemas are not a
claim that an arbitrary payload is accepted. Do not generate a strict response
client or declare complete contract coverage from this artifact yet.

## Compatibility and deprecation

Changes to existing fields, defaults, errors, authentication, statuses and stream
framing require wire contract tests. Additive optional fields may remain on the
current version when older clients can continue reading responses and sending
requests. A previously optional field becoming required, narrowed accepted values,
changed defaults, removed routes or changed response shapes require an explicit
version decision before implementation.

For an intentional breaking change, record the old/new behavior, affected clients,
version identifier, migration path and removal date in the migration documentation.
Keep the previous behavior available for the documented transition window; verify
both versions and update bundled web/Electron clients together. If no transition
window has been agreed, preserve existing behavior. A deprecation must identify a
replacement and a removal date before a route is removed. No separate PR is
required: implementation, documentation and tests remain in the migration branch.

## Errors

Use existing domain error codes from `core/errors/domain-errors.ts` for new domain
failures. Preserve `code` and `errorCode` distinctions on existing routes until an
explicit compatibility change is made. Include the request correlation id when
available and avoid provider output or credentials in public error messages.
The global filter and existing route-specific responses have different historical
envelopes; the shared optional error envelope is not proof that every endpoint
already emits one normalized format.

Native global HTTP failures now carry an additive `errorCode`, including Nest
404/readiness responses and parser failures. Existing nonempty intentional HTTP
`errorCode`, domain `errorCode` and infrastructure `code` retain their meanings;
status, messages and historical response fields remain unchanged. Common middleware
415 and preview-denial403 responses also carry the corresponding category.

| HTTP status           | Fallback errorCode                                              |
| --------------------- | --------------------------------------------------------------- |
| 400                   | `VALIDATION_ERROR`                                              |
| 401 / 403 / 404       | `UNAUTHORIZED` / `FORBIDDEN` / `NOT_FOUND`                      |
| 405 / 409             | `METHOD_NOT_ALLOWED` / `CONFLICT`                               |
| 408 / 504             | `TIMEOUT`                                                       |
| 413 / 415 / 429       | `PAYLOAD_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE` / `RATE_LIMITED` |
| 502 / 503             | `UPSTREAM_ERROR` / `UNAVAILABLE`                                |
| Other 5xx / other 4xx | `INTERNAL_ERROR` / `HTTP_ERROR`                                 |

The fallback category is deliberately broader than a specific infrastructure code.
Clients must not infer that a failed command can be replayed from an HTTP category;
unknown execution outcomes retain their existing no-replay policy. Controller-owned
legacy business-failure bodies, including historical HTTP200 responses, retain their
specific existing fields; this does not silently normalize their format or require
all old clients to understand the new field.
