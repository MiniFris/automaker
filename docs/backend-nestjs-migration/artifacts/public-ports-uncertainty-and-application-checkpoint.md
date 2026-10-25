# Public ports, durable ownership and application boundaries

Status: source checkpoint passed on `refactor/backend-nestjs-migration`, 2026-10-25.
Previous source checkpoint: `67948aa8`. Final deployable-artifact acceptance is
a separate checkpoint after this source commit.

## Source changes

- Seven consumers use five typed AutoMode capabilities. Native module exports
  expose only the public read/orphan/lifecycle ports. `useExisting` aliases share
  one owner and lifecycle; the temporary compat implementation is retired in favor
  of private `AutoModeRuntime`. The old constructor name is an export alias to the
  same class for standalone callers, not another runtime instance.
- Pipeline execution writes an intent before dispatch, retains uncertain ownership
  and step position, and rejects both nested admission and restart replay. The
  private DATA_DIR ledger also blocks unsafe old-binary downgrade.
- Agent raw-output policy uses the captured application environment. Two-app real
  feature execution verifies caller/ambient mutation and sibling shutdown cannot
  enable or disable another application's raw output.
- Ideation has explicit prompt/context, idea repository, analysis and text-stream
  collaborators with one session/job owner. Actual concurrent HTTP updates remain
  serialized by the existing mutation lane; an accepted held write drains before
  filesystem shutdown.
- Application/query/command owners use explicit factory injection, plain input
  contracts and boundary validation ports. Business errors avoid eager Nest barrel
  dependencies. HTTP400 merge and both legacy forms of HTTP429 keep their exact
  native envelopes and error categories; the wire comparison verifies RATE_LIMITED.
- Pipeline prompt expansion is a pure helper; configuration validation remains at
  the repository/schema boundary. Existing prompt/summary/provider cases pass.
- Ntfy response/exception/title diagnostics are controlled, and Ntfy/HTTP hooks
  reject redirects before forwarding configured payloads. Four private HTTP cases
  first reproduced all four defects; the corrected native/transport suite passed.
- Native diagnostic policy classifies Error objects, redacts nested credential/
  prompt fields and unstructured secondary error text, and bounds diagnostic
  structures. Fatal process handlers omit raw rejection messages/stacks. The two
  before-fix privacy cases failed; all seven policy/exception cases now pass.
- Private-origin CORS matching requires a genuine IPv4 address: three real HTTP
  cases first reproduced acceptance of `10.attacker.invalid`-style DNS prefixes,
  then passed after rejecting them. Legitimate local/configured origins remain
  covered by the same native matrix.
- Native legacy-Local merge and metadata query paths receive captured, sanitized
  Git environment and owned command execution. Actual pre-fix ambient Git poisoning
  reproduced the wrong workflow outcome; actual two-app merge/query, hook
  confidentiality, stdout/stderr separation and owned cancellation cases pass.

## Focused evidence

See the per-change audits rather than summing overlapping cohorts:

- [AutoMode public ports](auto-mode-public-ports-audit.md).
- [Durable execution uncertainty](feature-execution-uncertainty-audit.md).
- [Agent output configuration](agent-output-configuration-audit.md).
- [Ideation collaborators](ideation-collaborators-audit.md).
- [Stage11 completion matrix](stage-11-completion-matrix.md).
- [Actual terminal pressure](terminal-backpressure-acceptance.md).

Root focused results additionally include 96 notification/hook units, seven
notification/drain contracts, 90 rate-limit-related units, two native rate wire/key
contracts, 22 pipeline prompt/summary/provider units and five native runtime
identity/correlation contracts. These are separate focused runs, not an aggregate
count. Final full suites will supersede their totals.

The notification fixture sends only synthetic marker values to owned loopback
peers. It demonstrates intentional delivery still works, failed endpoint content
and titles are absent from logs/diagnostics, and configured hook requests do not
follow a redirect. The first three direct Ntfy cases and the native HTTP hook case
were red before their respective fixes.

## Final source acceptance

- Full unit: **4057 passed**, 18 conditional skips.
- Full HTTP/WS contract: **849 passed**; the conditional Gemini0.65 distribution case also passed
  separately against the pinned local distribution, with zero model/auth calls.
- Full package/UI: **1756 passed**; UI typecheck and server/UI lint passed.
- Full SSH: **136 passed**, including real Chromium Vite/HMR, actual installed
  SDK protocol fixtures, provider/feature/restart/worktree/preview/test/terminal.
- Managed Docker: **15 passed**, including all PTY/test/preview and real pinned SDK
  installation opt-ins; actual CLI version commands made no model/auth calls.
- Direct Docker shell/export isolation: **14 passed** using the verified local
  wave17 image as sandbox substrate, not as a current packaged backend claim.
- Architecture/module graph: **40 passed**. OpenAPI: **21 passed**, all318 operations,
  316 JSON +2binary, zero incomplete inputs/unverified responses. The first check
  correctly invalidated image approval after plain-class extraction; source/body
  and explicit token ordering were reviewed against actual byte/lifecycle tests.
  Approval now also pins the new file factory/module wiring, with a negative
  injection-mutation fixture. No binary guard was relaxed.
- Server/shared/UI production builds and all three inventories passed. The route
  and OpenAPI source positions were regenerated after controller changes.
- Downgrade preflight: **37 passed**, including new pending/uncertain intent gates.
- Repeated workload:100 features,300 mutations,100 events/5connections,11PTY cycles;
  FD24 throughout, children0, all captured child identities gone, exit0.
- Lifecycle: SIGTERM168.88ms, SIGINT217.41ms; both exit0.
- Current-dist pressure:118831975 produced bytes/20s;20067430 delivered bytes,
  67pongs, final marker,50000-character replay. Actual paused TCP peer closed4008;
  observed TX queue28413bytes. Settled FD23 (baseline24), children0; all3captured
  PID/start identities gone. Shutdown with live PTY/paused viewer40.99ms, exit0.
  This measures intentional lossy bounded-tail behavior, not lossless stdout.
- Performance budget passed: import767.51ms, composition74.46ms, listen2.93ms,
  health p95 1.97ms, RSS225832960bytes, close6.15ms; no unexpected resources.

Logs: `/tmp/automaker-wave23-*`, including `unit-final`, `contract-final`,
`packages-final`, `ssh`, `docker-final`, `direct-docker`, `terminal-final` and
`openapi-complete`, `workload-final`, `lifecycle-final` and `terminal-complete`. Full suites run after all application/ownership changes;
the contract/unit cohorts were repeated after the final CORS fix.

The first managed Docker invocation used an image ID in the fixture FROM and
failed image preparation, causing dependent case failures. A verified existing
local tag passed bootstrap and then the full15-case suite. The failed-run fixture
also skipped its own volume cleanup when its image was absent; that exact labelled
volume/device/creation identity was verified and removed, and cleanup now handles
explicit image absence before continuing independent volume/directory cleanup.
Daemon errors remain failures. No operator resource was pruned or removed.

Final actual Docker/Web/Linux Electron artifacts and isolated existing-volume
upgrade/restart/full-snapshot rollback remain the stage10 packaging gates. They
will use this accepted source commit. Conditional OS/vendor and external release
boundaries remain explicit in the plan; no paid vendor calls, push or release
operation is included in the source checkpoint.
