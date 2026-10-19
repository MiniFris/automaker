import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import type { TestRunnerEvent } from '@/lib/http-api-client';
import { useTestLogs } from '@/hooks/use-test-logs';

const api = vi.hoisted(() => ({ getTestLogs: vi.fn(), onTestRunnerEvent: vi.fn() }));
vi.mock('@/lib/electron', () => ({ getElectronAPI: () => ({ worktree: api }) }));
const environment = {
  type: 'ssh',
  path: '/p',
  projectPath: '/p',
  runtimeCwd: '/target/p',
  root: '/target/p',
  targetId: 'id',
  pinned: true,
};
const snapshot = {
  sessionId: 'managed-test-id',
  worktreePath: '/p',
  command: 'npm test',
  status: 'running',
  logs: 'TARGET_LOGS',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  exitCode: null,
  executionEnvironment: environment,
};
let receive: (event: TestRunnerEvent) => void;
beforeEach(() => {
  api.getTestLogs.mockReset().mockResolvedValue({ success: true, result: snapshot });
  api.onTestRunnerEvent.mockReset().mockImplementation((callback) => {
    receive = callback;
    return () => {};
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('restores the actual runtime/cwd from the captured session without inspecting new settings', async () => {
  const { result } = renderHook(() => useTestLogs({ worktreePath: '/p' }));
  await waitFor(() => expect(result.current.logs).toBe('TARGET_LOGS'));
  expect(result.current.executionEnvironment).toEqual(environment);
});
it('shows unconfirmed completion errors and recovers the final buffered tail', async () => {
  const { result } = renderHook(() => useTestLogs({ worktreePath: '/p' }));
  await waitFor(() => expect(result.current.status).toBe('running'));
  api.getTestLogs.mockResolvedValue({
    success: true,
    result: { ...snapshot, status: 'error', logs: 'FINAL_TAIL', error: 'Cleanup is unconfirmed' },
  });
  act(() =>
    receive({
      type: 'test-runner:completed',
      payload: {
        ...snapshot,
        status: 'error',
        duration: 10,
        timestamp: new Date().toISOString(),
        error: 'Cleanup is unconfirmed',
      },
    } as TestRunnerEvent)
  );
  await waitFor(() => expect(result.current.logs).toBe('FINAL_TAIL'));
  expect(result.current.status).toBe('error');
  expect(result.current.error).toBe('Cleanup is unconfirmed');
  expect(result.current.executionEnvironment).toEqual(environment);
});
it('does not leave a managed test marked running after backend restart loses its session', async () => {
  vi.useFakeTimers();
  const { result } = renderHook(() =>
    useTestLogs({ worktreePath: '/p', sessionId: 'managed-test-id' })
  );
  await act(async () => {});
  expect(result.current.status).toBe('running');
  api.getTestLogs.mockRejectedValue(
    new Error('Session unavailable after backend restart; no replay')
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(result.current.status).toBe('error');
  expect(result.current.isRunning).toBe(false);
  expect(result.current.error).toContain('no replay');
  expect(api.getTestLogs).toHaveBeenLastCalledWith('/p', 'managed-test-id');
});
