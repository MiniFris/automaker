import { z } from 'zod';

export const PendingPlanApprovalRequestSchema = z
  .object({
    projectPath: z.string().min(1),
    featureId: z.string().min(1),
  })
  .strict();

export const PlanApprovalTicketSchema = z.object({
  approvalToken: z.string().min(1),
  approvalRunId: z.string().min(1),
  planVersion: z.number().int().positive(),
  planContent: z.string(),
});

export const PendingPlanApprovalResponseSchema = z.object({
  success: z.literal(true),
  approval: PlanApprovalTicketSchema.nullable(),
});

export type PendingPlanApprovalRequest = z.infer<typeof PendingPlanApprovalRequestSchema>;
export type PendingPlanApprovalResponse = z.infer<typeof PendingPlanApprovalResponseSchema>;
