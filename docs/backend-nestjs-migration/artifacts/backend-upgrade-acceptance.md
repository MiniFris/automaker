# Private Docker upgrade, restart and snapshot rollback acceptance

Runner: [smoke-backend-upgrade.mjs](../../../scripts/smoke-backend-upgrade.mjs).

```sh
node scripts/smoke-backend-upgrade.mjs \
  --old-image automaker-nest-wave7-production-smoke:latest \
  --new-image automaker-nest-wave17-production-smoke:latest
```

Both images must already exist locally. The runner resolves and pins their different
SHA-256 image IDs before creating resources; `--pull=never` prevents implicit pulls.
It creates a private labelled bridge network, three private labelled named volumes and
labelled containers. App ports publish only to loopback with random host ports;
helper containers have no network. Every mount is a verified owned named volume.
The app network is not an egress firewall. Fixtures configure no external services;
all explicit requests use the local backend API. There are no host/operator mounts,
live profile reads, vendor/model calls or
external deployment actions. A random private API key is never printed.

## Procedure

1. Start the selected old artifact with the first private volume. Seed global
   settings, project settings and a backlog feature through its actual API.
2. Stop it cleanly (SIGTERM, exit 0), then copy its entire volume to the snapshot
   volume. Reject symlinks/non-regular entries; preserve file bytes, numeric modes,
   UID/GID and timestamps. Compare sorted entry manifests, including SHA-256 for
   every regular file, before accepting the copy.
3. Start the new artifact against the original existing volume. Read the old
   settings and feature through its API; update both settings and the feature,
   then create another feature. Stop, restart the same container and verify all
   upgraded writes persist. Stop cleanly again.
4. Restore the complete saved snapshot into the separate rollback volume and
   compare its manifest hash to the original snapshot before launching any app.
   Start the selected old artifact with the restored volume. Its API must read
   baseline settings/feature values and return 404 for the upgrade-only feature.
5. Confirm rollback did not modify the preserved upgraded volume or baseline
   snapshot. Remove only resources whose ownership label matches this run.
   Cleanup runs on failures too; removal errors fail the run.

## Evidence

Actual run passed on 2026-10-25; log:
`/tmp/automaker-wave17-upgrade-final.log`.

| Evidence                                     | Result                                                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Selected old artifact                        | `automaker-nest-wave7-production-smoke:latest`, `sha256:5a1751f40ccc00e49a8b2864d0b132470bc45ef4ebedb1caadb8baa28dee64be`  |
| Selected new artifact                        | `automaker-nest-wave17-production-smoke:latest`, `sha256:79cf7be7bcbb541eefdcb6adc506378e1e338232cb91d017c95563f025e3b519` |
| Existing global/project settings and feature | Seeded through old API; read correctly through new API                                                                     |
| Upgraded changes and additional feature      | Persisted after actual same-container restart                                                                              |
| Complete baseline snapshot                   | 12 entries, 5 files; bytes/modes/UID/GID matched restored volume                                                           |
| Snapshot manifest SHA-256                    | `8a730b16b5316214fce54705255b43d17903f769b9dfb6111cdd28303e99660c`                                                         |
| Old artifact after restore                   | Baseline settings/feature restored; upgrade-only feature returns 404                                                       |
| Preserved upgraded volume and snapshot       | Manifest hashes unchanged by rollback                                                                                      |
| Four SIGTERM stops                           | All exit 0, no OOM kill                                                                                                    |
| Owned containers, volumes and network        | Removed; post-run filtered Docker listings empty                                                                           |

Syntax, CLI help, formatting and diff checks also passed. The final runner was
rerun after hardening cleanup: only an explicit missing resource is treated as
absent; Docker daemon/permission errors cannot become a successful cleanup claim. The first runner attempt
used an internal Docker network, which provided no published host port binding;
it failed before API seeding and removed all owned resources. The runner now uses
a labelled private bridge network, preserving ephemeral loopback host publication.
It makes no claim of app egress firewall isolation. No timeout or retry changes
were used to obtain the passing run.

The parent completed the selected new image's independent production smoke after
freeing space occupied by this task's previous Electron artifact. That image's
first smoke attempt had failed readiness while disk space was exhausted. The
passing upgrade run happened after the production smoke passed; it neither
modifies operator resources nor treats those initial failures as passing evidence.

This procedure validates an isolated local existing-volume upgrade and whole-profile
rollback with two concrete artifacts. It does not establish old-version readability
of arbitrary newly written storage, run the old artifact against unsafe upgraded
agent ledgers, reverse external workspace/remote side effects or replace operator
staging/canary/release acceptance. The independent downgrade preflight remains
required when considering direct reuse of a changed DATA_DIR by an older artifact.
