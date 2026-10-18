import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEnvironmentTerminal } from '@/lib/terminal-session';
import { apiFetch } from '@/lib/api-fetch';
vi.mock('@/lib/api-fetch', () => ({ apiFetch: vi.fn() }));
const response = (value: unknown, ok = true) => ({ ok, json: async () => value }) as Response;
beforeEach(() => vi.mocked(apiFetch).mockReset());
afterEach(() => vi.restoreAllMocks());
it('inspects the exact worktree and forwards its target plus terminal authentication', async () => {
  vi.mocked(apiFetch)
    .mockResolvedValueOnce(
      response({ success: true, executionEnvironment: { targetId: 'a'.repeat(64) } })
    )
    .mockResolvedValueOnce(response({ success: true }));
  const headers = { 'X-Terminal-Token': 'fixture' };
  await createEnvironmentTerminal('/project/.worktrees/feature', headers);
  expect(apiFetch).toHaveBeenNthCalledWith(1, '/api/git/environment', 'POST', {
    body: { projectPath: '/project/.worktrees/feature' },
  });
  expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/terminal/sessions', 'POST', {
    headers,
    body: {
      cwd: '/project/.worktrees/feature',
      cols: 80,
      rows: 24,
      environmentTargetId: 'a'.repeat(64),
    },
  });
});
it('does not start a terminal or retry locally after failed inspection', async () => {
  vi.mocked(apiFetch).mockResolvedValue(
    response({ success: false, error: 'SSH project unavailable' }, false)
  );
  await expect(createEnvironmentTerminal('/project', {})).rejects.toThrow(
    'SSH project unavailable'
  );
  expect(apiFetch).toHaveBeenCalledOnce();
});
it('does not retry a terminal creation rejected after target settings changed', async () => {
  vi.mocked(apiFetch)
    .mockResolvedValueOnce(
      response({ success: true, executionEnvironment: { targetId: 'a'.repeat(64) } })
    )
    .mockResolvedValueOnce(response({ success: false, error: 'TERMINAL_TARGET_CHANGED' }, false));
  expect((await createEnvironmentTerminal('/project', {})).ok).toBe(false);
  expect(apiFetch).toHaveBeenCalledTimes(2);
});
it('allows explicit unscoped controller terminals without claiming a project runtime', async () => {
  vi.mocked(apiFetch).mockResolvedValue(response({ success: true }));
  await createEnvironmentTerminal(undefined, {});
  expect(apiFetch).toHaveBeenCalledOnce();
  expect(apiFetch).toHaveBeenCalledWith(
    '/api/terminal/sessions',
    'POST',
    expect.objectContaining({
      body: expect.objectContaining({ cwd: undefined, environmentTargetId: undefined }),
    })
  );
});
