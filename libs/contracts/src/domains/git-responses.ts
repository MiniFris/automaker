import { z } from 'zod';

export const GitExecutionEnvironmentSchema = z
  .object({
    type: z.enum(['local', 'docker', 'ssh']),
    projectPath: z.string(),
    path: z.string(),
    runtimeCwd: z.string(),
    root: z.string(),
    targetId: z.string(),
    pinned: z.boolean(),
  })
  .passthrough();
const envelope = { success: z.literal(true), executionEnvironment: GitExecutionEnvironmentSchema };
const count = z.number().int().nonnegative();
const fileStatus = {
  path: z.string(),
  status: z.string(),
  indexStatus: z.string(),
  workTreeStatus: z.string(),
};
export const GitEnvironmentResponseSchema = z.object(envelope).passthrough();
export const GitDiffsResponseSchema = z
  .object({
    ...envelope,
    files: z.array(
      z
        .object({ ...fileStatus, statusText: z.string(), isMergeAffected: z.boolean() })
        .passthrough()
    ),
    hasChanges: z.boolean(),
    diff: z.string(),
    mergeState: z
      .object({
        isMerging: z.literal(true),
        mergeOperationType: z.enum(['rebase', 'merge', 'cherry-pick']),
        isCleanMerge: z.boolean(),
        mergeAffectedFiles: z.array(z.string()),
        conflictFiles: z.array(z.string()),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export const GitFileDiffResponseSchema = z
  .object({ ...envelope, filePath: z.string(), diff: z.string() })
  .passthrough();
export const GitStageFilesResponseSchema = z
  .object({
    ...envelope,
    result: z.object({ operation: z.enum(['stage', 'unstage']), filesCount: count }).passthrough(),
  })
  .passthrough();
const branchDetails = z.object({ branch: z.string() }).passthrough();
const fileDetails = branchDetails.extend({
  lastCommitHash: z.string(),
  lastCommitMessage: z.string(),
  lastCommitAuthor: z.string(),
  lastCommitTimestamp: z.string(),
  linesAdded: count,
  linesRemoved: count,
  isConflicted: z.boolean(),
  isStaged: z.boolean(),
  isUnstaged: z.boolean(),
  statusLabel: z.string(),
});
// Branch-only details deliberately carry no file metadata. If metadata is present,
// validate the complete owned file detail record rather than hiding it in passthrough.
export const GitDetailsResponseSchema = z
  .object({ ...envelope, details: z.union([fileDetails, branchDetails.strict()]) })
  .passthrough();
export const GitEnhancedStatusResponseSchema = z
  .object({
    ...envelope,
    branch: z.string(),
    files: z.array(
      z
        .object({
          ...fileStatus,
          isConflicted: z.boolean(),
          isStaged: z.boolean(),
          isUnstaged: z.boolean(),
          linesAdded: count,
          linesRemoved: count,
          statusLabel: z.string(),
        })
        .passthrough()
    ),
  })
  .passthrough();
