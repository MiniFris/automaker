import { z } from 'zod';

export const PlanningAcceptedResponseSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true) }).passthrough(),
  z.object({ success: z.literal(false), error: z.string() }).passthrough(),
]);
export const PlanningSuccessResponseSchema = z.object({ success: z.literal(true) }).passthrough();
export const AppSpecStatusResponseSchema = z
  .object({
    success: z.literal(true),
    isRunning: z.boolean(),
    projectPath: z.string().optional(),
    type: z.enum(['spec_regeneration', 'feature_generation', 'sync']).optional(),
    startedAt: z.string().optional(),
  })
  .passthrough();

/** Saved plans retain their existing minimal storage guard and arbitrary legacy metadata. */
export const PublicSavedBacklogPlanSchema = z
  .object({
    result: z.object({ changes: z.array(z.unknown()) }).passthrough(),
  })
  .passthrough();
export const BacklogStatusResponseSchema = z
  .object({
    success: z.literal(true),
    isRunning: z.boolean(),
    savedPlan: PublicSavedBacklogPlanSchema.nullable(),
  })
  .passthrough();
export const BacklogApplyResponseSchema = z
  .object({ success: z.literal(true), appliedChanges: z.array(z.string()) })
  .passthrough();

export type PlanningAcceptedResponse = z.infer<typeof PlanningAcceptedResponseSchema>;
export type AppSpecStatusResponse = z.infer<typeof AppSpecStatusResponseSchema>;
export type PublicSavedBacklogPlan = z.infer<typeof PublicSavedBacklogPlanSchema>;
export type BacklogStatusResponse = z.infer<typeof BacklogStatusResponseSchema>;
export type BacklogApplyResponse = z.infer<typeof BacklogApplyResponseSchema>;
