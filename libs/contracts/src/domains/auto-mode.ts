import { z } from 'zod';
import { OutputLocaleSchema } from '../generation-language.js';

const project = z.string().min(1);
const feature = z.string().min(1);
export const AutoModeProjectSchema = z
  .object({ projectPath: project, outputLocale: OutputLocaleSchema.optional() })
  .passthrough();
export const AutoModeBranchSchema = AutoModeProjectSchema.extend({
  branchName: z.string().nullable().optional(),
});
export const AutoModeStartSchema = AutoModeBranchSchema.extend({
  maxConcurrency: z.number().int().positive().optional(),
});
export const AutoModeStatusSchema = z
  .object({ projectPath: project.optional(), branchName: z.string().nullable().optional() })
  .passthrough();
export const AutoModeFeatureSchema = AutoModeProjectSchema.extend({ featureId: feature });
export const AutoModeExecuteSchema = AutoModeFeatureSchema.extend({
  useWorktrees: z.boolean().optional(),
});
export const AutoModeFollowUpSchema = AutoModeExecuteSchema.extend({
  prompt: z.string().min(1),
  imagePaths: z.array(z.string()).optional(),
});
export const AutoModeCommitSchema = AutoModeFeatureSchema.extend({
  worktreePath: z.string().optional(),
});
export const AutoModeStopFeatureSchema = z.object({ featureId: feature }).passthrough();
export const AutoModeMergeSchema = z
  .object({
    projectPath: project,
    featureId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/),
    accepted: z.literal(true),
  })
  .strict();

export type AutoModeProjectRequest = z.infer<typeof AutoModeProjectSchema>;
export type AutoModeBranchRequest = z.infer<typeof AutoModeBranchSchema>;
export type AutoModeStartRequest = z.infer<typeof AutoModeStartSchema>;
export type AutoModeStatusRequest = z.infer<typeof AutoModeStatusSchema>;
export type AutoModeFeatureRequest = z.infer<typeof AutoModeFeatureSchema>;
export type AutoModeExecuteRequest = z.infer<typeof AutoModeExecuteSchema>;
export type AutoModeFollowUpRequest = z.infer<typeof AutoModeFollowUpSchema>;
export type AutoModeCommitRequest = z.infer<typeof AutoModeCommitSchema>;
export type AutoModeStopFeatureRequest = z.infer<typeof AutoModeStopFeatureSchema>;
export type AutoModeMergeRequest = z.infer<typeof AutoModeMergeSchema>;
