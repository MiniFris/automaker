# Native Direct checkpoint storage ownership

Date: 2026-10-25. Scope: Direct agent checkpoint save/load persistence and its
native lifecycle; no new public checkpoint or deletion endpoint was added.

Previously, `prepareDirectExecution` created a fresh `AgentCheckpointStore` backed
by process-global platform `secureFs`. Its per-instance write lane was not an
application owner, so accepted checkpoint writes could outlive the query that
initiated them or encounter the filesystem shutdown barrier during provider
finalization.

Native preparation now receives an explicit `AgentCheckpointRepository` trusted
code dependency. The application-owned `DirectCheckpointRepository` is provided
and exported by ProvidersModule and uses `RuntimePathsService` plus that
application's `SECURE_FILESYSTEM`. Native query, planning, ideation and agent
factories pass it through their existing preparation paths. Workspace path policy
remains a separate concern; the repository is not recovered from request data,
model options, global registries or DirectWorkspaceAccess.

`AgentCheckpointStore(dataDirectory, filesystem, limits)` retains the standalone
global filesystem default for compatibility. Native code supplies the independent
scoped adapter and a shared repository rather than creating one owner per query.

## Persistence and bounded admission

The store owns complete save/load operations and serializes them per session.
Default admission is bounded to 64 accepted operations, including queued work and
retained uncertain outcomes. Loads wait behind earlier admitted session writes.
Once closing begins, new operations are rejected while previously accepted work
is drained. The default drain deadline is five seconds; a failed/timed-out close
is cached and cannot later become a clean-close claim when delayed IO settles.

Snapshots retain the existing strict schema, 16 MiB payload limit and balanced
tool-history checks. Reads check regular-file/size constraints and use scoped
streaming IO with a 16 MiB plus one-byte detection bound, rather than an unbounded
readFile allocation. Symlink checkpoint files/directories are rejected.

Before replacing an existing checkpoint, the store validates its content and
session binding. Corrupt data, unknown read errors, changed endpoint/model/
workspace/request/tool/environment identities and decreasing counters reject the
save before opening a replacement temp file. Missing files are distinguished by
ENOENT, not by swallowing arbitrary IO errors.

Writes use a unique UUID temporary filename, exclusive creation, file mode 0600
and atomic rename; newly created directories request 0700. Temporary-file cleanup
is attempted on failure. An ambiguous rename acknowledgement or unconfirmed temp
cleanup retains that session's uncertain outcome. Replacement writes and loads
are blocked, and owner close fails rather than reporting that persistence was
confirmed. There is no automatic rollback, overwrite or tool-effect replay.
This is atomic filesystem persistence; no new power-loss/fsync guarantee is
claimed.

## Provider finalization before the filesystem barrier

The native repository's onModuleDestroy hook first awaits the registry's cached
provider scope disposal through explicit cached `ProviderRegistry.close()`. The later
Nest hook returns that same promise without invoking disposal again. The latch is
installed before synchronous abort callbacks, so reentrant close shares its identity.
This stops new queries and lets already accepted providers perform their final
checkpoint callbacks while storage still admits them. The repository then closes
its own admission and drains accepted operations. All of this precedes the
scoped filesystem's beforeApplicationShutdown barrier. A provider drain failure
is retained but does not skip checkpoint drain. A checkpoint drain failure also
remains an application cleanup failure.

The agent loop's existing pending-effect protocol is unchanged: balanced
interrupted/unknown tool-result intent is saved before effects run. Checkpoint
callbacks return the actual save promise. Cancellation or a provider-side wait
timeout does not silently discard an already admitted storage operation. Native
shutdown owns its eventual drain or reports uncertainty.

## Verification

The new native contract suite passed four cases:

- Two actual Nest applications save/load the same session UUID into independent
  private roots through native query preparation. Making the actual global
  secureFs.mkdir function reject does not affect either scoped repository.
- An active offline provider performs its final checkpoint from its cancellation
  cleanup while app.close is running. Its native write is deliberately held;
  close remains pending and the filesystem barrier has not run. After release,
  the final checkpoint exists and the application closes successfully.
- A native rename commits and then throws an injected EIO acknowledgement error.
  Later saves are blocked, the retained disk snapshot is not overwritten, repeated
  app.close calls fail, and the filesystem barrier still executes.
- Provider shutdown is made to fail while a previously accepted checkpoint write
  is held. Storage still drains that write before the barrier; final close remains
  failed and the accepted checkpoint is present.

Those four cases plus existing active-agent and provider-scope shutdown contracts
passed together: **seven cases**. Checkpoint unit suites passed **17 cases**,
including corrupt/unknown-read no-overwrite behavior, ambiguous acknowledgement,
capacity rejection, private file permissions, accepted-work drain and sticky
shutdown timeout. Existing Direct agent-loop tests passed **41 cases / two
skipped**. Targeted production ESLint and server tsc --noEmit passed.

Local supporting logs: `/tmp/automaker-wave21-checkpoint-native-final.log`,
`/tmp/automaker-wave21-checkpoint-unit.log`,
`/tmp/automaker-wave21-direct-agent.log`,
`/tmp/automaker-wave21-checkpoint-lint.log` and
`/tmp/automaker-wave21-checkpoint-tsc-final.log`.

All provider fixtures are explicit offline adapters; no paid model, external
endpoint or operator profile is used. The hostile global test restores a spy on
the global adapter instead of changing the process-wide allowed-root policy,
whose legacy initializer cannot restore an unset policy exactly.

## Limits

The store is an application-local serializer, not a cross-process transaction or
compare-and-swap service. Concurrent external writers, hostile filesystem races,
crash recovery procedures and power-loss durability need separate acceptance.
No arbitrary IO cancellation is claimed: admitted operations either settle before
the deadline or leave cleanup unconfirmed. Standalone compatibility defaults are
not promoted to native ownership guarantees. Full migration checkpoints, OS
packaging and broader application storage boundaries remain separate work.
