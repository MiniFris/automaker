# Backend architecture

The server starts at `apps/server/src/main.ts`; `AppModule` composes Nest modules.
HTTP controllers use the Express platform adapter. `/api/events` and
`/api/terminal/ws` retain raw WebSocket protocols and have an application-owned
transport lifecycle. There is no production `LegacyModule` or manual Express
router registration. The old `src/routes` tree has been removed; characterization
tests exercise native modules and HTTP boundaries. The architecture check prevents
reintroducing that tree or imports from it.

## Adding behavior

Put HTTP parsing and response shaping in the owning module's controller. Put
application decisions in its service/use case, and external effects behind an
explicit filesystem, project-file, execution or provider port. Reuse the existing
module owner instead of creating another instance of a stateful service.
Controllers must not execute shell commands or implement filesystem transactions.
Application code must not import a controller or a route factory.

Configuration comes from the typed core config services. New services must receive
their configuration explicitly instead of reading ambient `process.env`, current
directory or a singleton getter. Each native application owns its provider registry,
metrics, event bus, session stores and process registries. Tests can compose two
applications in one process; they must not share ownership accidentally.

For project data, use the application's `SECURE_FILESYSTEM` or `PROJECT_FILE_PORT`.
The filesystem validates canonical paths against application roots. Do not use
standalone secure-fs defaults in native factories. Feature mutations go through
FeatureLoader's transaction lane; settings mutations use their repository queue.
An atomic rename prevents partial JSON, but does not replace serialization of a
read-modify-write operation. Emit success events after the commit. Only genuine
absence is optional; permission and ambiguous IO failures must not become an empty
authoritative store or trigger replay.

Use existing Local/Docker/SSH execution ports for commands and PTYs. Capture the
selected execution binding for an accepted operation. Never silently fall back to
Local, repeat a command with an unknown result, or recreate an uncertain process
identity. Close only resources owned by the application or accepted operation.

## Lifecycle

Reject new work when its owner starts draining. Producers stop and drain in
`onModuleDestroy`; persistence owners that finalize their accepted writes drain
before the shared filesystem's `beforeApplicationShutdown` barrier. Dependent
stores must drain in dependency order: for example, execution settlement can still
write delivery/history records, so the agent repository must remain open until
those writes finish. Do not rely on concurrent hooks inside one module to establish
that order. An unconfirmed cleanup must remain visible as a failure/unknown outcome.

Lifecycle tests should hold an actual accepted write or operation while closing the
application, prove close waits, and verify another application remains usable.
An idle close alone does not prove active resource cleanup.

## Public contracts and storage

Use shared Zod schemas from `@automaker/contracts` for new request/response contracts
and execute those schemas at runtime. Preserve existing accepted values, errors,
unknown extension fields and historical storage when migrating a handler. Update
UI callers together with an intentional versioned contract change. The generated
OpenAPI document marks incomplete inputs and unverified responses explicitly;
its presence does not establish full schema coverage.

See [API policy](backend-api-contracts.md),
[storage downgrade preflight](backend-storage-downgrade.md) and
[observability](backend-observability.md). Do not put prompts, credentials, command
arguments or raw unexpected exception text in correlation diagnostics.

## Verification

After a bounded change, run relevant negative/concurrency/recovery tests, then the
required checkpoint for the migration stage. Useful entry points are:

```sh
npm run build:server
npm run test:server
npm run test:packages
npm run lint:server:errors
npm run lint:errors
npm run typecheck
npm run test:backend:architecture
npm run check:backend:openapi
npm run inventory:server:check
npm run inventory:server-deps:check
npm run inventory:api-consumers:check
node scripts/smoke-server-lifecycle.mjs
```

Regenerate inventories after relevant source changes before checking them. Packaging
changes additionally require actual artifact acceptance, not just TypeScript tests:
the Docker and packaged Electron runners are `scripts/smoke-production-docker.mjs`
and `scripts/smoke-packaged-electron.mjs`. Use owned temporary profiles/data and an
explicit local image/executable. Run Docker/SSH network jobs before Chromium on the
same host. Provider tests use offline fixtures by default.

The [migration plan](backend-nestjs-migration/README.md) tracks outstanding work and
the evidence for completed slices. During this migration all commits stay on
`refactor/backend-nestjs-migration`; an additional PR is not required.

## Deployment HTTP policy

The native backend preserves the existing HTTP policy. Terminate public HTTPS at
an operator-controlled reverse proxy and forward both HTTP and WebSocket upgrades
to the private backend listener. Set `NODE_ENV=production` for deployed instances:
session cookies are HttpOnly, Secure and SameSite=Lax, independently of forwarded
protocol headers. A production cookie will not work over plain browser HTTP.

Express `trust proxy` remains false. Forwarded client IP/protocol headers are not
trusted; login/setup rate limits use the direct peer. Behind a proxy this may mean
one shared rate-limit identity. Do not assume per-client limiting from
`X-Forwarded-For`; enforce appropriate limits at the trusted ingress too. There is
no new trust-proxy environment switch in this migration.

`CORS_ORIGIN` is a comma-separated list of exact origins. Existing compatibility
also allows localhost, loopback and private IPv4 origins; the list is therefore
not an exclusive origin allowlist. `*` reflects the supplied origin with
credentials enabled. Omitted Origin remains supported for native clients. Foreign
origins are rejected; CORS is not an authentication mechanism. Preview-origin
blocking runs before CORS and authentication. The server does not emit
`Access-Control-Allow-Private-Network`; browser private-network permission is not
promised by this configuration.

POST/PUT/PATCH require a JSON content type; form, multipart and text submissions
are rejected with 415 before cookie-authenticated handlers run. Cookies retain
SameSite=Lax rather than gaining a new CSRF-token protocol. HTTP authentication
and one-time WebSocket-token expiry/reuse remain separately enforced. HTTP CORS
does not gate WebSocket upgrades: preview-origin denial applies, while a valid
foreign WebSocket Origin is not subject to an exclusive allowlist in the current
compatibility protocol. A valid credential/token is still required. Avoid public
unauthenticated deployments and protect access to the private listener.

Executable evidence: `deployment-http-policy.contract.test.ts` covers exact and
local origins, foreign/null/malformed origins, credentialed preflight, absent
private-network permission, disabled proxy trust, production cookie attributes
and rejected form submissions. `request-context.contract.test.ts` checks peer
identity despite spoofed forwarding headers; preview and WebSocket contracts
cover their respective boundaries. These loopback checks do not attest a
particular external TLS proxy or browser deployment.

## Runtime configuration reference

The bootstrap parser is `core/config/runtime-config.ts`; invalid values fail before
HTTP resources are allocated. Booleans accept `true`, `false`, `1`, `0`.

| Variables                                                                           | Defaults and purpose                                                        |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `NODE_ENV`                                                                          | `development`; `production` enables Secure session cookies                  |
| `HOST`, `HOSTNAME`, `PORT`                                                          | `0.0.0.0`, `localhost`, `3008`; port 0 requests an ephemeral listener       |
| `DATA_DIR`, `ALLOWED_ROOT_DIRECTORY`                                                | `./data`, unset; relative paths resolve from the captured working directory |
| `CORS_ORIGIN`                                                                       | Unset; additional exact origins, subject to the compatibility policy above  |
| `AUTOMAKER_API_KEY`                                                                 | Optional; otherwise the application manages its persisted key               |
| `AUTOMAKER_DISABLE_AUTH`, `AUTOMAKER_AUTO_LOGIN`, `AUTOMAKER_HIDE_API_KEY`          | All false                                                                   |
| `TERMINAL_ENABLED`, `TERMINAL_PASSWORD`, `TERMINAL_MAX_SESSIONS`                    | true, unset, 1000; maximum accepted count 10000                             |
| `ENABLE_REQUEST_LOGGING`, `AUTOMAKER_DEBUG_RAW_OUTPUT`                              | true, false                                                                 |
| `IS_CONTAINERIZED`, `AUTOMAKER_SKIP_SANDBOX_WARNING`, `AUTOMAKER_DOCKER_CONTROLLER` | false, false, unset                                                         |
| `AUTOMAKER_PREVIEW_PORT_FIRST`, `AUTOMAKER_PREVIEW_PORT_LAST`                       | 3100–3119 inclusive                                                         |
| `AUTOMAKER_PREVIEW_PUBLIC_URL`, `AUTOMAKER_PREVIEW_BIND`                            | URL template unset; bind loopback or `0.0.0.0` when containerized           |

Provider credentials remain optional at boot. The captured host environment supplies
CLI PATH/home/tooling separately from managed credentials; do not log either.
Native child environments remove backend `PORT`, `DATA_DIR`, `AUTOMAKER_API_KEY`
and `NODE_PATH`. A dev-server owner explicitly assigns its selected child PORT.
Saved provider settings may rotate credentials without changing the application's
captured host profile. Relative Codex profile paths resolve from the captured
application working directory, consistently for discovery and CLI/SDK invocation.
