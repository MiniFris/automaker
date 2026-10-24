# Stage 10: downgrade preflight and snapshot rollback

Original requirement: `10-cutover-and-hardening.md`, section 10.7, agent queue
delivery quarantine, deletion tombstones and pending execution intents.

Implemented `scripts/check-backend-downgrade.mjs`: standalone read-only Node CLI
and importable inspector with mandatory explicit directory and capability target
`legacy-no-agent-ledgers`. No Nest/bootstrap/recovery imports, environment default,
automatic snapshot, deletion, conversion or target process launch exists.

The guard rejects recognized version-1 ledgers in all three safety directories,
including settled ledgers; quarantined queue items and delivery/execution history
fields also block when journals are absent. Owned atomic backup/temp variants are
inspected. Unknown versions, malformed records, unreadable/unsupported paths and
ambiguous storage artifacts return unconfirmed rather than a compatibility pass.
Output contains reason codes, artifact paths and known phases, never source data.
An entry changed during its read is reported unconfirmed; this is not a writer
lock or a claim of a concurrent full-directory snapshot.

Operations procedure: [backend-storage-downgrade.md](../../backend-storage-downgrade.md).
It preserves the upgraded profile and restores an entire matching prior snapshot
into a fresh sibling, instead of overlaying older JSON files and leaving markers.
Per-file `.bakN` rotation is explicitly distinguished from a whole DATA_DIR
snapshot. External workspace/remote effects are not represented as reversible by
restoring backend storage.

Targeted offline command `npm run test:backend:downgrade`: **28 passed**, zero
skipped. Fixtures cover clean legacy storage, all marker phases, missing primary
files with backup/temp markers, corrupt main files with clean backups, unknown
versions, reserved/mismatched IDs, orphan quarantine/history fields, symlinks,
argument handling and real CLI exit status/output. Byte hashes and file modes
remain unchanged by inspection. A whole-snapshot restore equals the original
manifest and passes; an overlay of the same snapshot remains blocked.

This closes the executable agent-storage preflight and owned-fixture restore
portion. It does not claim universal old-version compatibility, live-profile
inspection, a new conversion implementation, or completed operator staging
rollback of an actual previous artifact. Existing packaging/performance/rollout
gates remain independent. No production profile, network service, GUI, container,
dependency/lockfile or branch was used or changed for this work.
