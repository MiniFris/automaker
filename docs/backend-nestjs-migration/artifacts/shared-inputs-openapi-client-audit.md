# Shared inputs, OpenAPI and UI domain clients

## Implemented boundary

Eighteen previously server-local schema files now live under
`libs/contracts/src/domains`: auth, agents, auto-mode, context, event history, files,
Git, GitHub discovery/review/issue validation, ideation, MCP, notifications,
pipelines, prompt enhancement, provider usage, templates and worktrees.
Server paths re-export the identical shared definitions. Public package subpaths
`@automaker/contracts/domains/*` avoid name collisions across domains and preserve
the existing root API. Existing strictness, defaults and runtime refinements remain
unchanged. The local model-timeout provider enum still depends on the canonical
provider list in `@automaker/types`.

`scripts/generate-backend-openapi.mjs` generates a committed OpenAPI 3.1 artifact
from the native route inventory, controller decorators and shared runtime input
schemas. Generation never imports application controllers or provider runtimes.
All 317 HTTP operations are present. Every component reference resolves and each
path placeholder has a required parameter. Route response ownership through `@Res`
is represented with a default response, rather than an invented successful status
or response envelope. CI checks inventory freshness, artifact freshness and four
structural/coverage tests. See [API policy](../../backend-api-contracts.md).

The artifact deliberately reports incomplete coverage: 42 operations have an
unresolved decorated input or raw `@Req` access; all 317 response contracts remain
unverified. Shared-or-no-input counts refer to decorated payloads, not complete
wire validation. Zod refinements not expressible in JSON Schema remain runtime
checks. This artifact does not close the full shared contracts exit criterion.

Twenty-eight UI HTTP namespaces moved from `http-api-client.ts` into domain client
factories under `apps/ui/src/lib/http-domains`. Each receives only the bound
transport methods it uses. Authentication, unauthorized handling, offline detection,
fetch policy and WebSocket ownership remain in the existing client; event
unsubscribe semantics and public method signatures are preserved. Worktree commands
receive an explicit environment inspection port; they still inspect the issued
target before starting execution. Setup consent/credential orchestration,
auth/bootstrap and direct
filesystem helpers remain in the root client for a later responsibility split.
These remaining responsibilities are explicit; line count is not a completion gate.

## Validation

- Shared contracts: 97 tests passed, including malformed mutation inputs and a
  cross-field runtime refinement that JSON Schema cannot fully represent.
- OpenAPI structural/coverage checks: 4 passed.
- Shared package build and UI typecheck passed after extraction.
- UI unit suite: 702 passed before the final worktree namespace extraction;
  final worktree HTTP tests are included in the enclosing checkpoint.
- UI production build, including Electron main/preload, passed; UI client lint
  passed with no errors or warnings.
- Final combined stage checks are recorded in the enclosing checkpoint.
