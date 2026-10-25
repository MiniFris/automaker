# Terminal HTTP input contracts

The three native terminal inline validators now consume named shared schemas in
`libs/contracts/src/domains/terminal.ts` through direct full-body `safeParse` calls.
Their existing response branches retain the same HTTP statuses and error strings.
Defaults remain in the controller (80 columns / 24 rows); neither parsing nor
metadata introduces coercion, strict unknown-key rejection or PTY work.

Create/settings retain the historical array-as-empty-options behavior. Create also
retains its nullish empty-options boundary. Optional empty shell and environment
target strings remain accepted; cwd must remain nonempty and contain no NUL.
Columns, rows and session limits preserve their inclusive integer bounds. The
terminal service keeps its public `MIN_MAX_SESSIONS` / `MAX_MAX_SESSIONS` exports
as aliases of the shared domain constants (unchanged values 1 / 1000).
The shared opaque session ID schema is only `z.string()`, used by the existing three
parameter pipes; it introduces no path/identifier restriction.

Evidence: two shared schema tests passed (acceptance/rejection matrices), and two
native HTTP fixture tests passed (invalid inputs never invoke create/resize/limit
mutation; defaults, ignored keys, arrays, boundaries and opaque ID 404 responses).
The existing native shell health-start/status/terminal WebSocket cases also passed
(three cases). The initial filtered shell attempt omitted that file's prerequisite
health-start case; rerunning with that prerequisite passed. Contracts build,
targeted controller/test ESLint and scoped diff checks passed.
The final shared-constant alias delta also passed the existing terminal service
unit file (53 cases) and repeated native input fixtures (two cases).

Server TypeScript checking initially reported the concurrent, unrelated
`feature-state-manager.ts:609` possibly-undefined planSpec access; that file belongs
to the root agent and was not changed here. Auth/logout bodies, terminal runtime,
process ownership, WebSocket behavior and PTY lifecycle are outside this bounded
input-contract change. Root owns safeParse-aware OpenAPI generation.
