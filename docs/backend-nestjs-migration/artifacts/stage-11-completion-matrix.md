# Stage 11: completion evidence

Source review after `67948aa8`, including the wave23 source freeze. The parent
owns the final combined build/test/artifact checkpoint; focused results below do
not replace it. Rows map the original checklist, rather than introducing new
acceptance requirements.

## Application boundary implementation

The first 19 application/query/command classes now use ordinary constructors. Their
19 `@Injectable` and 61 `@Inject` annotations move into 14 context-local
`application.providers.ts` files with explicit factories/inject arrays. Existing
class tokens, constructor argument order, useExisting aliases and lifecycle method
names remain. These factories assemble dependencies; they do not introduce another
session/run owner. Actual native composition/close contracts cover the result.

The first slice adds 101 independent interfaces in 14 `application.inputs.ts` files:

| Context                           | Inputs |
| --------------------------------- | -----: |
| AppSpec                           |      3 |
| Settings                          |      5 |
| Files                             |      4 |
| Features                          |      9 |
| Sessions                          |      2 |
| BacklogPlan                       |      2 |
| Ideation                          |     11 |
| Git                               |      4 |
| Worktree                          |     34 |
| Agents                            |      6 |
| Pipeline                          |      6 |
| MCP                               |      1 |
| AutoMode, including plan approval |     12 |
| Provider connection               |      2 |

The original 17 schema-consuming classes accounted for 97 types. Two plan
approval types and two provider connection types add four; 18 classes use the
interfaces, while DirectSettingsCommand already has plain inline inputs. Provider
connection also has two independent Result interfaces. These are owned structural
values, not aliases to Request/Zod types. Git/Worktree retain open record fields
needed by their existing generic adapter forwarding. Controllers retain parsing,
defaults and response validation; no shared wire schema changes.

`FeatureMergeError` is an ordinary application error. AutoModeController alone
maps it to the existing HTTP400 body/errorCode. Native contracts compare both
common/SSH endpoints, including correlation and the exact response key set.
Business errors import `core/errors/domain-errors` directly, avoiding the barrel
that re-exports Nest components.

The new error-level ESLint application rule rejects Nest/Express, request-schema
imports, Request contract aliases and dynamic assembly in these classes; their
input files cannot recover request types through unchecked helper imports.
Factories remain under existing module rules. The module graph proof is unchanged:
provider factory imports do not weaken unknown module-import/cycle detection.

Focused proof: **36 native contracts**, **47 unit tests**, **38 architecture/module
graph tests**, server no-emit and module error-only lint pass. Logs:
`/tmp/automaker-wave23-plain-application-contract-final.log`,
`/tmp/automaker-wave23-plain-application-unit.log`,
`/tmp/automaker-wave23-plain-application-architecture.log`,
`/tmp/automaker-wave23-plain-application-tsc-green.log`,
`/tmp/automaker-wave23-plain-application-lint-final.log`.

## Original checklist mapping

| Item                                        | Evidence / exact scope                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11.1 Narrow facade use cases                | [Public ports](auto-mode-public-ports-audit.md): seven native consumers use capabilities/read models/lifecycle; one internal owner.                                                                                                                                                                                                                                                      |
| 11.1 Separate commands/queries where useful | FeatureCommand/FeatureQuery, SettingsCommand/SettingsQuery, FilesCommand/FilesQuery; 19 plain use-case factories above. No CQRS framework required.                                                                                                                                                                                                                                      |
| 11.1 Remove transport DTO dependency        | 19 classes now have independent inputs/results above. The six additional semantic auth/verification/GitHub use cases are also plain with explicit factories and parsing ports; see the final boundary proof below.                                                                                                                                                                       |
| 11.1 Transaction/lock boundaries            | [Feature transactions](stage-5-feature-state-transactions-audit.md), [agent storage](agent-storage-recovery-session-checkpoint.md), [Ideation concurrent HTTP](ideation-collaborators-audit.md), [execution intents](feature-execution-uncertainty-audit.md).                                                                                                                            |
| 11.1 Required composition                   | Native factories pass all 82 original dependencies plus four required validation ports; [native foundation contract](../../../apps/server/tests/contract/native-foundation-composition.contract.test.ts) and [public ports](auto-mode-public-ports-audit.md) prove actual owner/alias identity. Explicit standalone defaults and optional credentials do not hide missing native owners. |
| 11.2 Feature lifecycle                      | [Feature run state machine](../../../apps/server/src/modules/orchestration/feature-run-state-machine.ts), [native state contract](../../../apps/server/tests/contract/native-feature-state.contract.test.ts).                                                                                                                                                                            |
| 11.2 Agent lifecycle                        | [Session state contract](../../../apps/server/tests/contract/agent-session-state.contract.test.ts), [agent storage/recovery](agent-storage-recovery-session-checkpoint.md): serialized execution, queue delivery, interrupted recovery and tombstones.                                                                                                                                   |
| 11.2 Pipeline lifecycle                     | [Actual custom pipeline](../../../apps/server/tests/contract/native-custom-pipeline.contract.test.ts), [durable uncertainty](feature-execution-uncertainty-audit.md): ordered/excluded/resumed steps, merge conflicts, retained unknown outcomes and restart admission.                                                                                                                  |
| 11.2 Terminal/test/dev lifecycle            | [Terminal confirmed stop](terminal-confirmed-stop-audit.md), [local process ownership](native-local-process-ownership-audit.md), [host environment contract](../../../apps/server/tests/contract/local-process-host-environment.contract.test.ts). Explicit admission/closing/unknown guards are lifecycle states without requiring one shared FSM class.                                |
| 11.2 Environment preparation                | [Bindings](../../../apps/server/src/services/execution-environment/bindings.ts), [preparation contract](../../../apps/server/tests/contract/provider-preparation-host-environment.contract.test.ts): pinned targets, consent/preflight, cancellation and no host fallback.                                                                                                               |
| 11.2 Transition errors/recovery             | Feature transition units, session/queue/deletion journals, SSH recovery and [feature intents](feature-execution-uncertainty-audit.md). Confirmed cancellation differs from retained uncertainty.                                                                                                                                                                                         |
| 11.3 Scoped security/filesystem             | [Native path contract](../../../apps/server/tests/contract/native-path-policy.contract.test.ts), [FS lifecycle](filesystem-lifecycle-audit.md), [Direct policy checkpoint](fsm-direct-policy-process-checkpoint.md), [captured agent output](agent-output-configuration-audit.md).                                                                                                       |
| 11.3 Filesystem repositories                | FeatureLoader transactions, settings/agent/auth/notification repositories and [Ideation repository/concurrent patches](ideation-collaborators-audit.md); strict mutation reads and ordered drain.                                                                                                                                                                                        |
| 11.3 Git local/remote                       | ProjectGitService/FeatureWorkspace ports; [custom pipeline contract](../../../apps/server/tests/contract/native-custom-pipeline.contract.test.ts) executes real Local clean/conflicting Git; [execution contract checkpoint](state-execution-contract-checkpoint.md) records distinct remote acceptance.                                                                                 |
| 11.3 Process/PTY                            | [Owned process checkpoint](owned-process-response-checkpoint.md), [terminal stop contract](../../../apps/server/tests/contract/terminal-stop.contract.test.ts), [local process contract](../../../apps/server/tests/contract/native-local-process-ownership.contract.test.ts).                                                                                                           |
| 11.3 Docker/SSH                             | Issued execution bindings and explicit runtime interfaces; [state/execution checkpoint](state-execution-contract-checkpoint.md) records actual owned Docker/SSH acceptance, including opt-ins. This is not external infrastructure/OS acceptance.                                                                                                                                        |
| 11.3 Provider SDK/CLI                       | [CLI discovery and diagnostic policy](native-cli-discovery-audit.md), scoped provider execution leases and default native factory contracts. Private fixtures exercise actual adapters without paid vendors.                                                                                                                                                                             |
| 11.3 GitHub/MCP/notification                | [GitHub repository boundary contract](../../../apps/server/tests/contract/github-repository-boundary.contract.test.ts), [bounded MCP transports](mcp-bounded-transport-ownership-audit.md), [notification confidentiality contract](../../../apps/server/tests/contract/notification-transport-confidentiality.contract.test.ts).                                                        |
| 11.5 Structured ids                         | [Workflow correlation](transport-context-terminal-observability-checkpoint.md), [feature/execution/MCP proof](feature-execution-correlation-audit.md). Structured operation records coexist with historical diagnostic logs.                                                                                                                                                             |
| 11.5 Metrics                                | [Metrics](observability-metrics-audit.md), [workflow gauges](transport-context-terminal-observability-checkpoint.md), [MCP ownership gauges](mcp-bounded-transport-ownership-audit.md): startup, active work, loaded queues, errors and retained unknown ownership. These are owned-resource diagnostics, not an OS-wide census.                                                         |
| 11.5 Traces                                 | [Actual HTTP → feature/provider and verification command](../../../apps/server/tests/contract/feature-execution-correlation.contract.test.ts) retains request id/operation parent identity; no external trace exporter is required by this item.                                                                                                                                         |
| Exit: bounded contexts                      | [Ideation collaborators](ideation-collaborators-audit.md), agent repository/coordinator/provider layers, shared AutoMode owner/ports, separate process/PTY transports and feature transaction owner. See size rationale below.                                                                                                                                                           |
| Exit: automated dependency rules            | Source architecture, plain application, public port and pure-kernel ESLint rules; [conservative module graph](nest-module-import-graph-audit.md). Native default composition tests exercise provider resolution; this is not an arbitrary TypeScript-cycle proof.                                                                                                                        |
| Exit: shared API                            | [Shared schemas/OpenAPI/client](transport-context-terminal-observability-checkpoint.md): 318 operations, 316 JSON and two binary responses; version/deprecation policy remains separate.                                                                                                                                                                                                 |
| Exit: investigate one workflow id           | Actual feature/provider/execution/MCP correlation contract above. Metrics contain finite operation/outcome labels, not request IDs/payloads.                                                                                                                                                                                                                                             |
| Exit: contributor architecture              | [Architecture guide](../../backend-architecture.md), referenced by CONTRIBUTING; automated guards enforce the declared boundaries on subsequent changes. This does not predict future compliance without running checks.                                                                                                                                                                 |
| Exit: final checkpoint/commit               | Still open until the parent finishes and records the combined final suites/build/artifact checkpoint in the single migration branch.                                                                                                                                                                                                                                                     |

## Size and ownership rationale

The original 150/400 values are review targets, not unconditional line limits.
The following existing transport/use-case files exceed them; their grouping is
explicit and does not justify unrelated business or resource ownership:

| File / source lines at review                                            | Responsibility explaining the grouping                                                                                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SettingsController 202; ExecutionEnvironmentSettingsController 252       | 19 settings and 20 target/settings routes, schema/guard/delegation. Storage and runtime owners remain separate.                                         |
| FeaturesController 228; FilesController 226                              | 17 feature and 18 file routes with shared schema/guard/binary transport handling. Transactions/stream ownership live behind ports.                      |
| TerminalController 286                                                   | 10 routes plus explicit terminal input/access/response transport contracts; PTY/session ownership is in the service/runtime.                            |
| WorktreeController 818                                                   | 59 wire operations delegated to separate application/process/host/text services. The long shared schema import/decorator surface is transport grouping. |
| WorktreeApplicationService 496 before decorator removal                  | Cohesive project Git/worktree use cases, delegating execution/host/process/text concerns to existing ports/services.                                    |
| SetupController 372; AutoModeController 184 before merge-boundary change | 50 setup and 17 orchestration routes; CLI/auth transports and run/session ownership are separate.                                                       |

Ideation keeps one session/job owner while its repository, project analysis,
context reader, prompt catalog and common text-stream collaborator have separate
responsibilities. Large SDK/CLI and Docker/SSH adapter files remain cohesive
protocol/lifecycle adapters; their size is not itself a requirement for a new
owner or registry.

## Final semantic application boundary

The six additional auth/credential/verification/GitHub owners are treated as
application use cases, not relabelled infrastructure to avoid the requirement.
Their six explicit factories preserve the original 21 injected dependencies;
four auth/credential/verification constructors additionally require a plain
`SetupCommandValidation` port. Total: **25 plain use-case classes**, **82 original
DI dependencies**, **four explicit validation ports**, **15 context-local factory
files**. Existing lifecycle methods remain on the same owner objects.

Four raw-input consumers still safely accept unknown callers, but their captured
validation port returns plain typed commands/targets. Only
`setup-command.validation.ts`, assembled by the factory, loads the existing shared
Zod schemas. Strict confirmation, target equality, masked/provider-key checks,
CLI/API-key mode refinements and normalization remain unchanged. Validation is
required, never an optional native fallback.

The extension adds seven independent command inputs (three GitHub review, three
verification/authentication and one credential change), four portable target
values and three Results. Together with the first slice there are 108 independent
input interfaces. No alias points back to a transport Request/Response/Zod type.
Rate-limit failures use the parent's plain `RateLimitDomainError`; actual HTTP
contracts preserve the existing 429 body/errorCode semantics.

`GithubCommandError` moves to a pure error file. The Node command runtime
re-exports the same constructor, preserving catch/instanceof identity. The four
use cases reference Node SDK/runtime implementations through erased type imports;
their factories alone load runtime class tokens. Domain errors import the pure
file directly, avoiding Nest-reexport barrels.

The plain-use-case rule covers all 25 classes. A services-wide runtime Nest/Express
import guard permits erased lifecycle type interfaces and retains the prior
route/controller restrictions. Its negative fixtures caught an initially
replaced rule overlay; the original exclusions were restored before the final
40/40 architecture/module-graph pass. These guards do not ban HTTP frameworks
from actual controllers, guards, core transports or composition factories.
TerminalAccessGuard's HTTP401/403/passwordRequired shaping correctly remains at
that HTTP boundary. This is verified separation, not a claim that every file
under `modules` is a pure domain kernel or every service is side-effect-free.

Final extension evidence: **103 unit tests** across eight selected files and
**16 native contracts** across six selected files pass, covering credentials,
Claude/Codex verification, GitHub discovery/review and HTTP error-envelope equality.
Server no-emit and core/modules/services error-only ESLint pass. Logs:
`/tmp/automaker-wave23-six-usecase-unit.log`,
`/tmp/automaker-wave23-six-usecase-contract.log`,
`/tmp/automaker-wave23-six-usecase-architecture-final.log`,
`/tmp/automaker-wave23-six-usecase-tsc2.log`,
`/tmp/automaker-wave23-six-usecase-lint-final.log`.

The only still-open stage11 Exit gate is the parent's combined final
build/test/artifact checkpoint and commit. Focused cohorts above are not added
together or substituted for that gate.

## Final native WorktreeResolver boundary

The adjacent verified configuration gap is closed in the actual three query
paths: `getCurrentBranch`, `findWorktreeForBranch` and `listWorktrees`. Native
Global/Facade composition shares one resolver with a copied application host
environment. The native path reuses the owned Local Git executor, strips repository
GIT\_\* authority and backend transport variables, and preserves captured PATH/HOME.
Successful stderr is separate from stdout, so diagnostics cannot become branch or
porcelain data. Only privately classified actual non-repository failure returns
legacy null/[]; other native failure, abort or deadline propagates.

The resolver admits at most 16 accepted queries, including settings/SSH resolution
before child creation. Default query deadline is 30 seconds and cached shutdown
drain is three seconds. Abort stops the owned process group; cleanup uncertainty
retains the query and blocks replacement. A late helper result cannot clear a
failed close or become authoritative empty/branch data. Global cleanup waits for
both notification and Git owners even if one fails, before the filesystem barrier;
no additional Nest provider/hook or duplicated resolver owner is introduced.
Standalone construction without an explicit host environment keeps its legacy
exec/read-result compatibility.

Managed SSH branch selection remains outside the Local catch and receives the
captured application environment/signal. Direct SSH topology find/list requests
fail closed with SSH_PROJECT_REQUIRED instead of executing controller Git or
inventing remote topology. Actual prepared remote feature callers already bypass
Local worktree lookup. This is no new external SSH acceptance claim.

Verification: **26 combined native contracts**, including four new actual resolver
cases, plus **64 unit tests** pass. A final four-case resolver run also checks SSH
success/failure authority and topology no-fallback. Two native apps run all three
Git query paths and authenticated HTTP status after ambient/caller-object mutation;
real private Git wrappers delegate to real temporary repositories and emit benign
stderr. Closing one app aborts a held private Git child, confirms its PID is gone,
and leaves the second app usable. A separate real owned-query deadline reaps its
private child. Unit seams cover bounded admission, retained unknown cleanup and
late completion after a failed close. The old standalone exec fixture uses a
partial child_process mock to preserve the additional imported helper exports.

Server no-emit, scoped production ESLint and diff checks pass. Logs:
`/tmp/automaker-wave23-resolver-contract-final.log`,
`/tmp/automaker-wave23-resolver-contract-authority-final.log`,
`/tmp/automaker-wave23-resolver-unit-final.log`,
`/tmp/automaker-wave23-resolver-tsc-green.log`,
`/tmp/automaker-wave23-resolver-lint.log`.
