# GitHub and MCP runtime response contracts

All 14 native JSON handlers now parse awaited producer replies through shared schemas in `domains/integration-responses.ts`: GitHub discovery (3), review/comments (3), issue validation (6) and MCP connection/tools (2). Existing request schemas, HTTP 200 acknowledgements and centralized exception handling remain unchanged.

The contracts validate owned envelopes, remote fields, linked-PR projection, comment/review projection, statuses, acknowledgements, MCP tools and connection metadata. CLI issue/PR records require only their existing validated numeric identity; upstream extras remain opaque. Historical stored validations follow the actual read guard: required metadata types and a non-null analysis container. Historic analysis values, array containers and unvalidated metadata remain opaque; this does not certify analysis semantics. Unknown MCP tool discovery stays absent rather than becoming an empty list. Optional undefined properties still disappear during JSON serialization; explicit null validation and false acknowledgements remain intact.

Focused checks with Node 22.22.3:

- 18 shared-schema cases passed, including historic records, opaque extras, absent MCP discovery and a malformed owned-field matrix.
- New native HTTP contract: 17 cases across all 14 handlers, offline read/mutation/MCP ports, real stored legacy data, malformed application replies and auth/path/request/producer-error precedence.
- Existing discovery/review/validation lifecycle/filesystem cases passed (19), and existing private MCP transport cases passed (7): 43 distinct native cases across targeted runs. The first new error-precedence assertion was corrected from 401 to the existing wrong-key status 403; production did not change.
- Server `tsc --noEmit`, owned production ESLint, formatting and whitespace checks passed. Shared build was coordinated and executed by root.

No GitHub/model/vendor calls, route algorithm changes or new lifecycle behavior were introduced. The existing MCP transport tests use their private local fixture only. WebSocket event payloads, upstream opaque fields and historical analysis internals are outside this response-contract certification.
