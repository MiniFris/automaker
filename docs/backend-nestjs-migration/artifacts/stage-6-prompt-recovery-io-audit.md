# Prompt and recovery actual IO ownership

## Completed

- Native `AgentPromptBuilder` receives required `SECURE_FILESYSTEM` from `AgentStateModule`. Context initialization/loading and both image paths use that application port. Shared image/prompt utilities accept an optional narrow reader, preserving defaults for existing callers. Explicit application image EIO/access-denied failures propagate before a provider query; they cannot become silently missing attachments. Genuine ENOENT preserves the original best-effort missing-image behavior in both metadata loading and content conversion. Managed targets still skip controller context.
- Recovery execution-state reads, saves and clears share a per-resolved-file lane, bounded to 256 accepted operations per facade. Saves use injected `atomicWriteJson` with non-recoverable `.write.*` temporary files and rename, without backup rotation. Failed writes preserve the committed state, clean their temporary artifact and release the lane. Both save methods filter the running feature snapshot by project.
- `RecoveryService.close()` stops new state admission and drains accepted IO with a five-second deadline. The native project-context registry awaits this drain after accepted commands, within its existing shutdown deadline and before later filesystem shutdown.
- Automatic feature recovery uses `loadFeatureFn(..., true)` rather than a separate recovery helper. Native composition routes it to `FeatureLoader.get(..., { strict: true })`, placing reads and automatic backup restoration in the existing feature mutation lane. Existing callers retain their normal read behavior. Execution-state version/shape checks and strict corruption/IO failure behavior remain intact.

## Targeted evidence

- Server units: **74 passed**, five files (prompt builder, environment preparer, recovery, project context and application commands). Includes capacity rejection, drain admission and finite unconfirmed-drain deadline.
- Shared image/prompt utilities: **42 passed**, two files; utils build passed.
- Native contracts: **16 passed**, existing execution filesystem ten plus six prompt/recovery cases. Actual files demonstrate context/image isolation, provider not invoked on image EIO, atomic concurrent saves/clear, project-filtered snapshots, preservation/cleanup on rename failure followed by a successful transaction, native shutdown waiting for an accepted rename, and strict loader recovery queued behind a feature mutation. The feature case also rejects unrecoverable corruption and restores an owned backup through the loader.
- `git diff --check`: passed. Initial server type checks reported only other in-progress shared contract outputs; combined type/build checkpoint belongs to root.

No paid/provider calls, full suite, Docker, GUI or network acceptance was run. Legacy default utility callers and unrelated persistence services are outside this slice.
