# Execution and recovery filesystem ownership

## Implemented boundary

Native `autoModeProvider` supplies `SECURE_FILESYSTEM` to the project facade and its `AgentExecutor`, `ExecutionService`, `PipelineOrchestrator`, and `RecoveryService`. Construction requires an explicit filesystem; these production classes no longer import the process filesystem singleton. Standalone characterization fixtures supply their existing filesystem/mock explicitly.

Agent output and optional raw JSONL artifacts use the injected port. Execution and pipeline context loading use the same application port. Context/memory helper writes additionally pass through the captured run's `mutate` lane, retaining cancellation, stale-incarnation rejection, and mutation drain. Existing guarded agent output callbacks remain guarded.

Recovery state saves/loads/deletes, feature enumeration, context access, and JSON backup recovery use the application filesystem. `readJsonWithRecovery` receives both `filesystem` and `strictErrors`. Only actual `ENOENT` means missing. Other state/context I/O failures propagate; automatic recovery does not clear unknown state or start a fresh run after a failed context read. Query-only malformed JSON retains its existing default-state behavior. Automatic recovery instead requires the existing complete version 1 shape, including matching project, boolean loop flag and string-array feature IDs; malformed JSON, null, unknown versions and incompatible shapes stop before scanning/replay/cleanup. No new persistence format was introduced.

## Evidence

- Targeted unit selection: **303 passed, 1 existing skipped**, 12 files, covering executor/summary/run ownership, execution, pipeline variations, recovery and facade/provider integration.
- Native `execution-filesystem.contract.test.ts`: **10 passed**. Two application roots retain independent ports through native composition and shutdown. Actual output/raw files are created within the owner; denied artifact targets create neither file. Captured memory writes reject a replaced run. Manual and automatic recovery on EIO/EACCES/403 preserve state bytes and make no execution call. Invalid JSON/state shapes preserve bytes without replay.
- Existing `plan-recovery.contract.test.ts`: **1 passed** alongside the earlier native run; persisted approval behavior remains unchanged.
- Server TypeScript check and `git diff --check`: passed.

## Scope boundaries

This changes local execution/recovery filesystem ownership. Existing SSH/Docker execution paths, provider policy/authentication, best-effort output logging and non-recovery context enrichment semantics remain as before. Remote/integration fixture constructors were updated mechanically; no SSH/Docker acceptance or full suite was run in this slice. Native contracts use offline mock providers and temporary directories; they do not claim live vendor acceptance.
