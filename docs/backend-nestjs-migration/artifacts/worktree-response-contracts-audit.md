# Worktree JSON response contracts

All 59 native WorktreeController handlers now parse awaited replies through `domains/worktree-responses.ts`: 14 read/environment routes, 27 application mutations/workflows and 18 host/text/process routes. Parsing wraps the existing cancellation call; disconnect listener lifetime, producer algorithms, Git/process ownership and exception handling are unchanged. Every handler returns JSON; `@Res({passthrough:true})` only supplies cancellation signals, with no binary/manual-send exemption in this controller.

The schemas validate owned response fields and nested operation results, counts, conflict/no-op flags, logs, editor/terminal projections and local/managed process variants. Real execution descriptors reuse `GitExecutionEnvironmentSchema`. Short file-diff responses without descriptors, nullable default terminals, nullable process exit/finish fields and false operation outcomes remain valid.

Historical pinned-list branch/type metadata remains opaque: its read guard does not guarantee current enum/string values. The derived path/target identity and computed list flags are checked. Unvalidated upstream gh PR metadata also remains opaque; worker-owned PR outcome flags are checked. No stronger certification of historical metadata or upstream PR internals is claimed.

Focused evidence, Node 22.22.3:

- 121 shared cases passed: fixtures and malformed owned-field checks for every handler, explicit historical pinned metadata, upstream opaque PR records, managed process variants and nullable terminal compatibility.
- 61 native contract cases passed: all 59 real HTTP handlers receive valid and malformed offline producer replies; auth/path/request/domain-error precedence is preserved. A separate private Git repository exercises actual initialization, environment/list/info/status/diff reads, no-op commit, stage/commit and log responses.
- Server `tsc --noEmit`, owned controller ESLint, formatting and whitespace checks passed. Root executed the coordinated shared build. Controller formatting was minimized without changing the tested AST behavior.

Tests do not invoke GitHub, models, desktop launchers, dev/test commands or user repositories/processes. The private Git commands operate only inside the test-created directory. Response schemas do not certify WebSocket event payloads or redesign operation lifecycle behavior. There are no postponed Worktree JSON handler families in this slice.
