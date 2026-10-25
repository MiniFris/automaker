# MCP transports, scoped checkpoints and operation correlation

2026-10-25, `refactor/backend-nestjs-migration`.

MCP now owns accepted settings lookup, connection, discovery and cleanup operations.
Limits apply before SDK parsing:2MiB frame/body,4MiB aggregate incoming bytes,
64KiB discarded stderr;16 operations maximum. Existing connect/list deadlines remain.
Native stdio uses its application's environment and supervised Linux process group;
HTTP JSON, HTTP-SSE and legacy SSE use bounded fetch/readers. Unknown cleanup remains
retained, blocks replacement and prevents a clean-close claim. See the
[MCP audit](mcp-bounded-transport-ownership-audit.md) for actual protocol proofs and
non-Linux limitations. Manual saved-ID tests of disabled servers remain compatible.

Direct checkpoints use an explicit native repository and scoped filesystem. Whole
operations are admitted/bounded, session writes serialized, reads bounded before
parse, temporary files unique/private and publication atomic. Corruption, identity
mismatch and ambiguous writes fail closed. All eight native preparation call sites
and native query adapters receive the trusted repository. See the
[storage audit](direct-checkpoint-storage-audit.md).

Provider disposal precedes checkpoint admission closure and the filesystem barrier.
The first full contract run found7 failures because repository integration manually
called the Nest shutdown hook, which Nest subsequently invoked again. The fix uses
explicit cached `ProviderRegistry.close()`: the promise latch exists before synchronous
abort callbacks; the later hook reuses the same drain. Actual scope disposal and
provider finalization happen once, including reentry/failure. All20 affected existing
lifecycle cases passed unchanged except the composition proof, which now observes the
actual early drain and separately verifies one Nest hook call. The repeated complete
contract suite passed.

[Correlation proofs](feature-execution-correlation-audit.md) cover actual HTTP feature
execution→provider and verification→four real private commands. Operation IDs link
nested records, retaining the request correlation. Passive MCP active/unconfirmed
gauges include accepted lookup and retained uncertainty. Result classification
separates successful reader retirement from cancellation and preserves unknown
provider/process/SSH outcomes ahead of cancellation. IDs, commands, prompts, output,
URLs and credentials do not become metric labels or tested Operations payloads.
This is local correlation, not distributed trace export or a durable run index.

## Verification

- Server/packages build, final server build, UI typecheck and server lint passed.
- Complete unit suite:4044 passed,40 skipped.
- Complete contract suite:776 passed,1 opt-in skipped.
- Package/UI projects:1751 passed. Complete SSH tier:136 passed with Chromium.
- Architecture:33 passed; OpenAPI proofs:21 passed. All inventories current:
  318 operations,316 JSON+2binary responses,0 incomplete inputs/unverified responses.
- Workload:100features,300mutations,100WS events,11PTY cycles; FD24 throughout,
  children0 and11 observed process identities gone. Exit0, close25.94ms.
- SIGTERM719.2ms/SIGINT230.3ms, exit0. Idle budget passed:import646.5ms,
  composition79.2ms,listen3.62ms,healthp95 1.55ms,RSS226725888bytes,close5.99ms;
  no unexpected resources.
- Formatting/diff checks passed after correcting one test-file layout.

Logs are under `/tmp/automaker-wave21-`: `build.log`, `serverbuild-final2.log`,
`unit-final.log`, `contract2.log`, `packages.log`, `ssh-all.log`, `close-regression.log`,
`architecture.log`, `openapi.log`, `lint-final.log`, `uitype.log`, `workload.log`,
`lifecycle.log` and `baseline.json`. No paid model/vendor calls were performed.

## Concrete next work

The active analyze-project API still reaches a throwing facade stub after its200 ack;
the earlier audit incorrectly attributed a separate Ideation path to this endpoint.
Restore the former project-analysis events and `.automaker/project-analysis.md` through
a real native workflow and verify effects, not mocked acknowledgement alone.

Native CLI discovery still consults ambient PATH/HOME in several adapters despite
scoped execution environment. Codex OAuth/mode selection, Cursor's static versions
path and Copilot SDK cliPath need explicit application discovery authority and actual
private executable proofs. An unreachable generic pipeline test-step island and its
unused TestRunner owner should be retired with behavior moved to actual native tests.

The last packaged/upgrade evidence concerns the earlier source named in
[artifact acceptance](current-artifact-acceptance-checkpoint.md); final artifacts must
be refreshed. Remaining plan gates, conditional OS evidence and external rollout are
not declared complete. The overall goal remains active.
