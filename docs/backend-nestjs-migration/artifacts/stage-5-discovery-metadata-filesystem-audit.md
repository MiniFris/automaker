# Native agent discovery and orphan metadata cleanup

## Agent discovery

`SettingsQueryService` supplies an explicit runtime to `discoverFilesystemAgents`: project reads use `SECURE_FILESYSTEM`; user reads use the new read-only `AgentProfileSource`. No generic profile reader was available in the existing auth/CLI status or legacy Automaker import ports.

`NodeAgentProfileSource` receives `HOST_PROFILE_CONFIG`, restricts reads to the configured home's `.claude/agents` directory and its canonical descendants, and rejects symlink escapes. It never resolves ambient HOME, process environment or `os.homedir`. A missing home snapshot disables user discovery without disabling project discovery. Reads are capped at 256 active operations, stop admission on module destruction and drain with a five-second deadline. The host reader exposes no writes and is separate from project allowed roots.

Native discovery preserves user-first ordering, flat `.md` and nested `AGENT.md` formats, definition fields and skipping invalid agent frontmatter. Genuine ENOENT remains optional. EIO/access-denied errors propagate instead of becoming a misleading successful empty list. The legacy standalone discovery entry point retains its historical default adapters; native composition always supplies explicit ports.

## Worktree metadata

`FeatureCommandService` passes its injected `SECURE_FILESYSTEM` to `deleteWorktreeMetadata`. The helper ignores only genuine ENOENT. Orphan delete/move actions report metadata cleanup failure before deleting/updating feature data; failed cleanup preserves both metadata and feature bytes. Existing branch sanitization, metadata directory layout and file formats are unchanged.

The existing `ProjectFeatureSerializer` uses native `SecurityService.validateLocalPath` for its lane key, so alias and canonical requests share one command lane. Direct standalone constructors retain their existing explicit project identity behavior. This slice does not migrate unrelated legacy metadata read/write consumers or introduce a cross-file transaction journal.

## Validation

- **37 focused unit tests passed**: feature commands, historical worktree metadata helpers, planning lifecycle and backlog-plan application.
- **7 native contracts passed**: two independent application profiles/project roots, environment mutation after composition, no-home snapshot, optional missing paths, profile EIO/project EACCES, canonical profile escape rejection, both orphan cleanup failures with byte preservation, alias command serialization and isolated metadata deletion.
- Owned production-source ESLint and `git diff --check` passed. Final server typecheck reported only another active slice's `dev-server-service.ts:244` string/Buffer mismatch; no errors in these files. Root owns the combined type/build checkpoint.

No full suites, network/vendor calls, Docker, GUI, commits or sub-agents were used.
