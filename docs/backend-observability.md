# Backend observability

`GET /api/metrics` returns a shared `MetricsSnapshotSchema` document and uses the
normal API authentication guard. It performs no provider/authentication probes or
filesystem mutations. Each application owns its collector; data resets when that
application restarts. Metrics are aggregates in memory, not a durable time-series
database or a cross-process exporter.

## Measurements

- `http_requests_total` and `http_request_duration_ms`: one observation per
  completed or disconnected response. Labels are HTTP method, registered route
  template, status and outcome. Unmatched requests use `unmatched`; unrecognized
  methods use `other`. Raw URLs, query strings, session identifiers and request
  bodies are not metric labels. The current metrics request is counted after its
  response finishes, so its own snapshot does not include that request yet.
- `provider_queries_total`, `provider_errors_total` and
  `provider_query_duration_ms`: registry-owned queries that actually started,
  grouped by completed/error/cancelled/unknown outcome. These are aggregate counts
  across providers. Passive discovery/status reads do not start query metrics.
- `providerActiveQueries`: queries still owned by the registry. Unconfirmed
  iterator cleanup retains the active count; it does not become a successful
  cancellation. Normal failures remain errors even when cleanup aborts the
  internal controller.
- `uptimeMs`: monotonic time since this collector was created.

There are at most 2048 aggregate series, with 16 reserved for provider outcomes so
HTTP cardinality cannot starve them. Invalid/excess measurements increment
`droppedMeasurements`. Existing series continue accumulating after the limit is
reached. Histograms have fixed cumulative finite bounds from 1 ms to 30 s, plus
total count/sum/min/max. Values above the last bound remain in the total count;
there is no claim of an exact percentile. Snapshots copy internal data and cannot
mutate the collector.

## Correlation

HTTP responses echo a validated/generated `x-request-id`. Async context carries
that correlation id into registry-owned provider execution, including detached
work created inside the request. With `LOG_LEVEL=debug`, the `HTTP` logger emits
completion records and the `Operations` logger emits provider start/settlement
records with `correlationId`, a generated `operationId`, outcome and duration.
Provider prompts, output and raw exceptions are not included in these records.
Consumers that start work outside an HTTP context have no invented HTTP id.

The global HTTP exception filter logs only status, a fixed error category and
correlation id for unexpected/server failures. It does not log exception messages,
stacks or arbitrary thrown objects: credentials and prompts can occur inside plain
strings where key-based redaction cannot remove them reliably. Existing safe error
envelopes and intentional domain/HTTP error responses keep their wire behavior.

This supplies local structured correlation. It does not implement distributed
tracing, external trace export, execution transport spans or a persistent job/run
index. Existing provider/application logs are not all normalized by this slice.

## Initial operational thresholds

These thresholds identify conditions for investigation, not an approved workload
SLO or a reason to restart an application automatically:

- Investigate any increase in `droppedMeasurements`; coverage is being lost.
- Investigate an `unknown` provider outcome immediately. Check owned process and
  shutdown diagnostics; do not start a replacement query against uncertain state.
- Investigate active provider queries that remain after their commands finish or
  after shutdown should have drained them. A nonzero value during an active stream
  is expected.
- Collect production baselines for error rate and latency before selecting an
  alert window. Cancellation is a separate outcome, not a provider error.

Startup/idle resource limits remain in `scripts/server-performance-budget.mjs` and
the dedicated CI job. The collector does not yet expose filesystem queue depth,
PTY/process leak gauges, scheduler/job metrics or startup phase histograms. Full
orchestration/execution tracing and production load acceptance remain open.
