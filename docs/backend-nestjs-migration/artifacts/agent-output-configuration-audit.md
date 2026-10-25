# Captured agent output policy

`AgentExecutor` already captures its host environment at construction. The remaining
per-execution ambient read of `AUTOMAKER_DEBUG_RAW_OUTPUT` now uses that snapshot.
Accepted values `true` and `1`, output paths, raw JSONL format and ordinary output
semantics are preserved. No new process registry or configuration lookup is added.

The native filesystem contract configures raw output explicitly on the application
instead of enabling it through `vi.stubEnv`. Its new two-application case constructs
one enabled and one disabled application, mutates both caller-owned environment
objects and the ambient flag, then executes real features through the native
facades and an offline provider. Enabled output remains valid raw JSONL with an
assistant event; disabled output remains absent. Ordinary output exists in both.
The disabled application still follows its policy after the enabled app closes.

Focused verification on 2026-10-25:

- 11 native execution-filesystem contracts passed, including the new policy case
  and existing ownership/foreign-root/stale-memory/corrupt-recovery checks.
- 63 AgentExecutor/summary unit cases passed.
- The first new assertion used the wrong JSONL shape (`type` instead of
  `event.type`); the fixture assertion was corrected to the established format.
  Production output format was not changed to satisfy the test.

Logs: `/tmp/automaker-wave23-debug-contract-final.log` and
`/tmp/automaker-wave23-debug-unit.log`. These are focused results; the joint wave23
checkpoint follows the public-port and uncertainty changes.
