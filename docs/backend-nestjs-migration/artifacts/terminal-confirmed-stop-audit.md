# Explicit terminal stop outcome

Native `DELETE /api/terminal/sessions/:id` now awaits
`TerminalService.stopSession`, which waits for the existing owned PTY/group
lifecycle confirmation. Confirmed cleanup retains `{ success: true }` and HTTP 200;
a missing identity retains the existing 404/error. An unconfirmed cleanup returns
503, `errorCode: UNAVAILABLE`, `code: TERMINAL_CLEANUP_FAILED` and the existing static
identity-retained message. No raw process diagnostics are exposed. A known session
without its lifecycle owner is also uncertainty, rather than a false missing 404.

The synchronous `killSession` boolean API remains an acceptance-only compatibility
wrapper. Lifecycle deadlines, process-group ownership, managed transport exit proof,
session binding and startup-command claiming are unchanged. Awaited stop does not
release a session while its cleanup promise is held. Failed cleanup keeps the
identity, rejects input and rejects reconnect with existing GET 503 / WS 4005 gates.

The UI removes a single panel and command metadata only after a confirmed success
or missing response. HTTP failure, invalid success bodies and network uncertainty
retain the original identity/layout and show a retry message (EN/RU). Closing a tab
stops all its sessions and retains panels whose stop failed. Saved-layout restore
keeps unknown identities; only explicit missing 404 drops them. Unknown is not
counted as a successful reconnection and never triggers replacement creation.
WS 4005 stops the reconnect loop while leaving the recoverable panel present.

Native TerminalRuntimeModule also supplies the application's SECURE_FILESYSTEM
stat port, RuntimePathsService/SecurityService canonical resolution and snapshot
home when available.
Native no-cwd/missing-directory fallback validates the snapshot home and, if that
home is missing or unauthorized, the explicit application allowed root/working
directory through the same policy and stat port. Requested DENIED/EIO/closed-FS
errors propagate without starting a shell; only true ENOENT or a nondirectory
request may select the authorized fallback. A missing native HOME snapshot never
uses ambient os.homedir. Direct constructor callers preserve their existing defaults. This closes the
preflight stat/global-path dependency in that call chain; it does not claim all
terminal theme/RC file IO, shell detection or subprocess environment reads have
been moved to native ports. The broader terminal environment/RC paths remain outside this preflight slice.

Targeted evidence: 57 terminal service units passed, including a held stop promise,
injected preflight ports, missing native HOME and DENIED/EIO no-launch cases.
The existing input/closing-admission group passed four cases; the final changed
stop file passed three cases, including actual native no-cwd PTYs with unauthorized
and absent configured HOME. The real Linux
case uses an owned TERM-resistant PTY root/child and checks their original group is
quiescent before DELETE success. The held fixture proves pending response and
retained identity, then 503/GET 503/WS 4005 on uncertainty without executing input.
Twelve UI stop/environment cases passed, including partial tab closure and unknown
restore. Scoped server/UI ESLint, server no-emit and UI typecheck passed. No full
suite, Docker/SSH, GUI, provider call, commit or branch change was performed here.

These targeted results close the concrete explicit-stop behavior gap. They do not
replace the parent's combined checkpoint or certify new Windows/macOS/remote
acceptance. The broader terminal filesystem/theme/environment port extraction
remains separate from the narrow preflight dependency changed here.
