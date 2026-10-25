# Stage 8 completion audit

Scope: original stage 8 requirements, not a new hardening backlog. This audit does
not close the stage or replace its original acceptance criteria.

## Implemented in this wave

| Original item                                     | Current evidence                                                                                                                                                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 8.3 Separate pipeline configuration repository    | `PipelineConfigurationRepository` port and `FilePipelineConfigurationRepository`; native PipelineModule injects scoped filesystem and SecurityService.                                                                               |
| Shared native pipeline configuration in execution | Native AutoMode provider receives PipelineService; GlobalAutoModeService, facade FeatureStateManager, ExecutionService and PipelineOrchestrator receive the same instance. The native HTTP contract checks actual instance identity. |
| Pipeline configuration mutation boundary          | Canonical per-project read/modify/write queues preserve concurrent additions and aliases. UUID temp + rename preserves the existing file format; accepted operations are bounded to 256 in native composition.                       |
| Pipeline storage lifecycle                        | `onModuleDestroy` rejects new admission and drains accepted operations before FS before-shutdown. A cached 5 s failure retains pending task ownership and never becomes later success.                                               |
| 8.7 Separate connection test and tool listing     | Native `/mcp/test` uses `testConnectionById` (handshake only); `/mcp/tools` uses `listToolsById`. Legacy `testServerById` remains the combined compatibility API.                                                                    |
| MCP settings UI parity                            | After successful connection the UI explicitly requests tools. Discovery failure/missing catalog stays unknown with a separate warning, not “0 tools”; confirmed `[]` is authoritative.                                               |

Pipeline success/status fields and persisted format remain unchanged. Partial
reordering remains supported because the existing compatibility suite explicitly
requires it; the migration does not redefine that behavior. Native IO failures are
not treated as absent config. Missing/malformed JSON retains its existing fallback.
Legacy direct constructors still have their original compatibility path; native
composition supplies repository/service dependencies explicitly.

## Original requirements still open or only partially proved

| Section                                          | Finding and concrete remaining action                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.1 Orchestration coordinator/state machine      | FeatureRunCoordinator and transition table exist, but no production consumer calls the coordinator. Its mere presence is not completion. Attach real execution ownership/transitions/completion dedup to the actual AutoMode run path and test execute/stop/recovery through native HTTP.                                                                     |
| 8.2 AutoMode project state and facade retirement | Global scheduler/shared concurrency exist, but AutoModeServiceCompat still owns `facadeCache`, and most native AutoModeController endpoints still delegate Express handlers. Replace that boundary with a typed native application coordinator and canonical per-project run contexts, then retire the cache/compat callers rather than simply renaming them. |
| 8.3 Pipeline execution/template boundaries       | Configuration boundary is now explicit. Existing PipelineOrchestrator still owns template/prompt expansion and step execution logic; separation/validation plus complete cancel/unknown-outcome acceptance remain unclosed. Current work does not certify remote UI or all restart cases.                                                                     |
| 8.4 Planning                                     | PlanApprovalService and native typed approval endpoints bind token/run/plan version; existing plan-approval units cover stale/replayed tickets. Full backlog/spec provider-port and restart acceptance must be reconciled with actual callers, not inferred from approval-only tests.                                                                         |
| 8.5 Ideation                                     | Native module owns IdeationService, but the large service still combines session/analysis/idea storage, streaming and conversion. First extract idea repository and conversion transaction boundary; then replace duplicate session streaming with the shared agent/provider path.                                                                            |
| 8.6 GitHub                                       | Native discovery/review/validation ports and request error handling exist. PR creation/worktree helper callers still need the original Git/Worktree module audit. The module alone does not prove that every gh call has moved behind a port.                                                                                                                 |
| 8.7 MCP transport constraints                    | Separate saved-server lookup uses the native SettingsService owner, and stdio fixture contracts cover handshake, tools, timeout, redaction and close. Equivalent SSE/HTTP acceptance and whole transport output constraints are not proved by stdio-only tests.                                                                                               |
| 8.8 Hooks/notifications                          | Typed subscription/task drain exists. Original event-loop/repeated-feature behavior and notification-channel failure isolation still require explicit reconciliation against tests/callers.                                                                                                                                                                   |
| Stage exit                                       | No final stage-8 checkpoint or completion claim. Parent combines this wave with other agents before broad tests. Optional live vendor acceptance remains optional; offline evidence is not presented as live acceptance.                                                                                                                                      |

## Targeted verification

- Existing pipeline/default/isolation/application/orchestrator unit selection: 104 passed.
- New repository units: 6 passed (concurrent writes, canonical alias, denied read,
  accepted drain, retained uncertain cleanup and admission bound).
- MCP application units: 2 passed.
- Native pipeline and MCP transport contracts: 8 passed, including a real SDK
  handshake whose tool listing hangs: connection succeeds independently, explicit
  discovery times out, and both owned child processes are closed.
- UI hook regressions: 4 passed, covering separate calls, confirmed empty tools,
  unknown/failed catalog and failed connection.

No full suites, Docker, SSH or Chromium were started by this agent. Test fixtures
use owned temporary directories/local processes; no live vendor writes occur.
