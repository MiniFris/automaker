# Projects and Features response contracts

Projects has one native operation, overview, which already parses its shared
ProjectsOverviewResponseSchema. Its production controller/schema remain unchanged;
the new native fixture verifies a populated overview and its malformed-application
success boundary.

All 17 native Features operations now parse shared public response schemas from
`@automaker/contracts/domains/feature-responses`. No root-barrel, generator,
inventory or package metadata change is needed. The family covers GET/POST list,
get/create/update, nullable agent/raw output, delete boolean, bulk update/delete,
JSON/YAML export, conflicts, import, orphan list/single/bulk resolution and title.

PublicFeatureDataSchema is deliberately an extensible `record<string, unknown>`.
It validates that a feature is an object, without inventing mandatory feature
fields, status enums, title types or ID restrictions on stored/user-defined data.
Envelope and result extensions pass through; conflict titles likewise retain
legacy arbitrary values. Owned identifiers in operation results remain opaque
strings without response-side trimming or new length/path constraints.

Bulk/import/conflict schemas validate the actual result records and nonnegative
integer counts. Coherence checks reflect current service algorithms: successful
and failed counts match per-item booleans, top-level success matches all-success,
updated feature count matches successful updates, and conflict count/flag matches
its records. Partial false-success booleans remain valid HTTP 200 responses;
delete's false boolean and existing errors are not turned into schema failures.

Export validates its actual outer text/format/contentType/filename pairing.
Serialized JSON/YAML is not decoded by a new shared runtime dependency. Native
fixtures decode both outputs with the existing serializer and check their inner
record/count/metadata behavior. The title contract covers the service's guaranteed
nonempty generated string, not user-defined feature titles.

## Targeted evidence and discovered functional regression

- Four shared-schema matrix tests passed, including extensible record values,
  envelope extensions, null/empty output, formats and partial/empty count outcomes.
- Six native HTTP cases passed. Every Features handler receives an actual valid
  request; a 17-handler malformed application-success matrix also proves boundary
  rejection. Projects overview is checked separately in that fixture.
- Actual private storage CRUD, both list methods, output reads, JSON/YAML export,
  conflict maps, raw/single import, overwrite refusal/success, mixed bulk import
  (one success/one failure), all-valid bulk import (two successes), empty import,
  orphan resolution variants and title (without a model call) are covered.
- A scoped filesystem read EIO retains its 500/EIO response; application failure
  status 503, missing feature 404 and delete false/200 remain unchanged.
- Server no-emit, scoped controller/test ESLint and formatting/diff checks passed.

The real bulk-import fixture exposed existing option shadowing: FeatureCommandService
passed request `data` as an option, and FeatureExportService spread options after
its per-record data. The root agent fixed option filtering and made the owned
record win the merge. The native tests now verify actual successful and mixed
bulk imports; they do not replace that behavior with a fake partial response.
The initial fixture also referenced a nonexistent raw-output writer and used a
valid YAML scalar as its malformed text; those test mistakes were corrected to
scoped output writing and an invalid flow sequence, without weakening production
validation.

No storage/process service, terminal runtime, network/GUI/full suite, commit or
branch was changed/run by this response-contract owner. The root's separate
bulk-import implementation and shared build are explicitly coordinated. This is
complete coverage for these two native response families, not a claim that every
backend response or error/stream contract is complete.
