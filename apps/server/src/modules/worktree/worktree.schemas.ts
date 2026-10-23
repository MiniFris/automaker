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

export type WorktreeProjectRequest = z.infer<typeof WorktreeProjectSchema>;
export type WorktreeFeatureRequest = z.infer<typeof WorktreeFeatureSchema>;
export type WorktreeFileRequest = z.infer<typeof WorktreeFileSchema>;
export type WorktreePathRequest = z.infer<typeof WorktreePathSchema>;
export type WorktreeBranchesRequest = z.infer<typeof WorktreeBranchesSchema>;
export type WorktreeCommitLogRequest = z.infer<typeof WorktreeCommitLogSchema>;
export type WorktreeBranchCommitLogRequest = z.infer<typeof WorktreeBranchCommitLogSchema>;
