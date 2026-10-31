import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import type { AgentConversationEntry } from '@automaker/types';
import type { AutoModeEvent } from '@/types/electron';
import { afterEach, expect, it, vi } from 'vitest';
import { getElectronAPI } from '@/lib/electron';
import { useAgentConversation } from '@/hooks/queries/use-agent-conversation';

vi.mock('@/lib/electron', () => ({ getElectronAPI: vi.fn() }));
afterEach(() => vi.restoreAllMocks());
const entry = (sequence: number): AgentConversationEntry => ({
  id: `run:${sequence}`,
  runId: 'run',
  sequence,
  timestamp: '2026-01-01T00:00:00Z',
  kind: 'assistant',
  content: `Message ${sequence}`,
});
it('keeps live events arriving during a snapshot fetch and excludes other tasks and projects', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let listener: (event: AutoModeEvent) => void = () => {};
  let resolve!: (value: unknown) => void;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const unsubscribe = vi.fn();
  vi.mocked(getElectronAPI).mockReturnValue({
    features: { getAgentOutput: vi.fn().mockReturnValue(pending) },
    autoMode: {
      onEvent: vi.fn((callback) => {
        listener = callback;
        return unsubscribe;
      }),
    },
  } as never);
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result, unmount } = renderHook(() => useAgentConversation('/project', 'task', true), {
    wrapper,
  });
  const emit = (value: AgentConversationEntry, projectPath = '/project', featureId = 'task') =>
    listener({ type: 'auto_mode_conversation', projectPath, featureId, entry: value });
  await act(async () => {
    emit(entry(1));
    emit(entry(1));
    emit(entry(99), '/other');
    emit(entry(98), '/project', 'other');
    resolve({ success: true, content: 'Legacy snapshot', conversation: [entry(0), entry(1)] });
    await pending;
  });
  await waitFor(() => expect(result.current.data?.conversation).toEqual([entry(0), entry(1)]));
  await act(async () => {
    emit(entry(2));
  });
  await waitFor(() =>
    expect(result.current.data?.conversation).toEqual([entry(0), entry(1), entry(2)])
  );
  unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
  client.clear();
});
