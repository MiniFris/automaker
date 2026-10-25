import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { GithubReadPort } from '../../src/modules/github/github-read.port.js';
import {
  GithubCommentsReadPort,
  GithubReviewMutationPort,
} from '../../src/modules/github/github-review.port.js';
import { GithubDiscoveryService } from '../../src/modules/github/github-discovery.service.js';
import { GithubReviewService } from '../../src/modules/github/github-review.service.js';
import { IssueValidationService } from '../../src/modules/github/issue-validation.service.js';
import { IssueValidationRepository } from '../../src/modules/github/issue-validation.repository.js';
import { MCPApplicationService } from '../../src/modules/mcp/mcp-application.service.js';
import { MCPTestService } from '../../src/services/mcp-test-service.js';
import { NotFoundDomainError, UnavailableDomainError } from '../../src/core/errors/index.js';
import * as schemas from '@automaker/contracts/domains/integration-responses';

let root: string, base: string, runtime: Awaited<ReturnType<typeof createNestApplication>>;
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'native-integration-responses-'));
  runtime = await createNestApplication({
    workingDirectory: root,
    dataDir: path.join(root, 'data'),
    host: '127.0.0.1',
    port: 0,
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      NODE_ENV: 'test',
      AUTOMAKER_API_KEY: 'fixture',
      ALLOWED_ROOT_DIRECTORY: root,
      ENABLE_REQUEST_LOGGING: 'false',
    },
  });
  await runtime.start();
  base = `http://127.0.0.1:${runtime.app.getHttpServer().address().port}/api/`;
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await runtime?.app.close();
  await rm(root, { recursive: true, force: true });
});
function input() {
  return {
    projectPath: root,
    issueNumber: 12,
    issueTitle: 'Offline issue',
    issueBody: 'Fixture',
    prNumber: 3,
    threadId: 'thread',
    resolve: true,
    serverId: 'offline',
  };
}
async function post(route: string, body: unknown = input(), key = 'fixture') {
  const response = await fetch(base + route, {
    method: 'POST',
    headers: { 'x-api-key': key, 'content-type': 'application/json', Connection: 'close' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
const legacy = {
  issueNumber: 12,
  issueTitle: 'Legacy issue',
  validatedAt: 'historic timestamp',
  model: 'custom model',
  viewedAt: 17,
  result: {
    verdict: 'historic-verdict',
    relatedFiles: { old: true },
    prAnalysis: { legacy: true },
  },
  extra: { retained: true },
};

it('validates all fourteen native handlers through offline read/mutation/MCP ports and stored legacy validation data', async () => {
  const remote = {
    hasGitHubRemote: true,
    remoteUrl: 'https://github.com/owner/repo',
    owner: 'owner',
    repo: 'repo',
  };
  Object.defineProperty(remote, 'hostname', {
    value: 'internal-github.invalid',
    enumerable: false,
  });
  const reads = runtime.app.get(GithubReadPort),
    comments = runtime.app.get(GithubCommentsReadPort),
    writes = runtime.app.get(GithubReviewMutationPort);
  vi.spyOn(reads, 'remote').mockResolvedValue(remote);
  const issues = {
    openIssues: [
      {
        number: 12,
        upstream: { arbitrary: [1] },
        linkedPRs: [{ number: 3, title: '', state: '', url: '' }],
      },
    ],
    closedIssues: [{ number: 4 }],
  };
  vi.spyOn(reads, 'issues').mockResolvedValue(issues);
  const prs = { openPRs: [{ number: 3, opaque: { field: true } }], mergedPRs: [] };
  vi.spyOn(reads, 'prs').mockResolvedValue(prs);
  const issueComments = {
    comments: [{ id: 'c1', author: { login: 'ghost' }, body: '', createdAt: 'now' }],
    totalCount: 1,
    hasNextPage: false,
  };
  vi.spyOn(comments, 'issueComments').mockResolvedValue(issueComments);
  const reviewComments = [
    {
      id: 'review-1',
      author: 'bot',
      body: '',
      createdAt: 'now',
      isReviewComment: false,
      isBot: true,
    },
  ];
  vi.spyOn(comments, 'reviewComments').mockResolvedValue(reviewComments);
  vi.spyOn(writes, 'resolveThread').mockResolvedValue({ isResolved: false });
  vi.spyOn(runtime.app.get(IssueValidationService), 'start').mockReturnValue({
    success: true,
    message: 'Accepted offline fixture',
    issueNumber: 12,
  });
  await runtime.app.get(IssueValidationRepository).write(root, 12, legacy as never);
  const mcp = runtime.app.get(MCPTestService);
  vi.spyOn(mcp, 'testConnectionById').mockResolvedValue({
    success: true,
    connectionTime: 1,
    serverInfo: { name: 'Offline fixture' },
  });
  const tools = [
    {
      name: 'read',
      enabled: true,
      inputSchema: { type: 'object', properties: { custom: { anyOf: [{ type: 'string' }] } } },
    },
  ];
  vi.spyOn(mcp, 'listToolsById').mockResolvedValue({ success: true, tools });
  const cases = [
    ['github/check-remote', schemas.GithubRemoteResponseSchema, { success: true, ...remote }],
    ['github/issues', schemas.GithubIssuesResponseSchema, { success: true, ...issues }],
    ['github/prs', schemas.GithubPRsResponseSchema, { success: true, ...prs }],
    [
      'github/issue-comments',
      schemas.GithubIssueCommentsResponseSchema,
      { success: true, ...issueComments },
    ],
    [
      'github/pr-review-comments',
      schemas.GithubReviewCommentsResponseSchema,
      { success: true, comments: reviewComments, totalCount: 1 },
    ],
    [
      'github/resolve-pr-comment',
      schemas.GithubResolveThreadResponseSchema,
      { success: true, isResolved: false },
    ],
    [
      'github/validate-issue',
      schemas.IssueValidationStartResponseSchema,
      { success: true, message: 'Accepted offline fixture', issueNumber: 12 },
    ],
    [
      'github/validation-status',
      schemas.IssueValidationStatusResponseSchema,
      { success: true, isRunning: false },
    ],
    [
      'github/validation-stop',
      schemas.IssueValidationStopResponseSchema,
      { success: false, error: 'No validation is running for issue #12' },
    ],
    [
      'github/validations',
      schemas.IssueValidationsResponseSchema,
      { success: true, validation: legacy, isStale: false },
    ],
    [
      'github/validation-mark-viewed',
      schemas.IssueValidationViewedResponseSchema,
      { success: true },
    ],
    [
      'github/validation-delete',
      schemas.IssueValidationDeleteResponseSchema,
      { success: true, deleted: true },
    ],
    [
      'mcp/test',
      schemas.MCPConnectionResponseSchema,
      { success: true, connectionTime: 1, serverInfo: { name: 'Offline fixture' } },
    ],
    ['mcp/tools', schemas.MCPToolsResponseSchema, { success: true, tools }],
  ] as const;
  for (const [route, schema, expected] of cases) {
    const response = await post(route);
    expect(response.status, route).toBe(200);
    expect(schema.parse(response.body), route).toEqual(expected);
    expect(response.body).not.toHaveProperty('hostname');
  }
});

it('keeps absent MCP tools, false results, list status and null validation wire variants unchanged', async () => {
  const mcp = runtime.app.get(MCPTestService);
  vi.spyOn(mcp, 'testConnectionById').mockResolvedValue({ success: true });
  const tools = vi.spyOn(mcp, 'listToolsById').mockResolvedValue({ success: true });
  expect(await post('mcp/test')).toEqual({ status: 200, body: { success: true } });
  expect(await post('mcp/tools')).toEqual({ status: 200, body: { success: true } });
  tools.mockResolvedValue({ success: false, error: 'No tools capability' });
  expect(await post('mcp/tools')).toEqual({
    status: 200,
    body: { success: false, error: 'No tools capability' },
  });
  expect(await post('github/validation-status', { projectPath: root })).toEqual({
    status: 200,
    body: { success: true, runningIssues: [] },
  });
  expect(await post('github/validations', { projectPath: root, issueNumber: 99 })).toEqual({
    status: 200,
    body: { success: true, validation: null },
  });
  expect(
    await post('github/validation-mark-viewed', { projectPath: root, issueNumber: 99 })
  ).toEqual({ status: 200, body: { success: false } });
});

const malformed = [
  [
    'github/check-remote',
    'discovery',
    'remote',
    { success: true, hasGitHubRemote: true, remoteUrl: null, owner: 1, repo: null },
  ],
  [
    'github/issues',
    'discovery',
    'issues',
    { success: true, openIssues: [{ number: '12' }], closedIssues: [] },
  ],
  ['github/prs', 'discovery', 'prs', { success: true, openPRs: [], mergedPRs: null }],
  [
    'github/issue-comments',
    'reviews',
    'issueComments',
    {
      success: true,
      comments: [{ id: '1', author: { login: 1 }, body: '', createdAt: 'now' }],
      totalCount: 1,
      hasNextPage: false,
    },
  ],
  [
    'github/pr-review-comments',
    'reviews',
    'reviewComments',
    {
      success: true,
      comments: [{ id: '1', author: 'a', body: '', createdAt: 'now', isReviewComment: 'yes' }],
      totalCount: 1,
    },
  ],
  ['github/resolve-pr-comment', 'reviews', 'resolve', { success: true, isResolved: null }],
  [
    'github/validate-issue',
    'validations',
    'start',
    { success: true, message: '', issueNumber: '12' },
  ],
  ['github/validation-status', 'validations', 'status', { success: true, isRunning: 'no' }],
  ['github/validation-stop', 'validations', 'stop', { success: false, error: 1 }],
  [
    'github/validations',
    'validations',
    'stored',
    { success: true, validation: { ...legacy, result: null }, isStale: false },
  ],
  ['github/validation-delete', 'validations', 'delete', { success: true, deleted: 'yes' }],
  ['github/validation-mark-viewed', 'validations', 'markViewed', { success: 'yes' }],
  ['mcp/test', 'mcp', 'test', { success: true, serverInfo: { version: 1 } }],
  ['mcp/tools', 'mcp', 'tools', { success: true, tools: [{ name: 'read', enabled: 'yes' }] }],
] as const;
it.each(malformed)(
  'rejects malformed native response from %s without leaking the payload',
  async (route, producer, method, value) => {
    const producers = {
      discovery: runtime.app.get(GithubDiscoveryService),
      reviews: runtime.app.get(GithubReviewService),
      validations: runtime.app.get(IssueValidationService),
      mcp: runtime.app.get(MCPApplicationService),
    };
    const owner = producers[producer] as unknown as Record<string, (...args: unknown[]) => unknown>;
    vi.spyOn(owner, method).mockImplementation(() => value);
    const response = await post(route);
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ success: false, error: 'Internal server error.' });
    expect(response.body).not.toHaveProperty('tools');
    expect(response.body).not.toHaveProperty('validation');
  }
);

it('preserves auth/path/request and producer exception precedence before response parsing', async () => {
  const discovery = vi
    .spyOn(runtime.app.get(GithubDiscoveryService), 'remote')
    .mockResolvedValue({ malformed: true } as never);
  expect((await post('github/check-remote', input(), 'wrong-key')).status).toBe(403);
  expect(
    (
      await post('github/check-remote', {
        projectPath: path.join(root, '..', 'outside-native-fixture'),
      })
    ).status
  ).toBe(403);
  expect((await post('github/check-remote', { projectPath: 7 })).status).toBe(400);
  expect(discovery).not.toHaveBeenCalled();
  const status = vi
    .spyOn(runtime.app.get(IssueValidationService), 'status')
    .mockReturnValue({ malformed: true } as never);
  expect(
    (await post('github/validation-status', { projectPath: root, issueNumber: 'bad-number' }))
      .status
  ).toBe(400);
  expect(status).not.toHaveBeenCalled();
  vi.spyOn(runtime.app.get(GithubReviewService), 'issueComments').mockRejectedValue(
    new NotFoundDomainError('Owned issue missing.')
  );
  expect(await post('github/issue-comments')).toMatchObject({
    status: 404,
    body: { success: false, error: 'Owned issue missing.', errorCode: 'NOT_FOUND' },
  });
  vi.spyOn(runtime.app.get(MCPApplicationService), 'tools').mockRejectedValue(
    new UnavailableDomainError('Owned discovery unavailable.')
  );
  expect(await post('mcp/tools')).toMatchObject({
    status: 503,
    body: { success: false, error: 'Owned discovery unavailable.', errorCode: 'UNAVAILABLE' },
  });
});
