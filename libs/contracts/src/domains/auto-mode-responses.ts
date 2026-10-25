import { z } from 'zod';
export { PendingPlanApprovalResponseSchema } from '../plan-approval.js';

const success = z.literal(true);
const branch = z.string().nullable();
const count = z.number().int().nonnegative();
export const AutoModeAcceptedResponseSchema = z.object({ success }).passthrough();
export const AutoModeMessageResponseSchema = z
  .object({ success, message: z.string() })
  .passthrough();
export const AutoModeStartResponseSchema = z
  .object({
    success,
    message: z.string(),
    branchName: branch,
    alreadyRunning: z.boolean().optional(),
  })
  .passthrough();
export const AutoModeStopResponseSchema = z.union([
  z
    .object({ success, message: z.string(), branchName: branch, wasRunning: z.literal(false) })
    .passthrough(),
  z
    .object({ success, message: z.string(), branchName: branch, runningFeaturesCount: count })
    .passthrough(),
]);
export const AutoModeStopFeatureResponseSchema = z
  .object({ success, stopped: z.boolean() })
  .passthrough();
export const AutoModeVerificationResponseSchema = z
  .object({ success, passes: z.boolean() })
  .passthrough();
export const AutoModeContextResponseSchema = z
  .object({ success, exists: z.boolean() })
  .passthrough();
export const AutoModeCommitResponseSchema = z
  .object({ success, commitHash: z.string().nullable() })
  .passthrough();
export const AutoModeReconcileResponseSchema = z
  .object({ success, reconciledCount: count, message: z.string() })
  .passthrough();
export const AutoModeApprovalResponseSchema = z
  .object({ success, approved: z.boolean(), message: z.string() })
  .passthrough();
const status = {
  success,
  isRunning: z.boolean(),
  runningFeatures: z.array(z.string()),
  runningCount: count,
};
export const AutoModeGlobalStatusResponseSchema = z
  .object({
    ...status,
    activeAutoLoopProjects: z.array(z.string()),
    activeAutoLoopWorktrees: z.array(
      z.object({ projectPath: z.string(), branchName: branch }).passthrough()
    ),
  })
  .passthrough();
export const AutoModeProjectStatusResponseSchema = z
  .object({
    ...status,
    isAutoLoopRunning: z.boolean(),
    // Existing settings accept arbitrary numeric concurrency, including legacy fractions/zero.
    maxConcurrency: z.number(),
    projectPath: z.string(),
    branchName: branch,
  })
  .passthrough();
export const AutoModeStatusResponseSchema = z.union([
  AutoModeGlobalStatusResponseSchema,
  AutoModeProjectStatusResponseSchema,
]);

export type AutoModeStartResponse = z.infer<typeof AutoModeStartResponseSchema>;
export type AutoModeStopResponse = z.infer<typeof AutoModeStopResponseSchema>;
export type AutoModeStatusResponse = z.infer<typeof AutoModeStatusResponseSchema>;
export type AutoModeCommitResponse = z.infer<typeof AutoModeCommitResponseSchema>;
export type AutoModeApprovalResponse = z.infer<typeof AutoModeApprovalResponseSchema>;
