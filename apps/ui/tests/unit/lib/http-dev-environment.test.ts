import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { HttpApiClient } from '@/lib/http-api-client';
let client: HttpApiClient;
const fetcher = vi.fn();
const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
beforeEach(() => {
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
  client = new HttpApiClient();
});
afterEach(() => vi.unstubAllGlobals());
it('inspects the actual alias before starting and scopes the dev command to its fresh target', async () => {
  fetcher.mockResolvedValueOnce(
    response({ success: true, executionEnvironment: { path: '/p', targetId: 'a'.repeat(64) } })
  );
  fetcher.mockResolvedValueOnce(
    response({ success: true, result: { sessionId: 'managed-dev-one' } })
  );
  await client.worktree.startDevServer('/p', '/p/.worktrees/task');
  expect(fetcher.mock.calls[0][0]).toContain('/api/git/environment');
  expect(JSON.parse(fetcher.mock.calls[0][1].body).projectPath).toBe('/p/.worktrees/task');
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
    projectPath: '/p',
    worktreePath: '/p/.worktrees/task',
    environmentTargetId: 'a'.repeat(64),
  });
});
it('does not dispatch or retry if the selected target cannot be inspected', async () => {
  fetcher.mockResolvedValueOnce(response({ success: false, error: 'SSH checkout unavailable' }));
  await expect(client.worktree.startDevServer('/p', '/p')).rejects.toThrow(
    'SSH checkout unavailable'
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('stops/reads by the original dev session ID without inspecting new defaults', async () => {
  fetcher.mockResolvedValue(response({ success: true }));
  await client.worktree.stopDevServer('/p', 'managed-dev-original');
  await client.worktree.getDevServerLogs('/p', 'managed-dev-original');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    worktreePath: '/p',
    sessionId: 'managed-dev-original',
  });
  expect(fetcher.mock.calls[1][0]).toContain('sessionId=managed-dev-original');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
