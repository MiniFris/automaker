# Application-owned runtime logging

Native startup and settings runtime effects now update the application's injected
`ApplicationLoggingPolicy`; neither changes process-global logger or request-log
state. The settings API, persistence/events and existing logger declarations stay
unchanged. Host snapshot values initialize level/colors/timestamps/request logging;
saved settings and subsequent UI updates apply to that instance's mutable policy.

The browser-compatible utils logger accepts optional contextual configuration
lookups without importing Node code. The server explicitly installs one stateless
lookup into its `AsyncLocalStorage` bridge. That lookup holds no application
instance or current-policy global; policies live in their async contexts. Existing
global logger setters/defaults remain the fallback outside application contexts.
Module-level loggers consult the active policy at each write, including callbacks
accepted before a later settings change.

Native composition, Nest initialization/listen, managed shutdown, HTTP middleware
and WebSocket upgrade/connection/message/event-data boundaries enter their owner
context. Promises, timers and spawned async work created within those boundaries
inherit it. This avoids rewriting every service logger or introducing an app
registry. Direct service calls made outside an application context deliberately
retain the global legacy fallback.

`enableRequestLogging=false` suppresses the native request-completed log only.
Correlation response headers and HTTP request/duration metrics continue to be
recorded for both completed and aborted requests. Previously the native middleware
did not read that flag at all; the legacy request-log state getter had no native
callers. No morgan behavior is claimed for the native transport.

## Targeted evidence

- Utils: 24 tests passed (23 existing logger cases and a new contextual lookup/
  mutable policy/legacy fallback case). No new Node dependency enters UI utils.
- Server units: 31 cases passed across logging policy, existing logger fallback,
  runtime lifecycle and application metrics. Nested/parallel async owners and
  exception restoration are covered.
- Four native HTTP/WebSocket cases passed using private profiles and no providers:
  two actual apps retain different levels during parallel requests and held async
  callbacks; changing A updates its previously accepted callback without changing
  B or the global fallback. Request output toggles independently while correlation
  headers and metrics remain. Actual WebSocket upgrades and managed shutdown run
  under the owner policy. Saved startup defaults do not mutate the process level.
- Server no-emit, scoped ESLint, formatting and diff checks passed. The parent ran
  the coordinated utils build; this owner ran no parallel package build, full
  suite, vendor/network service, GUI, commit or branch operation.

Logs: `/tmp/logging-policy-utils.log`, `/tmp/logging-policy-unit.log`,
`/tmp/logging-policy-native.log`, `/tmp/logging-policy-tsc.log` and
`/tmp/logging-policy-lint.log`.

The server Vitest config adds an explicit `@automaker/utils/logger` source alias
before the existing root alias, preserving a single logger module for the test
graph. Root/UI configs have no conflicting broad utils source alias.
