import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { GitEnvironmentStatus } from '@/components/shared/git-environment-status';
const api = vi.hoisted(() => ({ inspectGit: vi.fn() }));
vi.mock('@/lib/http-api-client', () => ({
  getHttpApiClient: () => ({ executionEnvironments: api }),
}));
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.inspectGit.mockResolvedValue({
    success: true,
    executionEnvironment: {
      type: 'ssh',
      runtimeCwd: '/remote/source/.worktrees/task',
      pinned: true,
    },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});
function open() {
  return render(
    <QueryClientProvider client={client}>
      <GitEnvironmentStatus path="/controller/project/.worktrees/task" />
    </QueryClientProvider>
  );
}
it('shows the actual pinned runtime and explains virtual paths/unsupported actions', async () => {
  open();
  const status = await screen.findByLabelText('Git execution environment');
  expect(status).toHaveTextContent('ssh — pinned workspace');
  expect(status).toHaveTextContent('/remote/source/.worktrees/task');
  expect(status).toHaveTextContent('controller aliases');
  expect(status).toHaveTextContent('no automatic fetch');
  expect(api.inspectGit).toHaveBeenCalledWith('/controller/project/.worktrees/task');
});
it('does not describe an unavailable target as an empty/local repository', async () => {
  api.inspectGit.mockResolvedValue({ success: false, error: 'Prepare SSH checkout' });
  open();
  expect(await screen.findByRole('alert')).toHaveTextContent('Prepare SSH checkout');
  expect(screen.queryByLabelText('Git execution environment')).not.toBeInTheDocument();
});
it('keeps legacy Local labelled as the server environment', async () => {
  api.inspectGit.mockResolvedValue({
    success: true,
    executionEnvironment: { type: 'local', runtimeCwd: '/server/project', pinned: false },
  });
  open();
  expect(await screen.findByLabelText('Git execution environment')).toHaveTextContent('Git: local');
});
