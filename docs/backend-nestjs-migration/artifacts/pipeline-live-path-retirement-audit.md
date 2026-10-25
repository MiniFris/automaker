# Pipeline live-path and unused owner retirement

Date: 2026-10-25. This slice removes an unreachable generic test-step implementation
and its unused process owner while preserving the actual custom-step workflow.

Production entry paths are AutoMode facade callbacks to `executePipeline`,
`detectPipelineStatus` and `resumePipeline`; the latter calls `resumeFromStep`.
Prompt construction and `attemptMerge` remain live internal dependencies.
`executeTestStep` had no production caller. Its observer wrapper, polling loop,
agent-fix retry loop and test-output parsers formed a separate unreachable island.
The PipelineStep contract contains instruction text and ordering, with no runtime
step-kind dispatcher. Persisted extension keys remain accepted and preserved.

The removed island included `executeTestStep`, `executeObservedTestStep`,
`waitForTestCompletion`, `parseTestLines`, `buildTestFailureSummary` and
`extractFailedTestNames`. The orchestrator's AgentExecutor constructor field was
never read; its TestRunnerService, workspace-policy and observer arguments only
served that island. Removing them also removes the otherwise unused unscoped
`new TestRunnerService()` in native facade composition. Actual agent execution
continues through the existing runAgent callback and its application-owned ports.
The facade's unused stored orchestrator field was removed; live callbacks retain
their local orchestrator instance. Internal attempt-count fields and StepResult
were retired with the unreachable branch.

No HTTP operation, schema, pipeline configuration field or public event type was
removed. The six pipeline configuration operations and total 318-operation route
inventory remain unchanged. `pipeline_test_failed` and the persisted/UI
`pipelineTestTimeoutMs` setting remain compatibility surfaces; this cleanup does
not claim that the removed generic retry loop ever serviced a public request.
Existing custom-step error/recovery behavior is retained, without inventing an
automatic per-step retry mode.

`runDirectShellCommand` remains a standalone compatibility helper. Its only former
production caller was the removed test-step branch; it is no longer presented as
a native custom-step path. Its actual Local/sandbox/SSH security and environment
tests remain. DirectWorkspaceAccess still owns native provider file-tool policy;
only its unused AutoMode-to-pipeline argument chain was retired.

## Actual native workflow proof

A new `native-custom-pipeline.contract.test.ts` first passed four cases on the
pre-removal implementation, then passed after retirement. A fifth real merge
conflict case was added afterward. All use actual native HTTP handlers, scoped
storage, explicit offline providers and real WebSocket event frames.

- An out-of-order configuration executes two selected steps in order while
  excluding a third. Saved extension data, including a legacy `kind: test` key,
  round-trips without dispatching a hidden command. Endpoint identity, thinking/
  reasoning controls, project context, previous output and per-phase summaries
  survive the actual provider chain. Both step-start and step-complete WS payloads
  retain ordered step IDs.
- HTTP resume starts at a saved custom step and uses its previous output. Removed
  and fully excluded stages finish without launching another model query.
- An old custom-step provider is deliberately held past stop. A resumed incarnation
  reaches a later step; releasing the old provider cannot replace its lease,
  overwrite its persisted status or publish a duplicate completion.
- Actual Local Git worktrees exercise both a clean merge and a conflicting merge
  after HTTP execution. The successful branch reaches main; a conflict preserves
  `merge_conflict` and the previous main HEAD. Worktrees remain present.

These fixtures use temporary repositories with isolated global/system Git config,
explicit local identity and no configured external origin. Provider output is
supplied by in-process offline adapters; no paid or external model request runs.

## Test migration and results

The four orchestrator unit files retain prompt, status detection, custom-step
routing, resume, lease, merge and abort checks. Only the five unreachable generic
retry tests, three generic output-parser tests, four provider/status fix-loop
tests and two attempt-field assertions were retired. Model selection and custom
step controls are additionally tested through the new native HTTP path.

Direct integration cases now call the retained standalone shell helper directly
for its compatibility security contract. Real SSH/Docker fixtures retain actual
feature execution, context isolation, commit/merge, hooks and four-command facade
verification assertions. A remote CLI fixture checks its existing target command
through its actual pinned SSH runtime instead of instantiating a fake generic
pipeline. A checkpoint caller fixture now observes the real AgentExecutor receiver
through a passthrough spy during actual facade execution, preserving native
checkpoint/continuation wiring proof without retaining a dead private field.
The execution-filesystem and pipeline-repository contracts use the same live-path
approach: actual native feature/custom-step execution captures their real owners,
retaining scoped FS identity, raw-output, stale memory-write and recovery failure
checks. The repository proof still performs 12 concurrent HTTP step mutations
before actual execution confirms the same repository instance in the orchestrator.

Targeted results:

- Pipeline/Direct unit selection: 76 passed, one existing opt-in skipped.
- Facade/ExecutionService/Recovery unit selection: 139 passed.
- Migrated execution-filesystem/pipeline-repository contracts: 11 passed.
- Native custom pipeline: five passed, including real clean/conflicting Git merge.
- Custom-pipeline/checkpoint/correlation/Local-pin native selection: ten passed
  before the additional conflict case; the five-case pipeline suite also passed
  afterward.
- Real SSH feature and remote CLI suites: 25 passed, including native target
  isolation, pipeline resume, cancellation and no-replay tests.
- Changed managed Docker CLI feature case: one passed, 14 filtered by selection;
  four actual target verification commands and private resource cleanup retained.
  Uses the already-local owned wave17 production image as its fixture base, without
  pulls or terminal/package-install opt-ins.
- Seven production paths passed targeted ESLint. Server tsc --noEmit and route
  inventory check passed; the latter still reports the existing inventory current.

Local logs: `/tmp/automaker-wave22-pipeline-unit.log`,
`/tmp/automaker-wave22-facade-unit.log`,
`/tmp/automaker-wave22-live-owner-proof.log`,
`/tmp/automaker-wave22-native-pipeline-before.log`,
`/tmp/automaker-wave22-native-pipeline-after.log`,
`/tmp/automaker-wave22-native-pipeline-final.log`,
`/tmp/automaker-wave22-pipeline-ssh.log`,
`/tmp/automaker-wave22-pipeline-docker.log`,
`/tmp/automaker-wave22-pipeline-lint.log`,
`/tmp/automaker-wave22-pipeline-tsc-final.log` and
`/tmp/automaker-wave22-pipeline-routes.log`.

## Remaining limits

This removes unreachable responsibilities; it does not redesign custom-step
semantics or declare stage 8/11 complete. The real orchestrator still coordinates
configuration, phase output and recovery. A complete unknown-outcome pipeline
recovery/drain matrix remains a separate acceptance item; successful stop and
supersession cases do not establish every uncertain transport outcome. The broad
AutoMode compatibility facade remains for its live callers. Its obsolete analysis
throw/forwarder was removed only after the native project-analysis route was
cut over by the separate wave22 workstream.
