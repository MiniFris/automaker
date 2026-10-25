# MCP discovery: bounded transport and accepted-operation ownership

Wave21, after `0758a24b`. This is targeted implementation evidence; the parent
runs the combined checkpoint. API version/status/body shapes stay unchanged.

## Actual behavior and limits

Native `/api/mcp/test` and `/api/mcp/tools` resolve only a saved server ID through
SettingsService. Connection testing initializes the protocol without listing tools;
tool discovery initializes and lists. A manually tested disabled saved server still
works. Additional request URL/command/config fields do not replace the saved target.
No tool invocation, installation or external authentication operation is introduced.

MCPTestService reserves one of **16 accepted operations before the settings lookup**.
The owner tracks lookup, transport creation, connection, discovery and cleanup.
Shutdown closes admission and aborts work in `onModuleDestroy`, then drains before
the shared filesystem's before-shutdown barrier. The compatibility before-shutdown
hook returns the same cached result. A held lookup cannot dispatch after shutdown.

Budgets apply before SDK parsing:

- **2 MiB** for one stdio newline frame, or one complete HTTP response body/stream
  (including legacy/Streamable HTTP SSE). An unterminated line/event cannot grow
  the SDK's internal parser buffer past this transport boundary.
- **4 MiB** aggregate incoming bytes per accepted operation, including stderr.
- **64 KiB** stderr; its contents are discarded and never logged. Exceeding the
  budget aborts the operation instead of retaining arbitrary output.
- The existing parsed catalog limit remains **1000 tools / 1 MiB JSON**.
- Existing connection and list phases retain **10 seconds each** by default.
  A timeout aborts the operation and initiates actual transport cleanup.
- Cleanup/drain confirmation has a **5 second** bound. Unknown cleanup is retained,
  rejects replacement and makes repeated close fail even after late settlement.

The fetch adapter tracks outstanding fetch setup and body readers, combines SDK
and owner abort signals, limits decoded bytes before SDK JSON/EventSource handling,
and cancels/drains owned readers. A fetch stream already errored by its abort
reason/AbortError is confirmed cancellation; other cancellation failures remain
uncertain. Closed operations refuse all later fetches, including SDK reconnects.
Public diagnostics use fixed controlled messages; raw SDK/server text is suppressed.
Configured secret matches retain the historical explicit `[REDACTED]` marker.

The stdio adapter uses the real SDK `serializeMessage`/`deserializeMessage`, not a
new MCP protocol implementation. Native HOME/PATH and other SDK-default inherited
variables come from the app's construction snapshot; saved server env overrides
win. Implicit backend PORT/DATA_DIR/AUTOMAKER_API_KEY/NODE_PATH do not enter the
child. Saved explicit env values remain user configuration. Windows name lookup
and overrides preserve case-insensitive behavior; this has not been run on Windows.

On Linux, spawn creates a detached session and immediately captures the original
ChildProcess in the existing generation-checked owned-child runtime. Cleanup
captures descendant continuity before EOF can remove the leader, then confirms
exit or escalates TERM/KILL only through that authority. It waits for original
child closure and process-group quiescence. Zombies count as non-executing, not as
proof of a fully reaped PID. Other platforms retain bounded original-child cleanup
and Windows taskkill behavior; this is not cross-platform process-tree proof.

## Targeted verification

**31 real contracts passed** across three files:

- Existing seven [stdio contracts](../../../apps/server/tests/contract/mcp-transport.contract.test.ts):
  actual SDK handshake, separate listing, both phase timeouts, redaction, oversized
  catalog and shutdown.
- Seventeen [HTTP/native contracts](../../../apps/server/tests/contract/mcp-http-native.contract.test.ts):
  actual SDK Streamable HTTP with SSE and JSON responses, legacy SSE, auth failure,
  saved target/header, disabled-server manual test, empty tools, oversized/unterminated
  input, raw HTTP error confidentiality, held initialize/list deadlines, two-app
  shutdown/isolation and a held lookup draining before the FS barrier.
- Seven [ownership contracts](../../../apps/server/tests/contract/mcp-owned-operations.contract.test.ts):
  real newline-less stdout/stderr floods, actual TERM-resistant grandchild cleanup,
  two native stdio environment snapshots/explicit overrides, admission/drain,
  unconfirmed lookup and process cleanup retention. The latter two include explicit
  non-cooperative/failing attestation ports and prove no replacement/late clean-close.

An additional focused three-case run verifies observed wire Content-Type for
Streamable HTTP JSON and SSE, plus the legacy SSE handshake. The peer observes
SDK-produced `writeHead` headers without changing their arguments. The first
observation using getHeader was insufficient because Hono writes headers directly;
that fixture-only observation was corrected.

Existing MCPApplicationService units: **2 passed**. Server no-emit TypeScript,
scoped production ESLint, formatting and diff checks passed. Logs:
`/tmp/automaker-wave21-mcp-contract-final.log`,
`/tmp/automaker-wave21-mcp-content-types2.log`,
`/tmp/automaker-wave21-mcp-unit.log`,
`/tmp/automaker-wave21-mcp-tsc-last.log` and
`/tmp/automaker-wave21-mcp-lint-last.log`.

## Boundaries

The old SDK-mocking unit file remains skipped (22 cases); it is not counted as
successful transport evidence. Private peers bind ephemeral loopback ports and use
actual SDK servers. There were no external servers/models/authentication, operator
profiles, installs, containers, commits or whole-suite runs by this worker.

This closes the native discovery transport/admission/cleanup slice, not arbitrary
provider-owned MCP execution, a new endpoint allowlist, production WAN acceptance,
OS-wide containment or Windows/macOS process-tree certification. Application-owned
process groups do not claim authority over deliberately escaped sessions.
