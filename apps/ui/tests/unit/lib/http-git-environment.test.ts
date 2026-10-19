import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { HttpApiClient } from '@/lib/http-api-client';
let client: HttpApiClient;
const request = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', request);
  client = new HttpApiClient();
});
afterEach(() => {
  vi.unstubAllGlobals();
});
const response = (value: unknown) => ({ ok: true, status: 200, json: async () => value });
it('carries an inspected target into mutations without changing caller-owned options', async () => {
  request.mockResolvedValueOnce(
    response({
      success: true,
      executionEnvironment: { path: '/project', targetId: 'a'.repeat(64) },
    })
  );
  await client.executionEnvironments.inspectGit('/project');
  request.mockResolvedValueOnce(response({ success: true, result: { committed: true } }));
  await client.worktree.commit('/project', 'Literal $(command)', ['source.txt']);
  expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject({
    worktreePath: '/project',
    message: 'Literal $(command)',
    environmentTargetId: 'a'.repeat(64),
  });
});
it('remembers per-worktree identities from list responses, without sending one project token to another', async () => {
  request.mockResolvedValueOnce(
    response({
      success: true,
      worktrees: [
        {
          path: '/project/.worktrees/task',
          executionEnvironment: { path: '/project/.worktrees/task', targetId: 'b'.repeat(64) },
        },
      ],
    })
  );
  await client.worktree.listAll('/project');
  request.mockResolvedValue(response({ success: true }));
  await client.worktree.stageFiles('/project/.worktrees/task', ['file'], 'stage');
  await client.worktree.commit('/other', 'Other');
  expect(JSON.parse(request.mock.calls[1][1].body).environmentTargetId).toBe('b'.repeat(64));
  expect(JSON.parse(request.mock.calls[2][1].body)).not.toHaveProperty('environmentTargetId');
});
it('does not treat an untrusted-shaped/empty target id as an inspected capability', async () => {
  request.mockResolvedValueOnce(
    response({ success: true, executionEnvironment: { path: '/project', targetId: 'invalid' } })
  );
  await client.executionEnvironments.inspectGit('/project');
  request.mockResolvedValue(response({ success: true }));
  await client.worktree.commit('/project', 'x');
  expect(JSON.parse(request.mock.calls[1][1].body)).not.toHaveProperty('environmentTargetId');
});
it('clears the old remote scope only after observing a Local response', async () => {
  request.mockResolvedValueOnce(
    response({
      success: true,
      executionEnvironment: { path: '/project', targetId: 'a'.repeat(64) },
    })
  );
  await client.executionEnvironments.inspectGit('/project');
  request.mockResolvedValueOnce(
    response({
      success: true,
      executionEnvironment: { path: '/project', type: 'local', targetId: '' },
    })
  );
  await client.git.getDiffs('/project');
  request.mockResolvedValue(response({ success: true }));
  await client.worktree.commit('/project', 'Local after inspection');
  expect(JSON.parse(request.mock.calls[2][1].body)).not.toHaveProperty('environmentTargetId');
});
