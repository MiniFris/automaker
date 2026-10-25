# Native local dev/test process ownership

Native DevServerService port selection now probes and skips busy ports. It never
kills the occupant or common livereload ports. Port allocation is not ownership;
output-detected URLs/ports do not authorize signals. Tests supply an explicit
private ephemeral range/probe, so no positive acceptance touches normal host dev
ports. A bind race is an ordinary command failure; the service does not kill its
competitor or replay the command.

On native Linux, DevServerService spawns a detached child/session, and both dev/test
owners use the shared owned-local-child supervisor. The service attaches completion
observation immediately and waits for readiness before reporting a running job.
The supervisor owns generation/group/session proof and signals; the services do
not fall back to PID/port killing. Signal acceptance, ChildProcess.killed and root
exit are not completion proof.

Explicit stop and natural completion await the same supervisor confirmation.
Native Linux getters no longer prune records after root exit alone. Unknown cleanup
retains identity, dev allocated port, active-test admission and logs; it does not
emit a confirmed stopped/completed event or permit another execution for that
identity. Static 503/UNAVAILABLE `LOCAL_PROCESS_CLEANUP_FAILED` errors expose no raw
process diagnostics. Sibling cleanup is attempted concurrently, and failed cleanup
remains cached. Dev finalization is coalesced so explicit stop also awaits its
confirmed-state publication rather than racing the natural-exit callback.

Persisted dev records have no live process handle or captured generation. Native
load preserves them as unowned/unknown descriptions without probing a port to
adopt authority. Stop/restart refuses them and cleanup reports uncertainty. The
existing state filename/format remains unchanged; this slice adds no PID journal,
automatic migration/reconciliation or execution replay. A copied description in
another app cannot stop the original app's process.

## Synchronous canonical admission and native port leases

A review found two additional races: test starts could both await directory stat
before publishing a session, and different dev starts could both pass a delayed
probe before reserving its port. Both native wrappers now reserve canonical cwd
and the public alias synchronously before their first await. Active records retain
the captured canonical key, so another symlink spelling cannot start duplicate
work, including while unknown cleanup is retained. Start reservations release on
actual settlement; public result aliases are unchanged. Stop still uses its
captured record/owner without resolving the alias again.

Native port allocation rechecks the reservation set after an awaited probe and
reserves a free port synchronously before returning it. Concurrent worktrees get
different leases. Closing or synchronous no-child spawn failure releases only the
owned reservation; unknown active cleanup retains its port.

Final review-delta evidence: 22 focused consumer/preflight cases passed, including
held same-path/alias attempts for both owners, captured stop after alias retarget,
unknown alias replay refusal, failed-preflight retry, delayed two-worktree probes,
no-child reservation release and shutdown during a held probe. These replace no
full checkpoint: the root reruns the affected combined checks on the frozen delta.
Scoped ESLint/no-emit and formatting/diff checks passed.

## Platform and compatibility limits

Strict descendant/group confirmation is dispatched only for native Linux. Native
macOS/Windows retain their existing process lifecycle compatibility path until an
actual platform proof adapter exists; ordinary natural completion is not routed
through an always-unsupported supervisor. The no-port-occupant-kill change applies
to native instances on every OS. Native persisted entries without process handles
never fall back to port killing on any OS. Existing non-Linux descendant cleanup
is not certified by Linux tests and remains an explicit ownership gate.

Standalone constructors preserve their existing legacy behavior, including the
historical port/tree policy. Filesystem injection, admission and atomic dev-state
logic from the prior slice remain in place. This audit supersedes the native Linux
port-kill/root-exit-only cleanup gap recorded in the previous
[filesystem audit](local-process-filesystem-audit.md); it does not claim all legacy
or non-Linux process ownership is now hardened.

## Targeted evidence

- Before the admission review delta, 54 focused units passed: nine new consumer ownership/compatibility cases,
  41 existing standalone dev cases and four preflight/drain cases. Held proof,
  unknown retention, no killed/exitCode pruning, both owners' attempt-all cleanup,
  unowned persisted records and Darwin/Windows normal-lifecycle dispatch are covered.
- Eight native contracts passed: six prior scoped filesystem cases plus two actual
  Linux process cases. The final changed two-case file also verifies app.close with
  an active TERM-resistant test root/child, not just an already-stopped process.
- Actual dev acceptance creates its own ephemeral busy listener and range. That
  listener survives allocation refusal and owned dev cleanup. Captured detached
  root/child groups are quiescent before successful stop. A copied record in a
  second Nest app cannot kill or replay the first app's job.
- Fixture fallback cleanup uses only explicit fixture child generations, never
  process-name searches, port-occupant discovery or unbounded host commands.
- Server no-emit and scoped ESLint passed; one existing unused-disable warning
  remains in DevServerService. Formatting and diff checks passed.

The shared supervisor's generation/anchor fixtures belong to its own audit and
owner. No full suite, GUI, Docker/SSH, external network/provider acceptance, commit
or inventory update was performed by this consumer owner.
