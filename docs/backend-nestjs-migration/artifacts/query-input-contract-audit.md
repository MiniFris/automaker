# Remaining query/path input contracts

The remaining provider model refresh, setup inspection query parameters, ideation
prompt category and timeout provider paths use shared request schemas. Terminal
authentication's body is also shared, covering the fifteenth previously unresolved
operation. No generator, response, provider execution or filesystem behavior is
changed by this owner.

Express 5 uses its simple query parser: an individual key is a string, a repeated
key is an array of strings, and an absent key is undefined. The shared transport
pipe preserves all three shapes without coercion. Refresh is still true only for
the scalar literal `true`; empty strings, other spellings and repeated values
remain false. Bracketed query keys stay literal keys, rather than nested objects.

Transport schemas deliberately do not claim semantic enum acceptance. Existing
service guards validate authMethod, permissions scope and profile through shared
enums **after** admission checks. Existing credential provider validation remains
shared. Bespoke errors, scope/projectPath interaction, absolute path checks,
optional empty projectPath global fallback and default development profile stay
in their original service order. Closed services still return 503 before semantic
400 errors. Ideation's opaque category parameter stays a string; the service
retains its existing `Invalid category` error, without guessing new categories.

Model timeout provider membership comes from the canonical
`@automaker/types.MODEL_TIMEOUT_PROVIDERS` via a shared contracts schema. The server
schema path reexports that definition. The contracts package and workspace lock
metadata add only the existing workspace types dependency; no install or external
dependency resolution was performed.

Terminal authentication accepts object/array/nullish parser inputs and an unknown
optional password. Conditional authentication remains in TerminalAccessService:
passwordless mode permits arbitrary values; password-required mode keeps its
existing 401 `Invalid password`, rather than introducing schema-level rejection.

Validation: shared query/auth/terminal fixture matrices, native HTTP negative and
accepted-value cases, and six existing focused setup/provider contracts. Negative
cases assert no model/credential target resolution, config reads, prompt lookup or
timeout mutation where those operations were previously excluded. The HTTP
fixture also covers duplicate keys and shutdown precedence. Final targeted results:
five shared query/auth/terminal cases, six new native HTTP cases and six existing
focused setup/provider contracts passed. Scoped ESLint and formatting passed;
server TypeScript checking passed before the final small terminal-auth import/pipe
delta, which the root checkpoint will compile against the rebuilt contracts.
Production and test source is frozen after the six-case final native run.
