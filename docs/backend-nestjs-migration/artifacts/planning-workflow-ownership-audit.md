# Native app-spec/backlog ownership and Running Agents

This slice removes production dependence on route-owned app-spec/backlog state.
`RunningAgentsService` now reads injected registries from its own Nest application;
the same instances own the accepted generation work. Modules export their
registries and import them through explicit composition. Controllers, routes,
success envelopes, event names and generated storage paths are retained.

## Accepted work and stop semantics

- App-spec owns up to eight project jobs. The lease is published before deferred
  dispatch; another job for the same canonical project is refused.
- Backlog retains its one-generation-per-application behavior and bounds accepted
  generation/foreground apply/clear work to 32 operations. Foreground mutations
  keep their existing project serializer and feature repository owner.
- Stop requests abort; they do not erase ownership. Status/Running Agents keep a
  stopped but unsettled job visible, and replacement work stays refused until the
  actual accepted promise settles. Shutdown closes admission, aborts accepted work
  and waits for it before the scoped filesystem barrier.
- Five-second drain failure remains an unconfirmed cleanup error. Its close
  promise is cached, so a late settlement cannot turn an earlier failure into
  success. This does not claim cancellation of uncooperative external effects.
- Dispatch checks cancellation before invoking the workflow. App-spec inputs are
  copied at admission. A final reviewed delta also passes the registry's canonical
  admitted path into every workflow callback, preventing a retargeted original
  alias from changing the actual project after the lease was taken.

## Native workflow boundary

Five route implementation files were extracted into module-owned workflows with
a required `PlanningRunContext`; their old route files and two legacy workflow
adapters were deleted after caller searches. Native workflows no longer construct
FeatureLoader, read route globals, use global secureFs or call the old global text
writer/backlog store. The native context supplies the scoped filesystem, query
boundary, strict feature reads, atomic spec/feature/plan writes and saved-plan
load/clear. The saved plan remains a proposal until explicit apply.

Cancellation is rechecked after queries and reads, before new workflow steps and
plan persistence. Backlog retry delays are abortable. Already accepted atomic
writes can finish; stop is not represented as rollback. Spec completion followed
by cancellation before feature generation keeps the committed spec and starts no
feature query, as verified by the real provider-chain fixture.

Legacy common/status/stop/apply route fixtures still exist outside the native
module graph. Their global state is not used or mirrored by native registries.
This slice does not claim the remaining feature command repository or notification
owner has received a complete filesystem rewrite, durable generation replay,
bulk-apply rollback, or a full security review of inherited workflow logging.

## Targeted evidence

- Existing application/default-field/response-parsing units: **16 cases** verified
  across the targeted runs after their fixtures moved to native workflow inputs.
- New job lifecycle units: **8 passed**, covering retained stopped leases,
  pre-dispatch abort, synchronous failure, both held-work timeouts, admission caps
  and a foreground apply whose held read is released after shutdown without any
  subsequent mutation.
- Canonical dispatch delta: app-spec application **2 passed**, including changed
  alias resolution and caller mutation between admission and deferred dispatch.
  Combined with lifecycle cases, that final delta run contains **10 passed**.
- Native contracts: **5 passed**. Two applications running against the same project
  keep independent rows/controllers; closing one drains both generation promises
  before filesystem close and leaves the other untouched. Actual native backlog
  provider/store paths verify persistence versus abort, and the spec-to-features
  provider chain verifies normal and cancelled phase behavior.
- Server TypeScript, targeted module ESLint, formatting and diff checks passed.
  Core/modules imports of the retired route workflows/globals: **zero**. No full
  suite, Docker, GUI or live-vendor run was started by this owner.

The parent runs the combined stage checkpoint and records its aggregate evidence.
The small canonical-dispatch correction is independently covered by the final
targeted delta; earlier broad snapshots are not silently relabelled as testing it.
