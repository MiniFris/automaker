import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RunningAgentsView } from '@/components/views/running-agents-view';

const state = vi.hoisted(() => ({
  stop: vi.fn(),
  mutate: vi.fn(),
  refetch: vi.fn(),
  navigate: vi.fn(),
  setCurrentProject: vi.fn(),
  setCurrentWorktree: vi.fn(),
  setLastSelectedSession: vi.fn(),
  toast: vi.fn(),
  failed: false,
  agents: [] as Array<Record<string, unknown>>,
}));
vi.mock('@/lib/i18n', () => ({
  translate: (text: string) => text,
  useUiLocale: () => undefined,
  formatCount: (count: number) => String(count),
}));
vi.mock('@/lib/electron', () => ({ getElectronAPI: () => ({ agent: { stop: state.stop } }) }));
vi.mock('sonner', () => ({ toast: { error: state.toast } }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => state.navigate }));
vi.mock('@/hooks/queries', () => ({
  useRunningAgents: () => ({
    data: { agents: state.agents },
    refetch: state.refetch,
    isLoading: false,
    isFetching: false,
    isError: state.failed,
  }),
}));
vi.mock('@/hooks/mutations', () => ({
  useStopFeature: () => ({ mutate: state.mutate, isPending: false }),
}));
vi.mock('@/store/app-store', () => ({
  useAppStore: () => ({
    projects: [{ id: 'project', path: '/project', name: 'Project' }],
    worktreesByProject: { '/project': [{ path: '/worktree', branch: 'branch' }] },
    setCurrentProject: state.setCurrentProject,
    setCurrentWorktree: state.setCurrentWorktree,
    setLastSelectedSession: state.setLastSelectedSession,
  }),
}));
vi.mock('@/components/views/board-view/dialogs/agent-output-modal', () => ({
  AgentOutputModal: () => <div>Feature output modal</div>,
}));
const chat = {
  kind: 'chat',
  sessionId: 'session',
  featureId: 'chat:session',
  title: 'Named chat',
  projectName: 'Project',
  projectPath: '/project',
  workingDirectory: '/worktree',
  isAutoMode: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  state.failed = false;
  state.agents = [chat];
  state.stop.mockResolvedValue({ success: true });
});
afterEach(cleanup);
it('stops the chat session through agent API, never feature cancellation', async () => {
  render(<RunningAgentsView />);
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  await waitFor(() => expect(state.stop).toHaveBeenCalledWith('session'));
  await waitFor(() => expect(state.refetch).toHaveBeenCalled());
  expect(state.mutate).not.toHaveBeenCalled();
});
it('opens the actual chat in its pinned worktree, not a feature output modal', () => {
  render(<RunningAgentsView />);
  fireEvent.click(screen.getByRole('button', { name: 'Open Chat' }));
  expect(state.setCurrentProject).toHaveBeenCalledWith(
    expect.objectContaining({ path: '/project' })
  );
  expect(state.setCurrentWorktree).toHaveBeenCalledWith('/project', '/worktree', 'branch');
  expect(state.setLastSelectedSession).toHaveBeenCalledWith('/worktree', 'session');
  expect(state.navigate).toHaveBeenCalledWith({ to: '/agent' });
  expect(screen.queryByText('Feature output modal')).toBeNull();
});
it('preserves feature stop and log actions', () => {
  state.agents = [
    { featureId: 'feature', projectPath: '/project', projectName: 'Project', isAutoMode: true },
  ];
  render(<RunningAgentsView />);
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  expect(state.mutate).toHaveBeenCalledWith({ featureId: 'feature', projectPath: '/project' });
  expect(state.stop).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'View Logs' }));
  expect(screen.getByText('Feature output modal')).toBeDefined();
});
it('still permits stopping a chat whose project is no longer in the local UI store', async () => {
  state.agents = [{ ...chat, projectPath: '/removed-project' }];
  render(<RunningAgentsView />);
  expect((screen.getByRole('button', { name: 'Open Chat' }) as HTMLButtonElement).disabled).toBe(
    true
  );
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  await waitFor(() => expect(state.stop).toHaveBeenCalledWith('session'));
});

it('reports an unconfirmed stop without cancelling a feature or pretending the chat disappeared', async () => {
  state.stop.mockResolvedValue({ success: false, error: 'Cleanup unconfirmed' });
  render(<RunningAgentsView />);
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  await waitFor(() =>
    expect(state.toast).toHaveBeenCalledWith('Failed to stop agent', {
      description: 'Cleanup unconfirmed',
    })
  );
  expect(screen.getByText('Named chat')).toBeDefined();
  expect(state.mutate).not.toHaveBeenCalled();
  expect((screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement).disabled).toBe(false);
});

it('does not claim no agents are running when the read model fails', () => {
  state.failed = true;
  state.agents = [];
  render(<RunningAgentsView />);
  expect(screen.getByRole('alert').textContent).toContain('Failed to fetch running agents');
  expect(screen.queryByText('No agents currently running')).toBeNull();
  expect(screen.queryByText('No Running Agents')).toBeNull();
});
