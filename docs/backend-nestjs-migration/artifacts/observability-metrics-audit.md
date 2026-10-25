# Native application metrics

The default METRICS token now aliases one per-application ApplicationMetrics
instance. HTTP completion/disconnect counters and duration histograms use fixed
route templates; provider registry query leases report outcomes, durations and
retained active ownership when cleanup is unconfirmed. Collector cardinality is
bounded to 2048 series, reserves provider capacity, rejects invalid observations
and exposes dropped counts. No periodic timer or exporter resource is created.

ProviderRegistry now requires the metrics dependency explicitly; standalone test
registries construct it explicitly rather than falling back to a process global.
ProviderExecutionScope receives a pure optional observation callback so adapters
do not import Nest telemetry. Observer failures do not change query ownership or
return values. Normal execution errors are distinguished from cancellation before
the internal finally-block aborts for cleanup.

The authenticated `/api/metrics` response is validated by a shared runtime schema.
The OpenAPI generator now recognizes a single direct shared `.parse()` return and
uses output JSON Schema, keeping input/output component identities separate.
Other responses remain explicitly unverified. No TypeScript annotation is used
to claim runtime response coverage.

Targeted tests: 8 collector/HTTP/provider-observer unit cases plus 20 existing
registry/execution cases passed. A real two-application HTTP/provider contract
passed: unauthenticated metrics returns 401, authenticated snapshots validate,
HTTP request id reaches the provider, aggregate ownership stays isolated, and
snapshots omit private prompt/key/path/request-id values. Five OpenAPI checks
pass. Final combined stage results are recorded in the enclosing checkpoint.

See [operations and limitations](../../backend-observability.md). This is local
HTTP/provider correlation and aggregate telemetry, not full distributed tracing,
queue/process metrics, complete workflow observability or production load SLOs.
