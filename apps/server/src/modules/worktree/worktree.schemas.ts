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
