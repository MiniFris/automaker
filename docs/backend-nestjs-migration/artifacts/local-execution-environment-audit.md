# Application-owned Local execution environments

Date: 2026-10-25. Wave 19 closes the Local runtime environment boundary used by
native execution, Git and managed feature workflows.

Previously, `LocalExecutionEnvironment.exec` copied `process.env` for each command
and selected the Windows command shell from ambient variables. A runtime opened
by one Nest application could therefore execute with later process-wide changes
or another application's tooling configuration.

## Snapshot and child-process policy

`LocalExecutionEnvironment.create(cwd, environment)` now copies and freezes its
input **before the first await**, including before canonical cwd lookup. Commands
and the Windows `taskkill.exe` cleanup child receive that captured environment.
The exec path explicitly supplies the captured COMSPEC to shell selection; an
absent captured value becomes an empty string and then the existing `cmd.exe`
fallback, without re-entering the helper's standalone ambient default. Lookup in
a plain snapshot recognizes `COMSPEC`, `comspec` and `ComSpec` case-insensitively.
Unix shell selection and the existing Windows PowerShell/default versus explicit
cmd invocation modes are retained.

Native composition uses `captureNativeLocalEnvironment(HOST_ENVIRONMENT)`.
It preserves host tooling and user variables, including PATH, HOME and explicit
user credentials, while excluding `PORT`, `DATA_DIR`, `AUTOMAKER_API_KEY` and
`NODE_PATH` with case-insensitive key matching. These four exclusions follow the
terminal child-environment policy. This is not a credential allowlist or a
sandbox: user-provided command text retains ordinary Local process rights, and
normal shell inline environment assignments still take precedence.

Standalone `create(cwd)` deliberately remains compatible: it captures the current
`process.env`, including its existing variables, at creation time. A unit test
changes ambient variables immediately after calling create, before awaiting its
result, and verifies that execution uses the earlier snapshot. The sanitization
policy belongs to native composition; it is not silently imposed on every
standalone compatibility caller.

## Explicit native plumbing

The application snapshot is passed through these paths without a global registry
or a lookup keyed by SettingsService:

- Execution adapters receive `HOST_ENVIRONMENT`, sanitize once, and pass their
  snapshot to `boundRuntime`, which forwards it to Local creation.
- The native Git factory constructs `ProjectGitService` with the snapshot. Both
  unbound Local targets and pinned runtimes use it. Every BindingStore constructed
  by that service receives the same environment, including pin validation during
  Git operations.
- `EnvironmentBindingStore` and `FeatureWorkspaceService` copy their explicit
  constructor environment. Local feature preparation, recovery verification and
  bound runtime reopening forward it. BindingStore also reads its captured
  `IS_CONTAINERIZED` value for consent behavior.
- Native execution-environment settings receive `HOST_ENVIRONMENT` for their
  BindingStore. AutoMode's factory passes the snapshot through Compat and
  FacadeOptions to project facades, ExecutionService, PipelineOrchestrator and
  AgentExecutor. Their FeatureWorkspace/BindingStore creation and Local
  verification use the owning environment.
- AgentEnvironmentPreparer receives the native snapshot for its provider
  preparation and FeatureWorkspace context path. The provider execution helpers
  accept and forward explicit snapshots to BindingStore and boundRuntime.
  Native query/provider preparation callers and EventHooks have corresponding
  wave 19 contracts; EventHooks also receives the application working directory.

Compatibility constructor/function defaults remain available for standalone
callers. Native factories explicitly supply their captured values rather than
relying on those defaults.

## Actual application and process evidence

`apps/server/tests/contract/local-execution-host-configuration.contract.test.ts`
contains two Linux contracts, each starting two actual Nest applications with
private directories and ephemeral loopback listeners.

The first gives each application a different executable on its private PATH,
HOME, sentinel and user token. It mutates both process-wide environment variables
and the original input objects after application creation. ExecutionRegistry and
ProjectGit runtimes both execute the owning application's actual tool, retain its
HOME/user token, omit all four backend variables, and preserve command-level
inline environment overrides. A missing ambient PATH cannot satisfy the check.

The second creates real Git repositories and pins separate managed Local feature
worktrees. An explicit offline Docker preflight fixture fails before Docker
preparation; server-side Auto fallback consent is granted in the private test
state. No operator Docker context, container or volume is touched. BindingStore
prepares the worktrees after ambient environment mutation. Defaults then change
from Auto to Local, and the actual native AutoMode facade verifies the existing
feature through its same saved worktree.

Private Git shims delegate to `/usr/bin/git` and record the child environment;
private npm shims accept only the four expected verification commands. All Git
records carry the owning application's sentinel/HOME without its backend API key,
and each application executes exactly four expected npm checks. The pin's
runtime cwd is preserved. These npm shims prove environment routing and command
selection, not the correctness of a real npm build/lint/test workload; repository
validation is performed separately.

Focused evidence:

- Two native Local/pinned-feature contracts passed; latest focused run 444 ms.
- 24 Local runtime/shell/registry unit cases passed, including standalone capture
  timing, Windows invocation quoting and COMSPEC lookup.
- Final AgentEnvironmentPreparer/Pipeline run: 71 cases passed. AutoMode/Pipeline
  companion run: 23 cases passed. Managed feature-workspace run: 10 cases passed.
- Server `tsc --noEmit`, ESLint on the 16 changed production files and Prettier on
  the 21 files in this Local/workflow slice passed.
- Subsequent full checkpoint evidence available at documentation time: server
  build passed, unit suite **4028 passed / 40 skipped**, package suites **1751
  passed**. Full contract/SSH results belong to the wave checkpoint once finished.

Local supporting logs include `/tmp/automaker-wave19-local-native-extended.log`,
`/tmp/automaker-wave19-local-unit.log`,
`/tmp/automaker-wave19-preparer-pipeline-final.log`,
`/tmp/automaker-wave19-orchestration-unit.log`,
`/tmp/automaker-wave19-feature-workspace.log`,
`/tmp/automaker-wave19-bindings-tsc.log`,
`/tmp/automaker-wave19-local-lint.log`, `/tmp/automaker-wave19-build.log`,
`/tmp/automaker-wave19-unit2.log` and `/tmp/automaker-wave19-packages.log`.
These are temporary local logs; this artifact preserves the reviewed results.

## Limits and compatibility sites

COMSPEC behavior is covered by pure invocation/snapshot tests run on Linux.
Passing the captured environment to `taskkill.exe` is source wiring in this
change; it is not evidence of executing Windows process cleanup. Windows and
macOS acceptance remains a separate OS gate.

`providers/gemini-tool-policy.ts` uses Local creation only as a filesystem port;
it now supplies an explicit empty environment. The separate Gemini policy probe
is explicit. `services/execution-environment/provider-setup.ts` still constructs
BindingStore through its compatibility signature for `configuration()` only;
that metadata-only path neither reads the stored host environment nor creates a
Local command runtime.

This audit does not establish that every backend service has stopped reading
ambient process state. Other process launchers, host integrations, vendor SDKs,
Docker/SSH transport configuration and general platform policy require their own
boundaries and evidence. The change does not alter remote selection, authorize
fallback after command dispatch, or replace existing process-outcome/cleanup
checks. It completes this environment snapshot slice, not the whole migration.
