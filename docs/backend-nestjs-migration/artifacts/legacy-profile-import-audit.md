# Native legacy Electron profile boundary

Replaces the remaining `SettingsService.migrateFromLegacyElectronPath` ambient
env/raw-fs implementation with a narrow injected host-read port and a separate
native destination importer. Selected items and no-overwrite semantics remain.

Host configuration is captured once. Missing explicit HOME/USERPROFILE/config
does not fall back to the operator's home. Source profile identity, non-symlink
path segments and opened file identity are checked; only the six known legacy
items are admitted. Native writes use SECURE_FILESYSTEM, private modes and a
scoped atomic same-volume `link` primitive that preserves EEXIST destinations.

The initialization barrier precedes native repository reads/mutations when
startup tasks are enabled. It does not recursively acquire a settings queue.
Importer errors bypass defaults/fallback. Explicit invocation supports disabled
startup fixtures without automatically reading any user profile.

Transaction boundary: private staging → durable publishing intent → per-file
no-overwrite links, settings last → complete intent → payload cleanup. Cold
publishing recovery ignores the old settings-exists skip, verifies staged hashes
and does not require the source to remain available. Stage failures, commit
failures and cleanup failures remain retryable, without false successful reads.
Unsupported hard links have no unsafe copy fallback. Unknown intents fail closed.

Evidence: **14 native importer contracts + 4 existing native settings FS contracts
passed**, **68 settings/source/barrier units passed**, and the new real scoped
hard-link test **1 passed**. Cold restart recovery additionally rerun with the
source directory removed and host config changed after staging: **1 passed**
(included in the 14 cases). Existing runtime lifecycle **11 units passed**, and
the blocking-startup failure contract was rerun using an owned HOME/config: **1 passed**.
Cases cover partial staging/publication, failure after settings publication,
private cleanup retry, existing subtrees/files, EEXIST publication races, corrupt
source/config/intent, source and destination symlinks, coalesced calls, concurrent
native reads/writes and post-close admission. All profiles and HOME/config paths
are owned; a corrupt-import startup additionally proves Agent.initialize is never
called and defaults/readiness are not accepted. All fixture profiles
are test-owned temporary directories; no operator profile or production DATA_DIR
was inspected. Platform build, server TypeScript and targeted source ESLint passed.

See [operations and recovery](../../legacy-electron-profile-import.md). This does
not claim a concurrent source snapshot, all legacy settings constructors migrated,
or blanket storage/backward-binary compatibility. The existing downgrade inspector
now recognizes the known import transaction marker: pending phases block, unknown
intents are unconfirmed, valid complete is not interpreted as full compatibility.
Its focused offline suite is **36 passed**, including eight new intent fixtures.
