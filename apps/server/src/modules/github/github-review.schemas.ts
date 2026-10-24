import { z } from 'zod';
import { GithubProjectSchema } from './github-discovery.schemas.js';
const number = z.number().int().positive().max(2_147_483_647);
export const GithubIssueCommentsSchema = GithubProjectSchema.extend({
  issueNumber: number,
  cursor: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9+/=_-]+$/)
    .optional(),
});
export const GithubReviewCommentsSchema = GithubProjectSchema.extend({ prNumber: number });
export const GithubResolveThreadSchema = GithubProjectSchema.extend({
  threadId: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[A-Za-z0-9_+/=-]+$/),
  resolve: z.boolean(),
});
export type GithubIssueCommentsRequest = z.infer<typeof GithubIssueCommentsSchema>;
export type GithubReviewCommentsRequest = z.infer<typeof GithubReviewCommentsSchema>;
export type GithubResolveThreadRequest = z.infer<typeof GithubResolveThreadSchema>;
