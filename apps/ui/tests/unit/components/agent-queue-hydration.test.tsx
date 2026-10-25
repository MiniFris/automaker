import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useElectronAgent } from '@/hooks/use-electron-agent';
const api = vi.hoisted(() => ({
  start: vi.fn(),
  history: vi.fn(),
  queue: vi.fn(),
  stream: vi.fn(),
}));
vi.mock('@/lib/electron', () => ({
  getElectronAPI: () => ({
    agent: {
      start: api.start,
      getHistory: api.history,
      queueList: api.queue,
      onStream: api.stream,
    },
  }),
}));
vi.mock('@/hooks/use-message-queue', () => ({
  useMessageQueue: () => ({
    queuedMessages: [],
    isProcessingQueue: false,
    clearQueue: vi.fn(),
    processNext: vi.fn(),
  }),
}));
vi.mock('@/lib/i18n', () => ({ translate: (value: string) => value }));
beforeEach(() => {
  api.start.mockResolvedValue({ success: true, messages: [] });
  api.history.mockResolvedValue({ success: true, messages: [], isRunning: false });
  api.stream.mockReturnValue(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('loads the persisted server queue, including quarantine, when reopening a session', async () => {
  const paused = { id: 'paused', message: 'Retained', deliveryStatus: 'interrupted' };
  api.queue.mockResolvedValue({ success: true, queue: [paused] });
  const { result } = renderHook(() => useElectronAgent({ sessionId: 'session' }));
  await waitFor(() => expect(result.current.serverQueue).toEqual([paused]));
  expect(api.queue).toHaveBeenCalledWith('session');
});
it('does not overwrite a newer stream queue update with a late hydration response', async () => {
  let resolve!: (value: unknown) => void;
  api.queue.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  const { result } = renderHook(() => useElectronAgent({ sessionId: 'session' }));
  await waitFor(() => expect(api.queue).toHaveBeenCalled());
  act(() =>
    api.stream.mock.calls[0][0]({
      sessionId: 'session',
      type: 'queue_updated',
      queue: [{ id: 'new', message: 'New state' }],
    })
  );
  await act(async () => resolve({ success: true, queue: [{ id: 'old', message: 'Old state' }] }));
  expect(result.current.serverQueue.map((item) => item.id)).toEqual(['new']);
});
