# Native feature, execution and MCP correlation

Native AutoMode composition supplies a trusted `ObserveOperation` dependency backed
by its own ApplicationMetrics. Standalone facades retain an explicit no-op default;
request bodies and persisted bindings cannot supply observers. Feature agent callbacks
run in a feature_execution operation; verification's actual execution commands run
in execution_command operations. The optional legacy pipeline test helper also has
an observation boundary, but it has no production caller and is a separate retirement
candidate. It is not counted as evidence for production pipeline test execution.

Operation context retains the HTTP correlation ID and adds a generated operation ID.
Nested operation/provider records include parentOperationId. Only safe-shaped
session/feature IDs and finite runtime types appear in diagnostic fields. No prompts,
commands, output, full paths or arbitrary errors are passed to Operations records;
metric labels contain only fixed kinds/outcomes. A result classifier preserves
nonzero execution results while observing them as errors. Unknown provider/process/
SSH outcomes take precedence over cancellation. Old string session-ID callers remain
compatible.

A successful MCP inspection aborts its remaining reader during normal cleanup.
The trusted result classifier distinguishes that cleanup from actual shutdown
cancellation; it does not report every successful MCP inspection as cancelled.
Native MCP also registers passive mcp_active_operations and
mcp_unconfirmed_operations gauges. Active means retained logical ownership, including
saved-config lookup and unconfirmed entries, not an OS socket/process count.
Limits remain 16 admitted operations and 32 total gauge registrations per collector.

## Executable evidence

`tests/contract/feature-execution-correlation.contract.test.ts`:

- Actual native HTTP run-feature acknowledges, runs its real feature workflow
  through an offline provider and persists waiting_approval. Feature/provider
  records share the echoed request correlation ID and parent operation identity.
- A separate HTTP verify-feature request executes the four real npm verification
  commands using a private executable. All four command records share that request's
  ID and feature ID; original results and feature status semantics are preserved.
  This is a second request/operation, not a fabricated single HTTP request spanning
  both user actions.
- Another application's feature/execution counters remain unchanged. IDs/payloads
  do not become metric labels and tested secrets/output do not enter Operations logs.
- Actual saved-ID HTTP MCP inspection uses an offline SDK peer. A held settings
  lookup is visible as one active operation without probing resources on snapshot;
  completion returns to zero and records completed with the HTTP correlation ID.

Core metrics units additionally cover nested parent restoration, failed exit result
classification without changing the returned object, owner isolation and unknown
provider/SSH outcomes before cancellation.

This is local structured correlation, not external trace export or a durable run
index. It does not claim a span for every filesystem call, SDK byte, transport frame
or historical unstructured log. Feature operation completion means the observed
invocation settled; persisted feature approval/business status is tracked separately.
An analysis endpoint still pointing at a facade stub was discovered in the next
capability audit and remains explicit next work rather than being declared covered.
