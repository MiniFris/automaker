# Native authentication and Codex cache filesystem

## Implemented boundary

- Native `AuthStateRepository` injects `SECURE_FILESYSTEM`; `ProvidersModule` passes the same application-owned port explicitly to `CodexModelCacheService`. Native storage no longer consults the process-global filesystem policy.
- Existing `.api-key` and `.sessions` formats and authentication/token behavior remain intact. Session mutations retain their serialized commit-before-memory-update queue. Cache model transformation, TTL, refresh deduplication and `{models,cachedAt,ttl}` format remain intact.
- Generated keys, session replacements and cache replacements use mode `0600`. Cache writes use exclusive UUID temporary files and rename, with best-effort temporary-file cleanup after failure.
- Missing or malformed optional cache content triggers the existing model refresh path. Denied roots and non-ENOENT filesystem errors propagate. Cache persistence/read failures become a safe `UnavailableDomainError` (`503`, `UNAVAILABLE`), rather than a successful empty model list. Provider unavailability still returns an empty list; uncertain provider cleanup still propagates.

## Shutdown ownership

Both owners stop admission and drain accepted work in `beforeApplicationShutdown`, before the secure filesystem barrier, with a five-second bound. Repeated lifecycle calls return the same settled close promise; a timeout remains a failure even if a held write later completes. `onApplicationShutdown` delegates to that same close operation for existing callers.

`AuthModule` explicitly imports `SecurityModule`, and `AppModule` registers Security before Auth. The real native-close contract holds both owners' rename operations and asserts that their drain hooks finish before the application's secure filesystem `close()` runs. This tests the actual Nest module ordering, rather than inferring safety from constructor injection alone.

## Validation

Using Node 22.22.3, without vendor/model requests:

- 34 unit cases passed across auth-state, Codex lifecycle, owned app-server and bounded auth/cache shutdown tests.
- 7 native contract cases passed across the new auth/cache filesystem contract, provider usage ownership and passive provider usage. The final three-case auth/cache contract also passed after adding malformed-null optional-cache recovery coverage.
- Native cases cover two application roots, independent keys/sessions/cache, filesystem identity, file permissions, denied foreign roots, injected EIO without false commit, successful retry, held writes through real application close and rejected post-close admission.
- Server `tsc --noEmit` passed. ESLint passed for the five changed production files.

## Limits

Standalone direct constructors retain their legacy filesystem defaults for existing non-native callers; native factories always supply the owned port. This change does not migrate the legacy authentication route factories or introduce cross-process coordination. Filesystem cleanup failures are reported; the five-second bound does not prove that an underlying blocked OS operation has terminated.
