# AutoMode JSON response contracts

All 17 native `AutoModeController` handlers now parse public runtime response
schemas from `@automaker/contracts/domains/auto-mode-responses`. The existing
pending plan approval response/ticket schema is reused through this subpath.
No root barrel, dependency, generator, provider, workflow or storage changes are
part of this slice.

Schemas cover accepted acknowledgements; start/already-running and active/inactive
stop replies; global/scoped running lists and worktree metadata; verification,
context and stop booleans; nullable commit hashes; approval decisions; reconcile
counts and messages. Nullable/empty branch names and opaque string IDs/hashes stay
valid. Stored numeric concurrency remains a plain number, including legacy zero,
negative and fractional values. Duplicate feature IDs across projects are valid.
Owned envelopes are typed while extension fields remain available. The existing
pending approval schema retains its established ticket/extra-field behavior.

Manual merge HTTP 400 responses are unchanged. Existing request/path validation,
approval conflict and shutdown admission errors reach their established handlers
before success parsing. Invalid application successes become safe HTTP 500 replies
through the existing global exception filter. No new error protocol is introduced.

## Targeted evidence

- Two shared-schema matrix tests cover valid false/null/legacy numeric variants,
  extensions, global/scoped status and malformed owned fields/tickets.
- Four native HTTP cases cover every operation through real native application
  services with explicitly empty provider registration and offline runtime spies;
  held execution proves immediate acknowledgement without waiting for completion.
  Additional variants exercise active stop, already running, negative fractional
  concurrency, global duplicate IDs, false verification/approval, null commit,
  pending ticket and zero reconciliation.
- A 17-operation malformed application-success matrix asserts safe 500 errors.
  Separate wire checks preserve invalid-request 400 before merge invocation,
  existing merge error text/status 400, stale approval 409, path rejection 403 and
  closed command admission 503.
- The parent coordinates the single shared build. Scoped ESLint, server no-emit,
  formatting and targeted tests are the checks for this slice; no full suites,
  vendor calls, GUI, commit or branch operation were run by this owner.

These contracts describe native JSON acknowledgements and snapshots. Background
feature completion, provider/event streaming and manual merge error bodies are not
claimed as newly validated success response families.
