import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { WorktreeApplicationService } from '../../src/modules/worktree/worktree-application.service.js';
import { WorktreeHostService } from '../../src/modules/worktree/worktree-host.service.js';
import { WorktreeProcessService } from '../../src/modules/worktree/worktree-process.service.js';
import { WorktreeTextService } from '../../src/modules/worktree/worktree-text.service.js';
import * as requests from '../../src/modules/worktree/worktree.schemas.js';
import { OwnedLocalChildCleanupError } from '../../src/services/owned-local-child.js';
import { NotFoundDomainError } from '../../src/core/errors/index.js';
import { worktreeRoutes } from '../../../../libs/contracts/tests/worktree-route-fixtures.js';
import { worktreeResponseFixtures } from '../../../../libs/contracts/tests/worktree-response-fixtures.js';
import { malformedWorktreeResponse } from '../../../../libs/contracts/tests/worktree-malformed-fixture.js';

let root: string, base: string, runtime: Awaited<ReturnType<typeof createNestApplication>>;
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'native-worktree-response-'));
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
  base = `http://127.0.0.1:${runtime.app.getHttpServer().address().port}/api/worktree/`;
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await runtime?.app.close();
  await rm(root, { recursive: true, force: true });
});
const input = () => ({
  projectPath: root,
  worktreePath: root,
  featureId: 'offline',
  filePath: 'file.txt',
  files: ['file.txt'],
  operation: 'stage',
  message: 'Offline commit',
  remoteName: 'origin',
  remoteUrl: 'https://offline.invalid/repo',
  remote: 'origin',
  branch: 'main',
  branchName: 'feature',
  ontoBranch: 'main',
  stashIndex: 0,
  commitHashes: ['abcd'],
  content: '',
  sessionId: 'offline',
  prNumber: 1,
  useWorktrees: false,
});
function bodyFor(route: (typeof worktreeRoutes)[number]) {
  if (!('requestSchema' in route)) return {};
  const schema = (
    requests as unknown as Record<
      string,
      { shape: Record<string, unknown>; parse: (value: unknown) => unknown }
    >
  )[route.requestSchema];
  return schema!.parse(
    Object.fromEntries(Object.entries(input()).filter(([key]) => key in schema!.shape))
  ) as Record<string, unknown>;
}
async function call(verb: string, route: string, body: Record<string, unknown>, key = 'fixture') {
  const url = new URL(base + route);
  if (verb === 'GET')
    for (const [name, value] of Object.entries(body)) url.searchParams.set(name, String(value));
  const response = await fetch(url, {
    method: verb,
    headers: { 'x-api-key': key, 'content-type': 'application/json', Connection: 'close' },
    ...(verb !== 'GET' ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
function rebase(value: unknown): unknown {
  if (typeof value === 'string') return value.replaceAll('/owned', root);
  if (Array.isArray(value)) return value.map(rebase);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, rebase(v)]));
  return value;
}
function producer(key: string) {
  return (
    {
      worktrees: runtime.app.get(WorktreeApplicationService),
      host: runtime.app.get(WorktreeHostService),
      processes: runtime.app.get(WorktreeProcessService),
      text: runtime.app.get(WorktreeTextService),
    } as Record<string, object>
  )[key] as Record<string, (...args: unknown[]) => unknown>;
}
it.each(worktreeRoutes)(
  'checks the real native $verb $route JSON boundary without dispatching a producer action',
  async (route) => {
    const expected = rebase(worktreeResponseFixtures[route.method]);
    const owner = producer(route.producer);
    const spy = vi.spyOn(owner, route.producerMethod).mockImplementation(() => expected);
    const input = bodyFor(route);
    expect(await call(route.verb, route.route, input)).toEqual({ status: 200, body: expected });
    spy.mockImplementation(() => malformedWorktreeResponse(expected));
    const malformed = await call(route.verb, route.route, input);
    expect(malformed.status).toBe(500);
    expect(malformed.body).toMatchObject({ success: false, error: 'Internal server error.' });
    expect(JSON.stringify(malformed.body)).not.toContain('private-malformed-response-fixture');
  }
);
it('keeps auth/path/request errors and unconfirmed process ownership ahead of response validation', async () => {
  const start = vi
    .spyOn(runtime.app.get(WorktreeProcessService), 'startDev')
    .mockRejectedValue(new OwnedLocalChildCleanupError());
  expect(
    (await call('POST', 'start-dev', { projectPath: root, worktreePath: root }, 'wrong')).status
  ).toBe(403);
  expect(
    (
      await call('POST', 'start-dev', {
        projectPath: root,
        worktreePath: path.join(root, '..', 'outside-private-fixture'),
      })
    ).status
  ).toBe(403);
  expect((await call('POST', 'start-dev', { projectPath: root })).status).toBe(400);
  expect(start).not.toHaveBeenCalled();
  expect(await call('POST', 'start-dev', { projectPath: root, worktreePath: root })).toMatchObject({
    status: 503,
    body: { success: false, errorCode: 'UNAVAILABLE', code: 'LOCAL_PROCESS_CLEANUP_FAILED' },
  });
  vi.spyOn(runtime.app.get(WorktreeApplicationService), 'status').mockRejectedValue(
    new NotFoundDomainError('Owned feature missing.')
  );
  expect(await call('POST', 'status', { projectPath: root, featureId: 'offline' })).toMatchObject({
    status: 404,
    body: { success: false, errorCode: 'NOT_FOUND' },
  });
});
it('accepts actual private Git no-op/read/mutation replies without network, user repositories or processes', async () => {
  const repo = path.join(root, 'private-repo');
  await mkdir(repo);
  const init = await call('POST', 'init-git', { projectPath: repo });
  expect(init.status).toBe(200);
  expect(init.body.result.initialized).toBe(true);
  const env = await call('POST', 'environment', { projectPath: repo });
  expect(env.status).toBe(200);
  expect(env.body.executionEnvironment.path).toBe(repo);
  for (const route of ['list', 'status', 'diffs', 'info']) {
    const body =
      route === 'list'
        ? { projectPath: repo }
        : { projectPath: repo, featureId: 'offline', useWorktrees: false };
    expect((await call('POST', route, body)).status, route).toBe(200);
  }
  const noOp = await call('POST', 'commit', { worktreePath: repo, message: 'No changes' });
  expect(noOp.status).toBe(200);
  expect(noOp.body.result.committed).toBe(false);
  await writeFile(path.join(repo, 'file.txt'), 'Private fixture\n');
  const stage = await call('POST', 'stage-files', {
    worktreePath: repo,
    files: ['file.txt'],
    operation: 'stage',
  });
  expect(stage.status).toBe(200);
  expect(stage.body.result.filesCount).toBe(1);
  const commit = await call('POST', 'commit', {
    worktreePath: repo,
    message: 'Private fixture commit',
  });
  expect(commit.status).toBe(200);
  expect(commit.body.result.committed).toBe(true);
  const log = await call('POST', 'commit-log', { worktreePath: repo });
  expect(log.status).toBe(200);
  expect(log.body.result.total).toBeGreaterThanOrEqual(2);
});
