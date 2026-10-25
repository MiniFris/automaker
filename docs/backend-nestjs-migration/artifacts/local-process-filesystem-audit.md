# Local dev/test filesystem boundary

Native LocalProcessRuntimeModule supplies DevServerService and TestRunnerService
with the application's scoped filesystem and RuntimePaths/SecurityService canonical
path resolver. Directory stat and package/lockfile access use those ports; DENIED,
EIO and closed filesystem errors never become absence, another package manager or
a fallback command. ENOENT/ENOTDIR and actual nondirectories retain the existing
missing-worktree/package outcomes. The spawned cwd uses the canonical path captured
at admission; existing public worktree aliases, command syntax and result fields
are retained. Standalone constructors keep their legacy reader behavior.

Native dev persistence uses explicit configured DATA_DIR and the same
`dev-servers.json` array format. Access/read use scoped IO; writes use the existing
atomic writer with scoped filesystem, private 0600 temp publication and no new
journal, backup/recovery conversion or automatic restart policy. Native load errors
other than optional ENOENT propagate; failed writes do not log successful save.
Awaited start/stop writes propagate the static persistence failure. Background
write failure is retained through cleanup. An explicit successful full replacement
before shutdown clears a prior transient write failure; once closing starts,
failed cleanup remains cached rather than being erased by a late write.

Both native owners synchronously close start admission and track actual accepted
start promises through settlement. Cleanup waits up to five seconds for preflight
completion; late preflight observes closure before allocation/spawn. Timeout retains
the accepted promise until actual settlement and reports cleanup failure. Native
dev cleanup also drains queued state writes against a single five-second save
phase deadline, then closes state-write admission before the shared filesystem
barrier. Deadline is not cancellation of underlying IO. This does not redesign
existing process termination/restore policy or certify its ownership.

Targeted evidence: four new preflight/drain units and 41 existing standalone dev
units passed. Six native contracts cover two-app roots, DENIED/EIO with no process
start, held dev/test preflight across app.close, held atomic save across filesystem
close, private unchanged state format, post-close write rejection, load failure,
failed persistence cleanup and successful pre-close snapshot retry. Scoped ESLint
passes with one existing unused-disable warning in DevServerService; server no-emit
passed. Initial new-unit mock omitted execFile required by a transitive platform
import; it now preserves untouched child_process exports. No behavior fallback was
added to accommodate that test fixture.

All native start fixtures are negative or held and stop before port allocation.
Spawn is mocked; the existing dev unit file mocks subprocesses and net. No actual
local dev server, host listener, Docker/SSH/network acceptance, GUI, full suite,
commit or inventory was started/modified by this owner.

## Explicit remaining ownership boundary

`DevServerService.killProcessOnPort`, `findAvailablePort` and the related livereload
port loop still use lsof/netstat/PID killing against port occupants. This existing
native behavior has not been made safe by filesystem injection and must be
addressed in a separate owned-process hardening slice. Positive local dev acceptance
must not run against host listeners until that policy is resolved; managed target
acceptance is a separate path. Source persistence record reattachment/port probes,
subprocess environment and the standalone legacy reader remain outside this slice.
