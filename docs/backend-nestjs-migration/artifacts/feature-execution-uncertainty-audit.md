# Feature execution uncertainty ownership

Wave23 after `67948aa8`. Targeted implementation and offline evidence; the parent
owns the combined checkpoint and commit.

`resumeFromStep` previously classified unconfirmed cleanup/outcomes as ordinary
failure and released its lease. `attemptMerge` flattened typed remote uncertainty
to a string, allowing the completed pipeline to publish success/review. This slice
preserves typed uncertainty and the saved pipeline position. It does not claim
that the old merge method automatically replayed a command.

## Ownership and admission

- `ConcurrencyManager.executeOwned` surrounds actual implementation/retry agent
  dispatch, each custom step, and merge. It retains ownership while cleanup is
  pending and prevents normal/forced release of an uncertain incarnation, including
  nested outer recovery releases. There is no new persisted feature status or DTO.
- `executionUncertain` is private run state. The coordinator refuses further
  transitions, completion events and queued writes for that run. Pipeline and
  execution catches emit a controlled unknown error, without backlog/review/
  success fallback. Ordinary confirmed failures and cancellation remain separate.
- The classifier recognizes `ProviderCleanupError` and typed environment
  `PROCESS_CLEANUP_FAILED`, `SSH_OUTCOME_UNKNOWN`, `SSH_CLEANUP_UNVERIFIED`, and
  `DOCKER_WORKER_FAILED`. Inspection found the last code only on disconnected or
  non-JSON Docker worker responses; confirmed worker errors use their own specific
  code. Arbitrary errors with a copied code are not classified as runtime errors.
- Native composition injects one application-owned intent store into the shared
  manager. The synchronous compatibility acquisition API remains available with
  its in-memory gate; actual native execution/recovery/verification acquisitions
  use `acquireAsync`, which checks the durable gate before dispatch.

## Durable barrier and lifecycle

`DATA_DIR/feature-execution-intents/<sha256 canonical-project-and-feature>.json`
contains version 1, operation ID, canonical identity, kind
`execution|pipeline_step|merge`, phase `pending|uncertain`, fixed code and fixed
reason. No prompt, raw output or credentials enter this ledger. Per-identity
serialization and a 256 accepted-operation cap bound storage admission. Temporary
files use exclusive creation and 0600; rename publishes the marker. This follows
existing atomic-file patterns, not a power-loss/fsync guarantee.

The marker is written before dispatch. Matching owned confirmed settlement
removes it. Unconfirmed cleanup retains it; a pending record after a crash also
blocks fresh native admission. Malformed, oversized, symlink or unreadable records
fail closed. A late provider finish or stale settlement cannot silently erase a
retained barrier. Refusing a request while a normal operation is pending does not
permanently poison shutdown once that matching operation settles.

Compat lifecycle drains accepted project commands/recovery state before closing
the intent store, before the scoped filesystem shutdown barrier. Closing the store
is bounded and cached; known unresolved records report failure. It never drains
uncertainty by deleting the ledger. Explicit stopped-controller recovery and
snapshot-based downgrade are documented in `docs/backend-storage-downgrade.md`;
there is no HTTP force-resume or automatic acknowledgement.

## Focused verification

- **18 native contracts**: real HTTP workflow, saved-step resume with a private
  provider throwing `ProviderCleanupError` during generator finalization; nested
  release and forced-release refusal; delayed fixture side effect; second app
  remaining usable; fresh native app with the same profile refusing manual run,
  manual resume and automatic resume. Persisted pipeline position and marker
  kind/phase are asserted.
- The merge negative uses an explicitly injected private `FeatureWorkspaceService`
  merge-boundary failure. Real HTTP/step/lease/journal handling runs; no claim of
  new real SSH/Docker transport acceptance is made. Existing real Local clean/
  conflicting Git merge contracts remain green.
- Existing optimistic local stop/replacement tests now assert cleanup before
  replacement admission. The debug-output fixture passes the app's explicit
  environment after the separate captured-debug-setting fix.
- **185 focused unit tests**, including five new storage/lease/classification
  regressions: pending restart barrier, mismatched settlement, ordinary failure
  allowing retry, retained nested leases, malformed marker and typed codes.
- **37 downgrade fixtures**: valid pending/uncertain feature ledgers block the old
  target, unknown records are unconfirmed, output omits private identity/payload,
  and scanning leaves bytes/modes unchanged.
- Server no-emit, scoped production ESLint, formatting and diff checks pass.

Logs: `/tmp/automaker-wave23-uncertainty-contract-green.log`,
`/tmp/automaker-wave23-uncertainty-unit-final2.log`,
`/tmp/automaker-wave23-uncertainty-downgrade.log`,
`/tmp/automaker-wave23-uncertainty-tsc-final2.log`,
`/tmp/automaker-wave23-uncertainty-lint-final.log`.

No external profile, vendor model, SSH host or Docker workload was used. This is
a bounded pipeline/implementation ownership fix, not a blanket audit of every
possible SDK effect, project mutation, operating system or production deployment.
