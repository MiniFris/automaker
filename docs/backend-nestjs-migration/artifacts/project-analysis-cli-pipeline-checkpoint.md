# Project analysis, CLI discovery and pipeline cleanup

Status: source checkpoint passed on `refactor/backend-nestjs-migration`,
2026-10-25. Previous committed checkpoint: `75a17e18`.

## Changes

- Restore the actual public project-analysis workflow that previously acknowledged
  HTTP work and then hit a throwing facade stub. A native analysis owner separates
  accepted-job lifetime, provider/execution preparation and atomic output storage.
  See [analysis restoration and no-start proof](project-analysis-restoration-audit.md).
- Scope native CLI discovery, home/profile paths and executable invocation to the
  application's captured environment. Actual private executable/RPC fixtures cover
  Cursor, Gemini, OpenCode, Copilot and Codex after ambient environment mutation.
  See [CLI audit](native-cli-discovery-audit.md).
- Remove the pipeline test-step island with no production caller and its unused
  test-runner owner. Preserve live execution/resume/merge and public configuration.
  Native HTTP/WS workflows replace tests of the dead private implementation.
- Retire 22 permanently skipped MCP SDK mocks in favor of 42 actual protocol and
  invalid-configuration contracts; see [coverage mapping](mcp-mock-retirement-audit.md).
- Prevent generic native CLI diagnostics from exposing raw stderr/invalid JSONL
  and prevent HTTP/SSE MCP redirects from forwarding saved custom headers.
  Actual subprocess/SDK/private HTTP peers verify safe errors, preserved OpenCode
  retry and absent redirected requests.
- Document deployed proxy/cookie/CORS behavior and verify it through 11 native HTTP
  cases. The local-origin compatibility rule remains explicit; no exclusive origin
  allowlist or private-network browser permission is claimed.

## Verification already completed

- Full unit suite: 4038 passed, 18 conditional skipped.
- Full contract suite after final source freeze: 823 passed, one conditional
  Gemini distribution case passed separately with the pinned local distribution.
- Full SSH suite: 135 passed; the one conditional Chromium case passed separately
  with the installed browser (136 distinct cases covered).
- Gemini 0.65 distribution policy: one opt-in actual-distribution case passed,
  checking 11 decisions with zero model/auth calls.
- Seven new native analysis cases passed: Local HTTP/events/storage/lifecycle and
  actual private SSH Direct Read against a poisoned controller copy. Eight
  existing-target cases include actual Docker verifyStorage/runtime rejection
  after a container stops; no engine start/exec is dispatched.
- Five native custom-pipeline cases cover ordered steps, exclusions, resume, stop,
  supersession and actual clean/conflicted Local Git merge. The changed managed
  Docker feature fixture also passed its four verification commands.
- Full package/UI suite: 1756 passed. The initial run exposed an incomplete new
  Windows mock (missing stdout EOF); the fixture was corrected without changing
  production timeout behavior and the complete suite passed again.
- Shared packages, server and UI builds; UI typecheck; server/UI ESLint: passed.
- Architecture: 33 passed; OpenAPI: 21 passed. Route/API-consumer inventories current.
  Dependency inventory regenerated after final source freeze; all three checks passed.
- Actual opt-in Direct Docker shell isolation: 14 passed with immutable local image
  `sha256:79cf7be7bcbb541eefdcb6adc506378e1e338232cb91d017c95563f025e3b519`.
  This image supplies the sandbox shell; current source supplies the tool policy.
  It is not a current packaged-backend acceptance claim.
- Repeated workload: 100 features, 300 mutations, 100 delivered events over five
  connections and 11 PTY cycles; FD 24 throughout, children 0, owned PID identities
  gone, close 37.40 ms and exit 0.
- Production lifecycle: SIGTERM 714.45 ms, SIGINT 218.09 ms; both exit 0.
- Performance budget passed: import 606.55 ms, composition 70.43 ms, listen 2.82 ms,
  health p95 2.13 ms, RSS 225312768 bytes, idle close 5.80 ms; no unexpected handles.

The first full contract run found four stale tests reaching the removed private
pipeline field or mocking the old analysis stub (803 other cases passed). They
were moved to the live owners while preserving filesystem/HTTP assertions; the
11 filesystem/repository cases and 15 existing analysis/response cases passed
focused reruns. Their failed run is not counted as a successful checkpoint.
Review also found indirect container startup inside Docker verifyStorage;
server-issued existing-target preparation now carries a no-start manager/runtime.
The regression uses the actual storage/runtime path rather than mocking it.
Final post-freeze contract acceptance, formatting and all source inventories passed.
The complete unit/contract runs are `/tmp/automaker-wave22-unit-complete.log` and
`/tmp/automaker-wave22-contract-complete.log`; package/UI run is
`/tmp/automaker-wave22-packages-frozen.log`. Web production module recovery passed;
36 downgrade-preflight and 10 performance-budget cases passed too.

Logs use `/tmp/automaker-wave22-*`. No paid vendor calls, operator profiles,
external deployment, push or PR are involved. Packaged artifacts from `86afe69c`
remain historical until rebuilt against the final source.

## Remaining source scope

The complete migration is not declared finished by this checkpoint. The next
bounded slice is the three concrete items listed in stage11: narrow public
AutoMode capabilities, captured AgentExecutor raw-output flag and retained
pipeline uncertainty. Current packaged Docker/Linux Electron artifacts must be
rebuilt after final source changes. Conditional Windows/macOS execution and
external release approval remain separate from local evidence.
