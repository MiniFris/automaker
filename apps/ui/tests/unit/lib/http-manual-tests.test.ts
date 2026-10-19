import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { HttpApiClient } from '@/lib/http-api-client';

let client: HttpApiClient;
const request = vi.fn();
const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
beforeEach(() => {
  request.mockReset();
  vi.stubGlobal('fetch', request);
  client = new HttpApiClient();
});
afterEach(() => vi.unstubAllGlobals());

it('inspects the actual workspace just before starting manual tests', async () => {
  request.mockResolvedValueOnce(
    response({ success: true, executionEnvironment: { path: '/p', targetId: 'a'.repeat(64) } })
  );
  request.mockResolvedValueOnce(
    response({ success: true, result: { sessionId: 'managed-test-id' } })
  );
  await client.worktree.startTests('/p', { projectPath: '/p', testFile: 'file space.test.ts' });
  expect(request.mock.calls[0][0]).toContain('/api/git/environment');
  expect(request.mock.calls[1][0]).toContain('/api/worktree/start-tests');
  expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({
    worktreePath: '/p',
    projectPath: '/p',
    testFile: 'file space.test.ts',
    environmentTargetId: 'a'.repeat(64),
  });
});
it('uses the freshly inspected ID even when the selector canonicalizes an old alias', async () => {
  request.mockResolvedValueOnce(
    response({ success: true, executionEnvironment: { path: '/p/', targetId: 'a'.repeat(64) } })
  );
  await client.executionEnvironments.inspectGit('/p/');
  request.mockResolvedValueOnce(
    response({ success: true, executionEnvironment: { path: '/p', targetId: 'b'.repeat(64) } })
  );
  request.mockResolvedValueOnce(response({ success: true }));
  await client.worktree.startTests('/p/');
  expect(JSON.parse(request.mock.calls[2][1].body).environmentTargetId).toBe('b'.repeat(64));
});
it('does not start, retry, or fall back when inspection fails', async () => {
  request.mockResolvedValueOnce(response({ success: false, error: 'SSH target unavailable' }));
  await expect(client.worktree.startTests('/p')).rejects.toThrow('SSH target unavailable');
  expect(request).toHaveBeenCalledTimes(1);
});
it('sends an explicit empty Local scope after an old remote ID without reusing that ID', async () => {
  request.mockResolvedValueOnce(
    response({ success: true, executionEnvironment: { path: '/p/', targetId: 'a'.repeat(64) } })
  );
  await client.executionEnvironments.inspectGit('/p/');
  request.mockResolvedValueOnce(
    response({ success: true, executionEnvironment: { path: '/p', type: 'local', targetId: '' } })
  );
  request.mockResolvedValueOnce(response({ success: true }));
  await client.worktree.startTests('/p/');
  expect(JSON.parse(request.mock.calls[2][1].body).environmentTargetId).toBe('');
});
it('stops and reads the immutable test session ID without inspecting a new default', async () => {
  request.mockResolvedValue(response({ success: true }));
  await client.worktree.stopTests('managed-test-old');
  await client.worktree.getTestLogs(undefined, 'managed-test-old');
  expect(request).toHaveBeenCalledTimes(2);
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ sessionId: 'managed-test-old' });
  expect(request.mock.calls[1][0]).toContain('test-logs?sessionId=managed-test-old');
});
