import { render, screen, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { TestLogsPanel } from '@/components/ui/test-logs-panel';
const api = vi.hoisted(() => ({ logs: vi.fn(), write: vi.fn(), append: vi.fn() }));
vi.mock('@/hooks/use-test-logs', () => ({ useTestLogs: () => api.logs() }));
vi.mock('@/hooks/use-media-query', () => ({ useIsMobile: () => false }));
vi.mock('@/components/ui/xterm-log-viewer', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    XtermLogViewer: forwardRef(function Viewer(_props, ref) {
      useImperativeHandle(ref, () => ({ write: api.write, append: api.append }));
      return <div>Log viewer</div>;
    }),
  };
});
const state = () => ({
  logs: 'x'.repeat(50000),
  isLoading: false,
  error: null,
  status: 'running',
  sessionId: 'managed-test-one',
  command: 'npm test',
  testFile: null,
  startedAt: null,
  exitCode: null,
  duration: null,
  isRunning: true,
  fetchLogs: vi.fn(),
  executionEnvironment: { type: 'ssh', runtimeCwd: '/target/p' },
});
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
it('shows the actual backend/cwd and refreshes the viewer when 50K scrollback rolls over', () => {
  const snapshot = state();
  api.logs.mockReturnValue(snapshot);
  const panel = <TestLogsPanel open onClose={() => {}} worktreePath="/p" />;
  const { rerender } = render(panel);
  expect(screen.getByText('SSH · /target/p')).toBeInTheDocument();
  expect(api.write).toHaveBeenCalledWith(snapshot.logs);
  const next = snapshot.logs.slice(10) + 'FINAL_TAIL';
  api.logs.mockReturnValue({ ...snapshot, logs: next });
  rerender(<TestLogsPanel open onClose={() => {}} worktreePath="/p" />);
  expect(api.write).toHaveBeenLastCalledWith(next);
  expect(api.write).toHaveBeenCalledTimes(2);
});
it('appends a normal incremental tail without rewriting the entire viewer', () => {
  const snapshot = { ...state(), logs: 'START\n' };
  api.logs.mockReturnValue(snapshot);
  const { rerender } = render(<TestLogsPanel open onClose={() => {}} worktreePath="/p" />);
  api.logs.mockReturnValue({ ...snapshot, logs: 'START\nFINISH\n' });
  rerender(<TestLogsPanel open onClose={() => {}} worktreePath="/p" />);
  expect(api.append).toHaveBeenCalledWith('FINISH\n');
  expect(api.write).toHaveBeenCalledTimes(1);
});
