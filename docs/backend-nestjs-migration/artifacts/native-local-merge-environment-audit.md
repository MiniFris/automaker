# Native legacy-Local merge command boundary

The native pipeline's unconfigured Local fallback previously called standalone
`performMerge` through global `execGitCommand`. Its target-branch query also used
an ambient shell through WorktreeResolver. A native HTTP reproduction let the
actual offline provider mutate ambient GIT_DIR/GIT_WORK_TREE after its last custom
step: the pipeline reached auto-merge, but the intended repository HEAD remained
unchanged. Log: `/tmp/automaker-native-merge-before.log`.

`performMerge` now accepts an optional code-only `MergeCommandExecutor`. Its native
caller supplies `createLocalMergeExecutor(capturedHostEnvironment, currentRunSignal)`
and uses that same executor for target-branch discovery. Existing standalone
callers without the port retain their command implementation. The executor uses
owned LocalExecutionEnvironment commands, safe POSIX/PowerShell argument quoting,
the captured PATH/HOME, and repository-local Git variable filtering. Backend
PORT/DATA_DIR/AUTOMAKER_API_KEY/NODE_PATH do not reach commands/hooks. The existing
GitHub filter moved into a plain core helper; its runtime re-exports the same
function. GitHub commands now also remove those four backend fields while retaining
GitHub/provider credentials, proxy and intentional global Git configuration.

Actual conflict output stays private for conflict detection; outward fetch logs,
merge/error events and non-conflict exceptions use controlled messages. Native
nonzero-command diagnostics are held in a private WeakMap, so even branch-query
failures cannot leak enumerable hook stderr. Conflict files and the existing
conflict/result fields are retained. Fetch failure remains nonfatal. Cancellation
or typed cleanup uncertainty is rethrown through every fallback and never becomes
missing-branch, successful fetch, conflict or terminal success.

The caller's existing `executeOwned` lease owns the operation; the executor is not
a second application supervisor. Local command execution retains its 180 s command
bound, 1 MiB captured-output cap and existing process-group cleanup deadlines.
Caller abort is awaited through confirmed command cleanup. An additive trusted
Local exec option separates stderr; its default retains the same combined byte
behavior and result shape. Native Git returns only stdout on success, keeps failed
stdout/stderr private, and rejects truncated query output. The shared total byte
cap is unchanged. A boolean private-output classifier distinguishes confirmed
`fatal: not a git repository` from all other failures; a caller-supplied Error
message alone cannot forge that classification. Unknown cleanup remains
unknown; no retry or time-limit increase was introduced.

## Focused evidence

- Five new native contracts: two applications run actual HTTP/custom-step/Local
  merges after late ambient PATH/Git/backend-key mutation; actual hooks capture
  each owner's environment, A closes and B remains usable. Missing remote fetch
  remains nonfatal. Failing pre-merge and squash pre-commit stderr uses a private
  sentinel absent from HTTP acknowledgements, all WS frames, events and captured
  logs. Actual squash success preserves a literal quote/`$()` commit message.
- A TERM-resistant private Git wrapper holds fetch. Aborting the supplied signal
  waits for owned cleanup, returns PROCESS_INTERRUPTED, publishes no merge event,
  and leaves no live original PID/start-time identity.
- Existing native clean/conflicted merge, custom pipeline/unknown lifecycle and
  GitHub boundary/discovery/review contracts: combined **33 passed**.
- Six uncertainty unit cases cover revision/fetch/merge/diff/status/commit cleanup
  failure; existing pipeline suites, Local runtime and GitHub runtime: **86 passed**. A real
  private gh child additionally proves backend fields absent, GH_TOKEN retained.
- Actual private child tests verify opt-in stdout/stderr separation, unchanged
  combined default, a shared output cap, rejection of partial Git output and real
  missing-repository classification.
- Server no-emit and scoped production ESLint passed. No vendor request, operator
  profile, Docker job or external service was used. Actual Windows/macOS execution
  remains conditional; platform quoting/source behavior is not OS acceptance.

Logs: `/tmp/automaker-native-merge-{before,after,contract-final,contract-final2,unit,tsc,lint}.log`.
The root owns the final aggregate build/checkpoint and artifact refresh.
