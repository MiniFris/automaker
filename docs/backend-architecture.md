# Backend architecture

The server starts at `apps/server/src/main.ts`; `AppModule` composes Nest modules.
HTTP controllers use the Express platform adapter. `/api/events` and
`/api/terminal/ws` retain raw WebSocket protocols and have an application-owned
transport lifecycle. There is no production `LegacyModule` or manual Express
router registration. Old route files still referenced by characterization tests
are excluded from production compilation; new code must not import them.

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
