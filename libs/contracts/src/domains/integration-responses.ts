import { z } from 'zod';

const success = z.literal(true);
const issueNumber = z.number().int().positive().safe();
const failure = z.object({ success: z.literal(false), error: z.string() }).passthrough();

export const GithubRemoteResponseSchema = z
  .object({
    success,
    hasGitHubRemote: z.boolean(),
    remoteUrl: z.string().nullable(),
    owner: z.string().nullable(),
    repo: z.string().nullable(),
  })
  .passthrough();
/** CLI records own only their validated number; upstream fields remain opaque and extensible. */
export const GithubRecordSchema = z.object({ number: issueNumber }).passthrough();
export const GithubLinkedPRSchema = z
  .object({ number: issueNumber, title: z.string(), state: z.string(), url: z.string() })
  .passthrough();
export const GithubIssuesResponseSchema = z
  .object({
    success,
    openIssues: z.array(
      GithubRecordSchema.extend({ linkedPRs: z.array(GithubLinkedPRSchema).optional() })
    ),
    closedIssues: z.array(GithubRecordSchema),
  })
  .passthrough();
export const GithubPRsResponseSchema = z
  .object({ success, openPRs: z.array(GithubRecordSchema), mergedPRs: z.array(GithubRecordSchema) })
  .passthrough();

export const GithubIssueCommentSchema = z
  .object({
    id: z.string(),
    author: z.object({ login: z.string(), avatarUrl: z.string().optional() }).passthrough(),
    body: z.string(),
    createdAt: z.string(),
    updatedAt: z.string().optional(),
  })
  .passthrough();
export const GithubIssueCommentsResponseSchema = z
  .object({
    success,
    comments: z.array(GithubIssueCommentSchema),
    totalCount: z.number().int().nonnegative(),
    hasNextPage: z.boolean(),
    endCursor: z.string().optional(),
  })
  .passthrough();
export const GithubReviewCommentSchema = z
  .object({
    id: z.string(),
    author: z.string(),
    body: z.string(),
    createdAt: z.string(),
    isReviewComment: z.boolean(),
    avatarUrl: z.string().optional(),
    path: z.string().optional(),
    line: z.number().int().optional(),
    updatedAt: z.string().optional(),
    isOutdated: z.boolean().optional(),
    isResolved: z.boolean().optional(),
    threadId: z.string().optional(),
    diffHunk: z.string().optional(),
    side: z.string().optional(),
    commitId: z.string().optional(),
    isBot: z.boolean().optional(),
  })
  .passthrough();
export const GithubReviewCommentsResponseSchema = z
  .object({
    success,
    comments: z.array(GithubReviewCommentSchema),
    totalCount: z.number().int().nonnegative(),
  })
  .passthrough();
export const GithubResolveThreadResponseSchema = z
  .object({ success, isResolved: z.boolean() })
  .passthrough();

export const IssueValidationStartResponseSchema = z.union([
  z.object({ success, message: z.string(), issueNumber }).passthrough(),
  failure,
]);
export const IssueValidationStopResponseSchema = z.union([
  z.object({ success, message: z.string() }).passthrough(),
  failure,
]);
export const IssueValidationStatusResponseSchema = z.union([
  z
    .object({
      success,
      runningIssues: z.array(issueNumber),
      isRunning: z.never().optional(),
      startedAt: z.never().optional(),
    })
    .passthrough(),
  z
    .object({
      success,
      isRunning: z.boolean(),
      startedAt: z.string().optional(),
      runningIssues: z.never().optional(),
    })
    .passthrough(),
]);
/** Mirrors the storage guard: analysis containers and unvalidated legacy metadata stay opaque. */
export const PublicIssueValidationResultSchema = z.union([
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);
export const PublicStoredIssueValidationSchema = z
  .object({
    issueNumber: z.number(),
    issueTitle: z.string(),
    validatedAt: z.string(),
    model: z.string(),
    result: PublicIssueValidationResultSchema,
  })
  .passthrough();
export const IssueValidationsResponseSchema = z.union([
  z
    .object({
      success,
      validations: z.array(PublicStoredIssueValidationSchema),
      validation: z.never().optional(),
      isStale: z.never().optional(),
    })
    .passthrough(),
  z
    .object({
      success,
      validation: PublicStoredIssueValidationSchema,
      isStale: z.boolean(),
      validations: z.never().optional(),
    })
    .passthrough(),
  z
    .object({
      success,
      validation: z.null(),
      isStale: z.never().optional(),
      validations: z.never().optional(),
    })
    .passthrough(),
]);
export const IssueValidationDeleteResponseSchema = z
  .object({ success, deleted: z.boolean() })
  .passthrough();
export const IssueValidationViewedResponseSchema = z.object({ success: z.boolean() }).passthrough();

export const MCPPublicToolSchema = z
  .object({
    name: z.string(),
    enabled: z.boolean(),
    description: z.string().optional(),
    inputSchema: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
// Missing tools is unknown discovery, not an empty list. No defaults/coercions here.
export const MCPConnectionResponseSchema = z.union([
  z
    .object({
      success,
      tools: z.array(MCPPublicToolSchema).optional(),
      connectionTime: z.number().nonnegative().optional(),
      serverInfo: z
        .object({ name: z.string().optional(), version: z.string().optional() })
        .passthrough()
        .optional(),
      error: z.string().optional(),
    })
    .passthrough(),
  failure.extend({
    connectionTime: z.number().nonnegative().optional(),
    tools: z.array(MCPPublicToolSchema).optional(),
  }),
]);
export const MCPToolsResponseSchema = z.union([
  z
    .object({
      success,
      tools: z.array(MCPPublicToolSchema).optional(),
      error: z.string().optional(),
    })
    .passthrough(),
  failure.extend({ tools: z.array(MCPPublicToolSchema).optional() }),
]);
