import { act, renderHook, cleanup, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { useDevServers } from '@/components/views/board-view/worktree-panel/hooks/use-dev-servers';
import type { DevServerLogEvent } from '@/lib/http-api-client';
const api = vi.hoisted(() => ({
  listDevServers: vi.fn(),
  onDevServerLogEvent: vi.fn(),
  stopDevServer: vi.fn(),
}));
vi.mock('@/lib/electron', () => ({ getElectronAPI: () => ({ worktree: api }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
const worktree = { path: '/p', branch: 'main', isMain: true, isCurrent: true, hasWorktree: true };
const session = {
  sessionId: 'managed-dev-original',
  worktreePath: '/p',
  port: 3100,
  url: 'https://preview-3100.example.test/__automaker_preview#secret',
  urlDetected: true,
  preserveUrlHost: true,
  executionEnvironment: { type: 'ssh', runtimeCwd: '/target/p' },
};
let receive: (event: DevServerLogEvent) => void;
beforeEach(() => {
  api.listDevServers
    .mockReset()
    .mockResolvedValue({ success: true, result: { servers: [session] } });
  api.onDevServerLogEvent.mockImplementation((handler) => {
    receive = handler;
    return () => {};
  });
  api.stopDevServer.mockReset().mockResolvedValue({ success: true });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('opens the configured TLS preview origin without replacing its hostname', async () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);
  const { result } = renderHook(() => useDevServers({ projectPath: '/p' }));
  await waitFor(() =>
    expect(result.current.getDevServerInfo(worktree)?.sessionId).toBe(session.sessionId)
  );
  act(() => result.current.handleOpenDevServerUrl(worktree));
  expect(open).toHaveBeenCalledWith(session.url, '_blank', 'noopener,noreferrer');
});
it('passes the captured dev session to Stop, without resolving another target', async () => {
  const { result } = renderHook(() => useDevServers({ projectPath: '/p' }));
  await waitFor(() => expect(result.current.isDevServerRunning(worktree)).toBe(true));
  await act(() => result.current.handleStopDevServer(worktree));
  expect(api.stopDevServer).toHaveBeenCalledWith('/p', session.sessionId);
});
it('ignores a delayed stopped event from a different session at the same alias', async () => {
  const { result } = renderHook(() => useDevServers({ projectPath: '/p' }));
  await waitFor(() => expect(result.current.isDevServerRunning(worktree)).toBe(true));
  act(() =>
    receive({
      type: 'dev-server:stopped',
      payload: {
        ...session,
        sessionId: 'managed-dev-older',
        exitCode: 0,
        timestamp: new Date().toISOString(),
      },
    })
  );
  expect(result.current.getDevServerInfo(worktree)?.sessionId).toBe(session.sessionId);
});
