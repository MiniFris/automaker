import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRunningAgents } from '@/hooks/queries/use-running-agents';

const state = vi.hoisted(() => ({
  getAll: vi.fn(),
  unsubscribe: vi.fn(),
  listener: undefined as ((event: unknown) => void) | undefined,
}));
vi.mock('@/lib/electron', () => ({
  getElectronAPI: () => ({
    runningAgents: { getAll: state.getAll },
    agent: {
      onStream: (listener: (event: unknown) => void) => {
        state.listener = listener;
        return state.unsubscribe;
      },
    },
  }),
}));
let client: QueryClient;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  state.getAll.mockResolvedValue({ success: true, runningAgents: [], totalCount: 0 });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
});
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);
it('polls leases every five seconds even without terminal frames or global WS silence', async () => {
  renderHook(() => useRunningAgents(), { wrapper });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(state.getAll).toHaveBeenCalledTimes(1);
  state.listener?.({ type: 'stream', content: 'Frequent chunks do not suppress polling' });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(state.getAll).toHaveBeenCalledTimes(2);
});
it('debounces lifecycle updates and removes the subscription/timer on unmount', async () => {
  const hook = renderHook(() => useRunningAgents(), { wrapper });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  act(() => {
    state.listener?.({ type: 'started' });
    state.listener?.({ type: 'complete' });
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(299);
  });
  expect(state.getAll).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(state.getAll).toHaveBeenCalledTimes(2);
  act(() => {
    state.listener?.({ type: 'error' });
  });
  hook.unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(state.getAll).toHaveBeenCalledTimes(2);
  expect(state.unsubscribe).toHaveBeenCalledOnce();
});

it('derives the sidebar count when an older API omits totalCount', async () => {
  state.getAll.mockResolvedValue({
    success: true,
    runningAgents: [{ kind: 'chat', sessionId: 'session' }],
  });
  const hook = renderHook(() => useRunningAgents(), { wrapper });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(hook.result.current.data?.count).toBe(1);
});
