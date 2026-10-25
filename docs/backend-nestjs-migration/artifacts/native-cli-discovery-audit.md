# Application-owned provider CLI discovery

Wave22, after `75a17e18`. Targeted evidence; the parent owns the combined checkpoint.

`HostCliDiscovery` captures the native application's environment and working
folder independently of rotating provider credentials. It resolves PATH, common
installation/profile paths, Windows shell/WSL probes and Codex auth hints without
ambient query-time environment or a cross-application CLI cache. Existing native
credential callbacks still refresh keys per execution. Standalone constructors
retain their compatibility defaults.

Concrete changes:

- Cursor/Gemini/OpenCode use captured PATH/common HOME paths before spawning.
  Cursor's module-import versions directory becomes an instance path; native
  execution skips the old ambient permission-profile diagnostic read. Its passive
  credential hints resolve captured CURSOR_CONFIG_DIR/XDG_CONFIG_HOME.
- Codex CLI/auth hints and user instructions use the selected application profile.
  Relative CODEX_HOME resolves against application workingDirectory and the same
  absolute value enters CLI/SDK env, including when the query uses a worktree cwd.
  Own CLI OAuth retains its prior priority over an application API key; foreign
  ambient OAuth no longer changes that decision. Legacy common-path ordering is
  retained, with captured PATH available as a final Codex fallback.
- Copilot passes the verified CLI path into the actual SDK. A common-path install
  therefore no longer depends on a second SDK lookup of `copilot` in PATH.
- OpenCode catalog/provider-list subprocesses now receive explicit app env/cwd.
  Native vendor CLI/Copilot/Codex children exclude backend PORT, DATA_DIR,
  AUTOMAKER_API_KEY and NODE_PATH while retaining rotating vendor credentials.
- Native setup status uses captured home/candidates/profile hints; app HOME is
  reported instead of operator os.homedir. Existing DTO shapes remain unchanged.
- The platform subprocess helper accepts an explicit shell only for its existing
  Windows .cmd/npx handling. Native callers supply captured COMSPEC; command and
  argv semantics stay unchanged. Standalone callers retain the previous default.

## Targeted proof

- **4 native discovery contracts** execute private binaries through default native
  registrations in two apps after ambient/input mutation. Actual Cursor/Gemini/
  OpenCode/Codex CLI and the real Copilot SDK's private stdio protocol return markers.
  Assertions cover executable/profile identity, no ambient wrapper invocation,
  no backend transport vars, dynamic credential rotation, Cursor version fallback,
  own passive hints, changed query cwd and app B remaining usable after A closes.
- Codex's SDK branch uses an explicitly offline SDK adapter seam to test selection
  and env; it does not contact a vendor or claim new live SDK transport acceptance.
- Combined native discovery/status selection: **8 passed**. The old platform status
  fixture expected operator home despite explicit app HOME; its exact expectation
  now checks the configured app working directory.
- Existing seven provider/host unit files: **267 passed**.
- Platform subprocess selection: **24 passed**, including three Windows mock cases
  verifying captured shell selection and unchanged argv/default behavior. The first
  new fake child omitted stdout EOF; it now ends pipes, sets exitCode and emits exit.
  No production timeout/retry change was used.
- Server no-emit, scoped production ESLint, formatting and diff checks passed.

Logs: `/tmp/automaker-wave22-cli-contract-final.log`,
`/tmp/automaker-wave22-cli-unit-final.log`,
`/tmp/automaker-wave22-cli-platform-green.log`,
`/tmp/automaker-wave22-cli-tsc-final.log`,
`/tmp/automaker-wave22-cli-lint-final.log`.

Claude already uses the native environment callback and its bundled SDK path;
Direct has separate scoped workspace/checkpoint evidence. This slice does not
certify every vendor error/tool/event path. Remote adapters retain their early
issued-runtime path and no host credential fallback; the parent reruns that tier.
Windows/macOS/WSL behavior has source/mock evidence here, not actual OS acceptance.
No installed vendor CLI, real profile, model API, install, container or external
service was used by these private fixtures. No full suites/builds/commits were run
by this worker.

## Bounded diagnostic and redirect hardening

An additional stage10 slice makes CLI subprocess failures controlled messages:
base/Cursor/Gemini opt into `processFailureMessage`; raw stderr and malformed
JSONL line/final-line diagnostics are then excluded from logs and emitted errors.
Recognized auth/rate/model/network/process classifications remain actionable.
OpenCode classifies the raw session failure privately before replacing it with a
stable marker, preserving its existing single retry. Cursor now normalizes the
subprocess error event instead of silently dropping it. Copilot SDK failure and
resume-fallback logs no longer include the raw exception. Normal protocol content
is unchanged; callers that omit the platform policy retain their prior behavior.
This is targeted failure-path evidence, not certification of all vendor output.

MCP's bounded fetch uses manual redirect handling for both SDK HTTP and
EventSource fetches. It rejects 3xx responses, cancels the response body and aborts
the operation before any second endpoint receives configured credentials. Explicit
initial endpoints and headers remain supported; configure the final endpoint
rather than relying on a redirect. This adds no host/IP allowlist.

Focused evidence: **26 native contracts**, including actual private CLI failures,
real Copilot SDK RPC errors/resume fallback, successful OpenCode session retry,
and HTTP/SSE 301/302/307/308 redirects to a separately observed private peer. The
initial peer receives both configured auth and a custom credential header; the
redirect peer receives no request, including after app close. Existing HTTP/SSE
success, cancellation and byte bounds remain green. **22 platform tests** include
actual stderr plus complete/final malformed lines with opt-in sanitization and
unchanged standalone behavior; **198 provider unit tests** pass. Server no-emit,
scoped production ESLint and diff checks pass. All fixtures stay local and use
private temporary profiles/executables.

Logs: `/tmp/automaker-wave22-diagnostic-contract-final.log`,
`/tmp/automaker-wave22-diagnostic-platform-final.log`,
`/tmp/automaker-wave22-diagnostic-unit.log`,
`/tmp/automaker-wave22-diagnostic-tsc.log`,
`/tmp/automaker-wave22-diagnostic-lint.log`.
