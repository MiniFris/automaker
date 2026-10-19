import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentSession } from '@/components/views/agent-view/hooks/use-agent-session';

const mocks = vi.hoisted(() => ({ list: vi.fn(), localModel: vi.fn(), getLast: vi.fn(), setLast: vi.fn(), saveModel: vi.fn() }));
vi.mock('@/lib/http-api-client', () => ({ getHttpApiClient: () => ({ sessions: { list: mocks.list } }) }));
vi.mock('@/store/app-store', () => ({ useAppStore: (select: (value: unknown) => unknown) => select({ getLastSelectedSession: mocks.getLast, setLastSelectedSession: mocks.setLast, getAgentModelForSession: mocks.localModel, setAgentModelForSession: mocks.saveModel }) }));

describe('chat selection restoration / direct endpoint identity', () => {
  beforeEach(() => {
    mocks.getLast.mockReturnValue('session'); mocks.localModel.mockReturnValue(undefined);
    mocks.list.mockResolvedValue({ success: true, sessions: [{ id: 'session', model: 'direct-Vendor/Exact:Tag', providerId: 'endpoint-b' }] });
  });

  it('restores the model and endpoint from server metadata when local state is empty', async () => {
    const { result } = renderHook(() => useAgentSession({ projectPath: '/project' }));
    await waitFor(() => expect(result.current.modelSelectionReady).toBe(true));
    expect(result.current.modelSelection).toEqual({ model: 'direct-Vendor/Exact:Tag', providerId: 'endpoint-b' });
  });

  it('keeps a deliberate local model selection without overwriting it from metadata', () => {
    mocks.localModel.mockReturnValue({ model: 'direct-Vendor/Exact:Tag', providerId: 'endpoint-a' });
    const { result } = renderHook(() => useAgentSession({ projectPath: '/project' }));
    expect(result.current.modelSelectionReady).toBe(true);
    expect(result.current.modelSelection.providerId).toBe('endpoint-a'); expect(mocks.list).not.toHaveBeenCalled();
  });

  it('does not silently send the default Claude model while metadata is loading or unavailable', async () => {
    mocks.list.mockRejectedValue(new Error('Offline'));
    const { result } = renderHook(() => useAgentSession({ projectPath: '/project' }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.modelSelectionReady).toBe(false);
    act(() => result.current.setModelSelection({ model: 'direct-Vendor/Exact:Tag', providerId: 'explicit' }));
    expect(result.current.modelSelectionReady).toBe(true); expect(result.current.modelSelection.providerId).toBe('explicit');
  });

  it('does not overwrite a manual selection with a late metadata response', async () => {
    let resolve!: (value: unknown) => void;
    mocks.list.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { result } = renderHook(() => useAgentSession({ projectPath: '/project' }));
    expect(result.current.modelSelectionReady).toBe(false);
    act(() => result.current.setModelSelection({ model: 'direct-Vendor/Exact:Tag', providerId: 'new-choice' }));
    await act(async () => { resolve({ success: true, sessions: [{ id: 'session', model: 'direct-Vendor/Exact:Tag', providerId: 'stale' }] }); });
    expect(result.current.modelSelection.providerId).toBe('new-choice');
  });

  it('invalidates an in-flight restore when the session is deselected', async () => {
    let resolve!: (value: unknown) => void;
    mocks.list.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { result } = renderHook(() => useAgentSession({ projectPath: '/project' }));
    act(() => result.current.handleSelectSession(null));
    await act(async () => { resolve({ success: true, sessions: [{ id: 'session', model: 'direct-Vendor/Exact:Tag', providerId: 'stale' }] }); });
    expect(result.current.currentSessionId).toBeNull(); expect(result.current.modelSelectionReady).toBe(false);
  });
});
