import { z } from 'zod';

const projectPath = z.string().min(1, 'projectPath is required');
const issueNumber = z.number().int().positive().safe();
export const IssueValidationRequestSchema = z.object({
  projectPath,
  issueNumber,
  issueTitle: z.string().min(1, 'issueTitle is required'),
  issueBody: z.string(),
  issueLabels: z.array(z.string()).optional(),
  model: z.string().min(1).optional(),
  thinkingLevel: z.enum(['none', 'low', 'medium', 'high', 'ultrathink', 'adaptive']).optional(),
  reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
  providerId: z.string().optional(),
  comments: z
    .array(
      z
        .object({
          author: z.object({ login: z.string() }).nullable().optional(),
          createdAt: z.string(),
          body: z.string(),
        })
        .passthrough()
    )
    .optional(),
  linkedPRs: z
    .array(z.object({ number: issueNumber, title: z.string(), state: z.string() }).passthrough())
    .optional(),
});
export const IssueValidationStatusSchema = z.object({
  projectPath,
  issueNumber: issueNumber.optional(),
});
export const IssueValidationStopSchema = z.object({ projectPath, issueNumber });
export type IssueValidationRequest = z.infer<typeof IssueValidationRequestSchema>;
export type IssueValidationStatusRequest = z.infer<typeof IssueValidationStatusSchema>;
export type IssueValidationStopRequest = z.infer<typeof IssueValidationStopSchema>;
