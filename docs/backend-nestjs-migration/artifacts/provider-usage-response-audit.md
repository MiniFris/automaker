# Native provider usage response contracts

Nine native operations now parse their response through shared schemas:
Claude/Codex/Gemini/z.ai usage, Codex models, Gemini status, z.ai status,
configuration and verification. Usage windows, Gemini quota buckets and tier
metadata, z.ai limits/details and nullable usage data retain their wire shapes.
Percentages, counters, timestamps and plan labels acquire no new range, date or
closed-enum restrictions.

Codex model cache admission currently checks only an array and numeric cachedAt.
Its response intentionally preserves historical array entries, including nulls
and opaque records; this change does not pretend that the cache validates every
model field. Usage/status errors retain their existing bodies, optional messages
and HTTP statuses, including HTTP 200 failures and Codex unavailable HTTP 503.

ProviderUsageController still lets Nest serialize the body while its inspected
helper selects the status. The OpenAPI ownership analysis now recognizes this
status-only passthrough, documents the validated schema under `default` and does
not invent a fixed HTTP 200. Explicit `4XX`/`5XX` ranges keep middleware/global
exception bodies unconstrained rather than claiming every error uses the parsed
handler envelope. Fluent/manual body writes, escaped response aliases
and Response-bound callbacks remain unverified; dedicated negative fixtures
exercise those boundaries.

Native HTTP fixtures exercise all nine operations, nested values/extensions,
nullable/error variants, malformed producer replies, authentication and request
validation precedence. Producers are explicit offline fixtures. Existing passive
usage/environment/ownership contracts additionally exercise the actual services
with private credentials, fake transports and bounded owned processes. No vendor
authentication or paid model calls are used. Final results are recorded in the
combined checkpoint.
