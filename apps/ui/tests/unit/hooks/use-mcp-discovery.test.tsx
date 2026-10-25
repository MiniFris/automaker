import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useMCPServers } from '@/components/views/settings-view/mcp-servers/hooks/use-mcp-servers';

const state = vi.hoisted(() => ({
  testServer: vi.fn(),
  listTools: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  load: vi.fn(),
  sync: vi.fn(),
}));
vi.mock('@/lib/http-api-client', () => ({
  getHttpApiClient: () => ({ mcp: { testServer: state.testServer, listTools: state.listTools } }),
}));
vi.mock('@/store/app-store', () => ({
  useAppStore: () => ({
    mcpServers: [],
    addMCPServer: vi.fn(),
    updateMCPServer: vi.fn(),
    removeMCPServer: vi.fn(),
  }),
}));
vi.mock('@/hooks/use-settings-migration', () => ({
  syncSettingsToServer: state.sync,
  loadMCPServersFromServer: state.load,
}));
vi.mock('sonner', () => ({
  toast: { success: state.success, warning: state.warning, error: state.error },
}));
const server = { id: 'owned', name: 'Owned server', type: 'stdio' as const, command: 'fixture' };
beforeEach(() => {
  vi.clearAllMocks();
  state.load.mockResolvedValue(true);
  state.sync.mockResolvedValue(true);
  state.testServer.mockResolvedValue({ success: true, connectionTime: 12 });
});
afterEach(cleanup);

it('requests the catalog separately after connection and preserves a confirmed empty catalog', async () => {
  state.listTools.mockResolvedValue({ success: true, tools: [] });
  const hook = renderHook(useMCPServers);
  act(() => hook.result.current.handleTestServer(server));
  await waitFor(() => expect(hook.result.current.serverTestStates.owned?.status).toBe('success'));
  expect(state.testServer).toHaveBeenCalledWith('owned');
  expect(state.listTools).toHaveBeenCalledWith('owned');
  expect(state.testServer.mock.invocationCallOrder[0]).toBeLessThan(
    state.listTools.mock.invocationCallOrder[0]
  );
  expect(hook.result.current.serverTestStates.owned).toMatchObject({
    tools: [],
    connectionTime: 12,
  });
  expect(state.success).toHaveBeenCalledOnce();
  expect(state.warning).not.toHaveBeenCalled();
});

it.each([{ success: false, error: 'Fixture catalog failure' }, { success: true }])(
  'keeps an unconfirmed catalog unknown without inventing zero tools (%#)',
  async (response) => {
    state.listTools.mockResolvedValue(response);
    const hook = renderHook(useMCPServers);
    act(() => hook.result.current.handleTestServer(server));
    await waitFor(() =>
      expect(hook.result.current.serverTestStates.owned?.toolsError).toBeTruthy()
    );
    expect(hook.result.current.serverTestStates.owned).toMatchObject({
      status: 'success',
      connectionTime: 12,
    });
    expect(hook.result.current.serverTestStates.owned.tools).toBeUndefined();
    expect(state.success).not.toHaveBeenCalled();
    expect(state.warning).toHaveBeenCalledOnce();
  }
);

it('does not discover tools after a rejected connection', async () => {
  state.testServer.mockResolvedValue({ success: false, error: 'Connection unavailable' });
  const hook = renderHook(useMCPServers);
  act(() => hook.result.current.handleTestServer(server));
  await waitFor(() => expect(hook.result.current.serverTestStates.owned?.status).toBe('error'));
  expect(state.listTools).not.toHaveBeenCalled();
  expect(state.error).toHaveBeenCalledOnce();
});
