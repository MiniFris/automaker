# Native settings filesystem boundary

Native `SettingsFileRepository` receives `SECURE_FILESYSTEM` and canonical paths
from its application's `SecurityService`. Reads, existence checks, directory
creation, backup rotation, temporary writes, rename and cleanup use that same file
boundary. `atomicWriteJson` and `mkdirSafe` accept an injected filesystem while
existing library callers retain their previous default.

Native reads and existence checks propagate policy, lifecycle and real I/O errors;
they no longer report a denied/unavailable file as missing. JSON recovery defaults
remain compatible for non-private settings; strict private reads still reject
malformed JSON without exposing its content.

`SettingsMutationQueue` serializes whole read/modify/write transactions by global,
credential or canonical project key. Total accepted work is bounded at 256;
shutdown closes admission and drains accepted transactions for up to five seconds
in `beforeApplicationShutdown`, after upstream credential command drains and before
the filesystem barrier. The real accepted-credential shutdown contract caught an
earlier `onModuleDestroy` placement that closed settings too soon; its successful
retest, together with the settings drain contract, verifies the actual Nest order.
A deadline failure remains
failed after late I/O settles. It does not claim OS syscall cancellation.

Provider timeout changes share the global transaction queue. Query-triggered global
schema migration re-reads the latest committed settings inside that queue; it
cannot overwrite a concurrent command using an earlier query snapshot. Existing
project symlink aliases share the canonical queue key.

Targeted checks:

- Settings service and transaction ownership units: **62 passed**.
- Atomic writer, injected atomic writer and filesystem utilities: **63 passed**.
- Native settings ownership contracts: **4 passed**; independent application policy/close,
  private backup permissions, project alias races, shutdown drain and concurrent
  migration snapshot.

Read-only peer review also identified that `updateJsonAtomically` must pass the
injected boundary to its initial read. That read now uses the same filesystem and
rejects denied/unavailable I/O before invoking the updater; a real-file regression
test proves the updater cannot receive data outside its injected policy.

This is the normal settings repository/write path. The legacy Electron data import
method still reads the old host profile with raw filesystem/environment access;
remaining utility consumers still using default `secureFs`, broader cross-writer
leases and external-process file races are separate unfinished boundaries. The
injected writer does not make those consumers application-scoped automatically.
