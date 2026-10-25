# AppSpec, BacklogPlan and Ideation response contracts

All 27 native JSON handlers now parse public shared response schemas: six AppSpec,
five BacklogPlan and sixteen Ideation operations. Schemas live in the wildcard
public subpaths `domains/planning-responses` and `domains/ideation-responses`;
root barrel, generator, inventories and dependencies are unchanged.

Planning accepted responses retain both true and false/error variants at HTTP 200.
AppSpec status validates owned running/type/start metadata while preserving global
status without project metadata. Stop remains an accepted interruption, not false
proof that a held job has settled. Backlog status preserves nullable savedPlan;
the saved plan schema mirrors the actual store guard (result.changes is an array)
without inventing constraints on legacy savedAt/prompt/model or change contents.
Applied-change labels remain arbitrary strings, with no new ID/prefix restrictions.

Stored ideas, messages, session metadata and cached analysis preserve extension
fields and legacy raw labels/null/numeric timestamps. Fresh session creation checks
its actual owned metadata; session reads validate owned isRunning/message-array
envelopes without imposing fresh-session enums/timestamps on stored metadata.
Prompt catalogs type their actual owned string fields with extensible category
labels. Suggestions type their generated id/category while preserving raw provider
fields such as priority, relatedFiles and extra values. No new request-side or
storage restrictions are introduced by these response schemas.

## Targeted evidence

- Five shared schema matrix tests passed, including false accepted outcomes,
  global/scoped job status, minimally guarded legacy plans, raw applied labels,
  null timestamps and extensible idea/session/message/analysis/suggestion data.
- Six native HTTP cases passed, covering every operation and a 27-handler
  malformed-application-success matrix. Invalid successes become safe 500 replies;
  the existing missing 404, invalid category 400, storage/unavailable 503 and EIO
  500/code precedence remain unchanged.
- Planning fixtures use explicit offline workflow ports and held promises. All
  generation variants and duplicate false responses are exercised; stop aborts
  the owned signal while status stays running until actual settlement.
- Backlog fixtures exercise native saved-plan load/clear and real feature
  delete/add/update apply, preserving custom feature data and response labels.
- Ideation uses an explicitly registered offline provider, exercising real session
  message, suggestions and analysis without a vendor call. CRUD, conversion,
  add-suggestion and prompt catalogs run through the native application. Real
  legacy fixture files prove metadata/extension preservation on storage reads.
- Scoped controller/test ESLint, server no-emit, formatting and diff checks passed.
  The root performed the single coordinated shared build; this owner ran no
  parallel build, full suite, external network, GUI, commit or branch operation.

This completes these native JSON response families. Async accepted replies do not
claim generated document/plan contents or transport/event protocol completeness.
Generic extensible stored records are intentionally described as such, rather than
inventing a restrictive domain model or claiming generic success validates them.
