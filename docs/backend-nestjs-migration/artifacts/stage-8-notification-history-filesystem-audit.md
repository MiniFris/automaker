# Notification and event-history filesystem ownership

## Implemented

`NotificationsModule` and `EventHistoryModule` supply their application `SECURE_FILESYSTEM` to required service constructors. Neither service imports ambient secure-fs or calls ambient directory helpers. Existing standalone fixtures explicitly supply their filesystem.

The small shared `ProjectEventStorage` helper serializes reads and complete mutations per canonical project path. Native factories inject `SecurityService.validateLocalPath` as the resolver, so a symlink alias and its target share the same lane even when the incoming request path is not rewritten. Direct constructors require an explicit resolver too; no ambient filesystem fallback is introduced. Independent projects proceed independently; admission is capped at 256 accepted operations per service. Writes use the existing injected atomic JSON writer, with unique non-recoverable `.write.*` temporary files and rename. A failed operation releases its lane. Shutdown rejects new admission and drains accepted operations with a five-second deadline.

Only genuine ENOENT produces a cloned empty default. EIO, access denial, malformed JSON and incompatible document shapes propagate, including mutation reads, so an unreadable notification file or event index cannot become overwrite permission. Stored event identifiers cannot traverse directories or name the reserved index file.

Notification storage format, creation payloads and `notification:created` emission after persistence remain unchanged. Event history retains the existing version 1 index, event documents, ordering/filtering and 1000-entry retention.

## Event/index commit boundary

The index is authoritative; this is deliberately a finite local commit protocol, not a cross-file crash journal.

- Creation reads and validates the index before publishing a new event. It writes the event before committing the updated index. If index commit reports failure, it reads the authoritative index before rollback: a referenced event is retained even if rename committed before reporting an IO error. An unreferenced new event is removed. Unconfirmed index/rollback cleanup reports an unknown outcome.
- Delete, clear and retention first commit the new index, then remove files that it no longer references. A failed index commit cannot delete referenced data. Cleanup failure propagates; it can leave unreferenced event files and does not falsely report success. No automatic orphan repair or new file format is introduced.

## Lifecycle and evidence

Both services drain in `beforeApplicationShutdown`, after all `onModuleDestroy` producers, including `BackgroundIntegrationsLifecycle`/`EventHookService`, and before native filesystem close. Native tests exercise that actual ordering with held renames.

- **60 targeted unit tests passed**, five files: storage queue bounds/deadline/project independence, history retention, independent defaults/corrupt-state preservation, existing event-hook behavior and lifecycle.
- **13 targeted contracts passed**, three files: ten new native filesystem cases plus existing project-store composition and app-spec provider-chain fixtures. New cases cover two isolated roots/event buses and shutdown, 20 concurrent notification creations plus mixed updates, 20 history creations plus concurrent deletes, EIO/EACCES/corrupt/invalid-shape preservation, failed index commits including post-commit IO error, failed cleanup reporting, and held writes during native close for both stores.
- Server TypeScript check, owned production-source ESLint and `git diff --check` passed. The first ESLint attempt from repository root had no config; the correct server-workspace invocation passed.

Follow-up alias correction: **11 native filesystem contracts and 10 focused storage units passed** after explicit resolver plumbing. The added native test holds the first read and starts concurrent canonical/alias mutations for both stores; no second read starts before release and every mutation persists. Owned lint and server TypeScript were checked again.

No full suites, external network/vendor calls, Docker, GUI or commits were run for this slice. Remaining ambient-FS services identified in the previous read-only audit are outside this change.
