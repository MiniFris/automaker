import { z } from 'zod';
import { ProjectPathSchema } from '@automaker/contracts';

const RelativeFileSchema = z.string().trim().min(1).max(32_768);
const FeatureIdSchema = z.string().trim().min(1).max(512);
const LimitSchema = z.coerce.number().int().min(1).max(100).default(20);

export const WorktreeProjectSchema = z
  .object({
    projectPath: ProjectPathSchema,
    includeDetails: z.boolean().optional(),
    forceRefreshGitHub: z.boolean().optional(),
  })
  .strict();

export const WorktreeFeatureSchema = z
  .object({
    projectPath: ProjectPathSchema,
    featureId: FeatureIdSchema,
    useWorktrees: z.boolean().optional(),
  })
  .strict();

export const WorktreeFileSchema = WorktreeFeatureSchema.extend({
  filePath: RelativeFileSchema,
}).strict();

export const WorktreePathSchema = z.object({ worktreePath: ProjectPathSchema }).strict();

export const WorktreeBranchesSchema = WorktreePathSchema.extend({
  includeRemote: z.boolean().optional().default(false),
}).strict();

export const WorktreeCommitLogSchema = WorktreePathSchema.extend({
  limit: LimitSchema,
}).strict();

export const WorktreeBranchCommitLogSchema = WorktreeCommitLogSchema.extend({
  branchName: z.string().trim().min(1).max(1_024).optional(),
}).strict();

export const WorktreeStageFilesSchema = WorktreePathSchema.extend({
  files: z.array(RelativeFileSchema).min(1).max(1_000),
  operation: z.enum(['stage', 'unstage']),
  environmentTargetId: z.string().optional(),
}).strict();

export const WorktreeCommitSchema = WorktreePathSchema.extend({
  message: z.string().trim().min(1).max(10_000),
  files: z.array(RelativeFileSchema).min(1).max(1_000).optional(),
  environmentTargetId: z.string().optional(),
}).strict();

export const StartDevSchema = z
  .object({
    projectPath: ProjectPathSchema,
    worktreePath: ProjectPathSchema,
    environmentTargetId: z.string().optional(),
  })
  .strict();

export const DevSessionSchema = z
  .object({
    worktreePath: ProjectPathSchema.optional(),
    sessionId: z.string().trim().min(1).max(512).optional(),
  })
  .strict()
  .refine((value) => value.worktreePath || value.sessionId, 'worktreePath or sessionId required');

export const StartTestsSchema = z
  .object({
    worktreePath: ProjectPathSchema,
    projectPath: ProjectPathSchema.optional(),
    testFile: RelativeFileSchema.optional(),
    environmentTargetId: z.string().optional(),
  })
  .strict();

export const StopTestsSchema = z.object({ sessionId: z.string().trim().min(1).max(512) }).strict();

export const TestLogsSchema = z
  .object({
    worktreePath: ProjectPathSchema.optional(),
    sessionId: z.string().trim().min(1).max(512).optional(),
  })
  .strict()
  .refine((value) => value.worktreePath || value.sessionId, 'worktreePath or sessionId required');

export const WorktreeMutationSchema = z
  .object({
    worktreePath: ProjectPathSchema,
    environmentTargetId: z.string().optional(),
  })
  .strict();

export const WorktreeRemoteAddSchema = WorktreeMutationSchema.extend({
  remoteName: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,249}$/),
  remoteUrl: z
    .string()
    .trim()
    .min(1)
    .max(2_048)
    .refine(
      (value) =>
        /^(https?|git|ssh):\/\//.test(value) || /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+:.+/.test(value),
      'Remote URL must use HTTPS, SSH, or git protocol'
    ),
}).strict();

export const WorktreeTrackingSchema = WorktreeMutationSchema.extend({
  remote: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,249}$/),
  branch: z.string().trim().min(1).max(1_024).optional(),
}).strict();

export const WorktreeStashPushSchema = WorktreeMutationSchema.extend({
  message: z.string().trim().max(10_000).optional(),
  files: z.array(RelativeFileSchema).min(1).max(1_000).optional(),
}).strict();

export const WorktreeStashApplySchema = WorktreeMutationSchema.extend({
  stashIndex: z.coerce.number().int().min(0).max(100_000),
  pop: z.boolean().optional(),
}).strict();

export const WorktreeStashDropSchema = WorktreeMutationSchema.extend({
  stashIndex: z.coerce.number().int().min(0).max(100_000),
}).strict();

const BranchNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .regex(/^[a-zA-Z0-9._\-/]+$/);

export const WorktreeCheckoutBranchSchema = WorktreeMutationSchema.extend({
  branchName: BranchNameSchema,
  baseBranch: BranchNameSchema.or(z.literal('HEAD')).optional(),
  stashChanges: z.boolean().optional(),
  includeUntracked: z.boolean().optional(),
}).strict();

export const WorktreeSwitchBranchSchema = WorktreeMutationSchema.extend({
  branchName: BranchNameSchema,
}).strict();

export const WorktreeDiscardSchema = WorktreeMutationSchema.extend({
  files: z.array(RelativeFileSchema).min(1).max(1_000).optional(),
}).strict();

const RemoteNameSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,249}$/);

export const WorktreePullSchema = WorktreeMutationSchema.extend({
  remote: RemoteNameSchema.optional(),
  remoteBranch: BranchNameSchema.optional(),
  stashIfNeeded: z.boolean().optional(),
}).strict();

export const WorktreePushSchema = WorktreeMutationSchema.extend({
  remote: RemoteNameSchema.optional(),
  force: z.boolean().optional(),
  autoResolve: z.boolean().optional(),
}).strict();

export const WorktreeSyncSchema = WorktreeMutationSchema.extend({
  remote: RemoteNameSchema.optional(),
}).strict();

export const WorktreeRebaseSchema = WorktreeMutationSchema.extend({
  ontoBranch: BranchNameSchema,
  remote: RemoteNameSchema.optional(),
}).strict();

export const WorktreeCherryPickSchema = WorktreeMutationSchema.extend({
  commitHashes: z
    .array(z.string().regex(/^[a-fA-F0-9]{4,64}$/))
    .min(1)
    .max(100),
  options: z
    .object({
      noCommit: z.boolean().optional(),
    })
    .strict()
    .optional(),
}).strict();

export const WorktreeMergeSchema = z
  .object({
    projectPath: ProjectPathSchema,
    branchName: BranchNameSchema,
    worktreePath: ProjectPathSchema,
    targetBranch: BranchNameSchema.optional().default('main'),
    options: z
      .object({
        squash: z.boolean().optional(),
        message: z.string().trim().min(1).max(10_000).optional(),
        deleteWorktreeAndBranch: z.boolean().optional(),
        remote: RemoteNameSchema.optional(),
      })
      .strict()
      .optional(),
    environmentTargetId: z.string().optional(),
  })
  .strict();

export const WorktreeCreateSchema = z
  .object({
    projectPath: ProjectPathSchema,
    branchName: BranchNameSchema,
    baseBranch: BranchNameSchema.or(z.literal('HEAD')).optional(),
    environmentTargetId: z.string().optional(),
  })
  .strict();

export const WorktreeDeleteSchema = z
  .object({
    projectPath: ProjectPathSchema,
    worktreePath: ProjectPathSchema,
    deleteBranch: z.boolean().optional(),
    environmentTargetId: z.string().optional(),
  })
  .strict();

export const WorktreeInitGitSchema = z.object({ projectPath: ProjectPathSchema }).strict();

export const WorktreeInitScriptQuerySchema = z.object({ projectPath: ProjectPathSchema }).strict();

export const WorktreeInitScriptWriteSchema = z
  .object({
    projectPath: ProjectPathSchema,
    content: z
      .string()
      .refine((value) => Buffer.byteLength(value, 'utf8') <= 1024 * 1024, 'Script exceeds 1MB'),
    environmentTargetId: z.string().optional(),
  })
  .strict();

export const WorktreeInitScriptDeleteSchema = z
  .object({
    projectPath: ProjectPathSchema,
    environmentTargetId: z.string().optional(),
  })
  .strict();

export const WorktreeRunInitScriptSchema = z
  .object({
    projectPath: ProjectPathSchema,
    worktreePath: ProjectPathSchema,
    branch: BranchNameSchema,
    environmentTargetId: z.string().optional(),
  })
  .strict();

export const WorktreeOpenEditorSchema = WorktreePathSchema.extend({
  editorCommand: z.string().trim().min(1).max(2_048).optional(),
}).strict();

export const WorktreeOpenTerminalSchema = WorktreePathSchema.extend({
  terminalId: z.string().trim().min(1).max(512).optional(),
}).strict();

export type WorktreeProjectRequest = z.infer<typeof WorktreeProjectSchema>;
export type WorktreeFeatureRequest = z.infer<typeof WorktreeFeatureSchema>;
export type WorktreeFileRequest = z.infer<typeof WorktreeFileSchema>;
export type WorktreePathRequest = z.infer<typeof WorktreePathSchema>;
export type WorktreeBranchesRequest = z.infer<typeof WorktreeBranchesSchema>;
export type WorktreeCommitLogRequest = z.infer<typeof WorktreeCommitLogSchema>;
export type WorktreeBranchCommitLogRequest = z.infer<typeof WorktreeBranchCommitLogSchema>;
export type WorktreeStageFilesRequest = z.infer<typeof WorktreeStageFilesSchema>;
export type WorktreeCommitRequest = z.infer<typeof WorktreeCommitSchema>;
export type StartDevRequest = z.infer<typeof StartDevSchema>;
export type DevSessionRequest = z.infer<typeof DevSessionSchema>;
export type StartTestsRequest = z.infer<typeof StartTestsSchema>;
export type StopTestsRequest = z.infer<typeof StopTestsSchema>;
export type TestLogsRequest = z.infer<typeof TestLogsSchema>;
export type WorktreeRemoteAddRequest = z.infer<typeof WorktreeRemoteAddSchema>;
export type WorktreeMutationRequest = z.infer<typeof WorktreeMutationSchema>;
export type WorktreeTrackingRequest = z.infer<typeof WorktreeTrackingSchema>;
export type WorktreeStashPushRequest = z.infer<typeof WorktreeStashPushSchema>;
export type WorktreeStashApplyRequest = z.infer<typeof WorktreeStashApplySchema>;
export type WorktreeStashDropRequest = z.infer<typeof WorktreeStashDropSchema>;
export type WorktreeCheckoutBranchRequest = z.infer<typeof WorktreeCheckoutBranchSchema>;
export type WorktreeSwitchBranchRequest = z.infer<typeof WorktreeSwitchBranchSchema>;
export type WorktreeDiscardRequest = z.infer<typeof WorktreeDiscardSchema>;
export type WorktreePullRequest = z.infer<typeof WorktreePullSchema>;
export type WorktreePushRequest = z.infer<typeof WorktreePushSchema>;
export type WorktreeSyncRequest = z.infer<typeof WorktreeSyncSchema>;
export type WorktreeRebaseRequest = z.infer<typeof WorktreeRebaseSchema>;
export type WorktreeCherryPickRequest = z.infer<typeof WorktreeCherryPickSchema>;
export type WorktreeMergeRequest = z.infer<typeof WorktreeMergeSchema>;
export type WorktreeCreateRequest = z.infer<typeof WorktreeCreateSchema>;
export type WorktreeDeleteRequest = z.infer<typeof WorktreeDeleteSchema>;
export type WorktreeInitGitRequest = z.infer<typeof WorktreeInitGitSchema>;
export type WorktreeInitScriptQuery = z.infer<typeof WorktreeInitScriptQuerySchema>;
export type WorktreeInitScriptWriteRequest = z.infer<typeof WorktreeInitScriptWriteSchema>;
export type WorktreeInitScriptDeleteRequest = z.infer<typeof WorktreeInitScriptDeleteSchema>;
export type WorktreeRunInitScriptRequest = z.infer<typeof WorktreeRunInitScriptSchema>;
export type WorktreeOpenEditorRequest = z.infer<typeof WorktreeOpenEditorSchema>;
export type WorktreeOpenTerminalRequest = z.infer<typeof WorktreeOpenTerminalSchema>;
