import { z } from 'zod';
import { GitExecutionEnvironmentSchema } from './git-responses.js';

const text = z.string(),
  flag = z.boolean(),
  count = z.number().int().nonnegative(),
  texts = z.array(text);
const record = z.record(z.string(), z.unknown());
const object = <T extends z.ZodRawShape>(fields: T) => z.object(fields).passthrough();
const ok = <T extends z.ZodRawShape>(fields: T) => object({ success: z.literal(true), ...fields });
/** Derived target projection. Historical pinned type/branch metadata is intentionally not certified. */
export const WorktreeEnvironmentRecordSchema = object({
  projectPath: text,
  path: text,
  runtimeCwd: text,
  root: text,
  pinned: flag,
  targetId: text,
});
const environment = GitExecutionEnvironmentSchema;
const git = <T extends z.ZodRawShape>(fields: T) =>
  ok({ executionEnvironment: environment, ...fields });
const result = <T extends z.ZodRawShape>(fields: T) => git({ result: object(fields) });
const message = text;
export const WorktreeEnvironmentResponseSchema = ok({ executionEnvironment: environment });
export const WorktreeListResponseSchema = git({
  worktrees: z.array(
    object({
      path: text,
      runtimePath: text,
      isMain: flag,
      isCurrent: flag,
      hasWorktree: flag,
      executionEnvironment: WorktreeEnvironmentRecordSchema,
    })
  ),
});
export const WorktreeInfoResponseSchema = git({ worktreePath: text, branchName: text });
export const WorktreeStatusResponseSchema = git({
  modifiedFiles: count,
  files: texts,
  diffStat: text,
  recentCommits: texts,
});
const mergeState = object({
  isMerging: flag,
  mergeOperationType: text,
  isCleanMerge: flag,
  mergeAffectedFiles: texts,
  conflictFiles: texts,
});
export const WorktreeDiffsResponseSchema = git({
  files: z.array(
    object({
      path: text,
      status: text,
      statusText: text,
      indexStatus: text,
      workTreeStatus: text,
      isMergeAffected: flag,
    })
  ),
  hasChanges: flag,
  diff: text,
  mergeState: mergeState.optional(),
});
// useWorktrees=false is an existing short reply, without an execution descriptor.
export const WorktreeFileDiffResponseSchema = ok({
  filePath: text,
  diff: text,
  executionEnvironment: environment.optional(),
});
export const WorktreeCheckChangesResponseSchema = result({
  hasChanges: flag,
  staged: texts,
  unstaged: texts,
  untracked: texts,
  totalFiles: count,
});
export const WorktreeListBranchesResponseSchema = result({
  currentBranch: text,
  branches: z.array(object({ name: text, isCurrent: flag, isRemote: flag })),
  aheadCount: count,
  behindCount: count,
  hasRemoteBranch: flag,
  hasAnyRemotes: flag,
  trackingRemote: text.optional(),
  remotesWithBranch: texts,
}).extend({ remoteRefsCached: flag });
export const WorktreeListRemotesResponseSchema = result({
  remotes: z.array(
    object({ name: text, url: text, branches: z.array(object({ fullRef: text, name: text })) })
  ),
}).extend({ remoteRefsCached: flag });
export const WorktreeStageFilesResponseSchema = result({
  operation: z.enum(['stage', 'unstage']),
  filesCount: count,
});
export const WorktreeCommitResponseSchema = result({
  committed: flag,
  message,
  commitHash: text.optional(),
  branch: text.optional(),
});
export const WorktreeAbortOperationResponseSchema = result({ operation: text, message });
export const WorktreeContinueOperationResponseSchema = WorktreeAbortOperationResponseSchema;
export const WorktreeAddRemoteResponseSchema = result({
  remoteName: text,
  remoteUrl: text,
  fetched: flag,
  message,
});
export const WorktreeSetTrackingResponseSchema = result({
  branch: text,
  remote: text,
  upstream: text,
  message,
});
export const WorktreeStashListResponseSchema = result({
  stashes: z.array(object({ index: count, message, branch: text, date: text, files: texts })),
  total: count,
});
export const WorktreeStashPushResponseSchema = result({
  stashed: flag,
  message,
  branch: text.optional(),
});
export const WorktreeStashApplyResponseSchema = result({
  applied: flag,
  hasConflicts: flag,
  conflictFiles: texts,
  operation: text,
  stashIndex: count,
  message,
});
export const WorktreeStashDropResponseSchema = result({
  dropped: flag,
  stashIndex: count,
  message,
});
export const WorktreeCheckoutBranchResponseSchema = result({
  previousBranch: text,
  newBranch: text,
  message,
  hasConflicts: flag,
  stashedChanges: flag,
  conflictFiles: texts,
});
export const WorktreeSwitchBranchResponseSchema = result({
  previousBranch: text,
  currentBranch: text,
  message,
  hasConflicts: flag.optional(),
  stashedChanges: flag.optional(),
  conflictFiles: texts.optional(),
});
export const WorktreeDiscardChangesResponseSchema = result({
  discarded: flag,
  message,
  filesDiscarded: count.optional(),
  filesRemaining: count.optional(),
  branch: text.optional(),
});
export const WorktreePullResponseSchema = result({
  branch: text,
  pulled: flag,
  hasLocalChanges: flag,
  localChangedFiles: texts,
  hasConflicts: flag,
  stashed: flag,
  stashRestored: flag,
  message,
  conflictSource: text.optional(),
  conflictFiles: texts.optional(),
  isFastForward: flag.optional(),
  isMerge: flag.optional(),
});
export const WorktreePushResponseSchema = result({
  branch: text,
  pushed: flag,
  diverged: flag,
  autoResolved: flag,
  message,
  hasConflicts: flag.optional(),
  conflictFiles: texts.optional(),
});
export const WorktreeSyncResponseSchema = result({
  branch: text,
  pulled: flag,
  pushed: flag,
  message,
  hasConflicts: flag.optional(),
  conflictFiles: texts.optional(),
  conflictSource: text.optional(),
  isFastForward: flag.optional(),
  isMerge: flag.optional(),
  autoResolved: flag.optional(),
});
export const WorktreeRebaseResponseSchema = result({
  branch: text,
  ontoBranch: text,
  message,
  hasConflicts: flag.optional(),
  conflictFiles: texts.optional(),
  aborted: flag.optional(),
});
export const WorktreeCherryPickResponseSchema = result({
  cherryPicked: flag,
  commitHashes: texts,
  branch: text,
  hasConflicts: flag,
  message,
  conflictFiles: texts.optional(),
  aborted: flag.optional(),
});
const deletion = object({ worktreeDeleted: flag, branchDeleted: flag });
const merged = {
  mergedBranch: text,
  targetBranch: text,
  hasConflicts: flag,
  message,
  conflictFiles: texts.optional(),
  deleted: deletion.optional(),
};
// Application service preserves the existing nested result and mirrors its owned fields at top level.
export const WorktreeMergeResponseSchema = git({ result: object(merged), ...merged });
export const WorktreeCreateResponseSchema = git({
  worktree: object({ path: text, branch: text, isNew: flag, baseCommitHash: text }),
  copyResults: z
    .array(
      object({
        path: text,
        status: z.enum(['copied', 'skipped', 'failed']),
        type: text.optional(),
        reason: text.optional(),
        error: text.optional(),
      })
    )
    .optional(),
});
export const WorktreeDeleteResponseSchema = git({
  deleted: object({
    worktreePath: text,
    branch: text.nullable(),
    branchName: text,
    branchDeleted: flag,
    worktreeDeleted: flag,
    featuresMovedToMain: count,
  }),
});
export const WorktreeInitGitResponseSchema = result({ initialized: flag, message });
export const WorktreeGetInitScriptResponseSchema = git({ exists: flag, content: text, path: text });
export const WorktreePutInitScriptResponseSchema = git({ path: text });
export const WorktreeDeleteInitScriptResponseSchema = git({});
export const WorktreeRunInitScriptResponseSchema = ok({ message });
export const WorktreeMigrateResponseSchema = ok({ migrated: flag, message, path: text });
// gh CLI payloads are parsed as JSON but not projected/validated deeply by this producer.
export const WorktreePrInfoResponseSchema = result({
  hasPR: flag,
  ghCliAvailable: flag,
  error: text.optional(),
  prInfo: record.optional(),
});
export const WorktreeUpdatePrNumberResponseSchema = result({
  branch: text,
  prInfo: record,
  ghCliUnavailable: flag.optional(),
});
export const WorktreeCreatePrResponseSchema = result({
  branch: text,
  committed: flag,
  commitHash: text.nullable(),
  pushed: flag,
  prCreated: flag,
  prAlreadyExisted: flag,
  ghCliAvailable: flag,
  prError: text.optional(),
  browserUrl: text.optional(),
});
const commitRecord = object({
  hash: text,
  shortHash: text.optional(),
  author: text.optional(),
  authorEmail: text.optional(),
  date: text.optional(),
  subject: text.optional(),
  body: text.optional(),
  files: texts,
});
export const WorktreeCommitLogResponseSchema = result({
  branch: text,
  commits: z.array(commitRecord),
  total: count,
});
export const WorktreeBranchCommitLogResponseSchema = WorktreeCommitLogResponseSchema;

const editor = object({ name: text, command: text }),
  terminal = editor.extend({ id: text });
export const WorktreeAvailableEditorsResponseSchema = ok({
  result: object({ editors: z.array(editor) }),
});
export const WorktreeDefaultEditorResponseSchema = ok({
  result: object({ editorName: text, editorCommand: text }),
});
export const WorktreeRefreshEditorsResponseSchema = ok({
  result: object({ editors: z.array(editor), message }),
});
export const WorktreeOpenEditorResponseSchema = ok({
  result: object({ message, editorName: text }),
});
export const WorktreeAvailableTerminalsResponseSchema = ok({
  result: object({ terminals: z.array(terminal) }),
});
export const WorktreeDefaultTerminalResponseSchema = ok({
  result: object({ terminalId: text, terminalName: text, terminalCommand: text }).nullable(),
});
export const WorktreeRefreshTerminalsResponseSchema = ok({
  result: object({ terminals: z.array(terminal), message }),
});
export const WorktreeOpenTerminalResponseSchema = ok({
  result: object({ message, terminalName: text }),
});
export const WorktreeOpenExternalTerminalResponseSchema = WorktreeOpenTerminalResponseSchema;
export const WorktreeGenerateCommitMessageResponseSchema = ok({ message });
export const WorktreeGeneratePrDescriptionResponseSchema = ok({ title: text, body: text });

const dev = object({ worktreePath: text, port: z.number(), url: text });
const devMetadata = {
  sessionId: text.optional(),
  targetPort: z.number().optional(),
  preserveUrlHost: flag.optional(),
  executionEnvironment: environment.optional(),
  command: text.optional(),
  isRunning: flag.optional(),
  error: text.optional(),
  exitCode: z.number().nullable().optional(),
};
export const WorktreeStartDevResponseSchema = ok({
  result: dev.extend({
    ...devMetadata,
    message,
    logs: text.optional(),
    startedAt: text.optional(),
    urlDetected: flag.optional(),
  }),
});
export const WorktreeStopDevResponseSchema = ok({
  result: object({ worktreePath: text, message, sessionId: text.optional() }),
});
export const WorktreeListDevResponseSchema = ok({
  result: object({
    servers: z.array(
      dev.extend({ ...devMetadata, urlDetected: flag, startedAt: text, logs: text.optional() })
    ),
  }),
});
export const WorktreeDevLogsResponseSchema = ok({
  result: dev.extend({ ...devMetadata, logs: text, startedAt: text, urlDetected: flag.optional() }),
});
const test = object({
  sessionId: text,
  worktreePath: text,
  command: text,
  status: z.enum(['pending', 'running', 'passed', 'failed', 'cancelled', 'error']),
  testFile: text.optional(),
});
const testMetadata = {
  startedAt: text.optional(),
  finishedAt: text.nullable().optional(),
  exitCode: z.number().nullable().optional(),
  executionEnvironment: environment.optional(),
  error: text.optional(),
  logs: text.optional(),
};
export const WorktreeStartTestsResponseSchema = ok({
  result: test.extend({ ...testMetadata, message }),
});
export const WorktreeStopTestsResponseSchema = ok({ result: object({ sessionId: text, message }) });
export const WorktreeTestLogsResponseSchema = ok({
  result: test.extend({
    ...testMetadata,
    logs: text,
    startedAt: text,
    finishedAt: text.nullable(),
    exitCode: z.number().nullable(),
  }),
});
