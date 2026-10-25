import { expect, it } from 'vitest';
import * as schemas from '../src/domains/integration-responses.js';

const legacy = {
  issueNumber: 12,
  issueTitle: 'Legacy',
  validatedAt: 'historic timestamp',
  model: 'custom model',
  viewedAt: 123,
  result: {
    verdict: 'historic-verdict',
    confidence: 17,
    relatedFiles: { historic: true },
    prAnalysis: { historic: true },
  },
  custom: { preserved: true },
};
it('preserves upstream opaque records and typed application-owned linked PR metadata', () => {
  const value = {
    success: true,
    openIssues: [
      {
        number: 12,
        title: { opaque: true },
        linkedPRs: [{ number: 3, title: '', state: '', url: '', extra: true }],
      },
    ],
    closedIssues: [{ number: 4, opaque: [1, 2] }],
    extra: true,
  };
  expect(schemas.GithubIssuesResponseSchema.parse(value)).toEqual(value);
  expect(
    schemas.GithubPRsResponseSchema.parse({
      success: true,
      openPRs: [{ number: 3, unknown: {} }],
      mergedPRs: [],
    })
  ).toEqual({ success: true, openPRs: [{ number: 3, unknown: {} }], mergedPRs: [] });
});
it('preserves current stored validation guards without inventing historic analysis enums or metadata types', () => {
  for (const value of [
    {
      success: true,
      validations: [legacy, { ...legacy, issueNumber: -2, result: [{ historic: true }] }],
    },
    { success: true, validation: legacy, isStale: true },
    { success: true, validation: null },
  ])
    expect(schemas.IssueValidationsResponseSchema.parse(value)).toEqual(value);
});
it('preserves list/single status branches, false acknowledgements and absent optional metadata', () => {
  for (const value of [
    { success: true, runningIssues: [] },
    { success: true, isRunning: false },
    { success: true, isRunning: true, startedAt: 'now' },
  ])
    expect(schemas.IssueValidationStatusResponseSchema.parse(value)).toEqual(value);
  expect(
    schemas.IssueValidationStartResponseSchema.parse({ success: false, error: 'Already running' })
  ).toEqual({ success: false, error: 'Already running' });
  expect(
    schemas.IssueValidationStopResponseSchema.parse({ success: false, error: 'Not running' })
  ).toEqual({ success: false, error: 'Not running' });
  expect(schemas.IssueValidationViewedResponseSchema.parse({ success: false })).toEqual({
    success: false,
  });
  expect(
    schemas.IssueValidationDeleteResponseSchema.parse({ success: true, deleted: false })
  ).toEqual({ success: true, deleted: false });
});
it('keeps MCP unknown discovery distinct from an empty tool list and preserves JSON-schema contents', () => {
  for (const schema of [schemas.MCPConnectionResponseSchema, schemas.MCPToolsResponseSchema]) {
    const unknown = schema.parse({ success: true });
    expect(unknown).not.toHaveProperty('tools');
    expect(schema.parse({ success: true, tools: [] })).toEqual({ success: true, tools: [] });
    expect(schema.parse({ success: false, error: 'No tools capability' })).toEqual({
      success: false,
      error: 'No tools capability',
    });
    const value = {
      success: true,
      tools: [
        {
          name: 'read',
          enabled: true,
          inputSchema: { type: 'object', properties: { opaque: { oneOf: [{ type: 'string' }] } } },
          extra: { kept: true },
        },
      ],
    };
    expect(schema.parse(value)).toEqual(value);
  }
});

it.each([
  [
    schemas.GithubRemoteResponseSchema,
    { success: true, hasGitHubRemote: true, remoteUrl: null, owner: 7, repo: null },
  ],
  [
    schemas.GithubIssuesResponseSchema,
    {
      success: true,
      openIssues: [{ number: 1, linkedPRs: [{ number: 2, title: '', state: '', url: false }] }],
      closedIssues: [],
    },
  ],
  [schemas.GithubPRsResponseSchema, { success: true, openPRs: [], mergedPRs: [{ number: '2' }] }],
  [
    schemas.GithubIssueCommentsResponseSchema,
    {
      success: true,
      comments: [{ id: '1', author: { login: false }, body: '', createdAt: 'now' }],
      totalCount: 1,
      hasNextPage: false,
    },
  ],
  [
    schemas.GithubReviewCommentsResponseSchema,
    {
      success: true,
      comments: [{ id: '1', author: 'bot', body: '', createdAt: 'now', isReviewComment: 'yes' }],
      totalCount: 1,
    },
  ],
  [schemas.GithubResolveThreadResponseSchema, { success: true, isResolved: null }],
  [schemas.IssueValidationStartResponseSchema, { success: true, message: '', issueNumber: '1' }],
  [schemas.IssueValidationStatusResponseSchema, { success: true, isRunning: 'yes' }],
  [schemas.IssueValidationStopResponseSchema, { success: false, error: 17 }],
  [
    schemas.IssueValidationsResponseSchema,
    { success: true, validation: { ...legacy, result: null }, isStale: false },
  ],
  [schemas.IssueValidationDeleteResponseSchema, { success: true, deleted: 'yes' }],
  [schemas.IssueValidationViewedResponseSchema, { success: 'yes' }],
  [schemas.MCPConnectionResponseSchema, { success: true, serverInfo: { version: 17 } }],
  [schemas.MCPToolsResponseSchema, { success: true, tools: [{ name: 'read', enabled: 'yes' }] }],
])('rejects malformed owned response fields without coercion (%#)', (schema, value) => {
  expect(schema.safeParse(value).success).toBe(false);
});
