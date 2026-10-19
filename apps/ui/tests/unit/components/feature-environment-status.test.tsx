import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { FeatureEnvironmentStatus } from '@/components/shared/feature-environment-status';

const api = vi.hoisted(() => ({ inspectFeature: vi.fn(), mergeEnvironmentFeature: vi.fn() }));
vi.mock('@/lib/http-api-client', () => ({
  getHttpApiClient: () => ({
    executionEnvironments: { inspectFeature: api.inspectFeature },
    autoMode: { mergeEnvironmentFeature: api.mergeEnvironmentFeature },
  }),
}));
let cache: QueryClient;
beforeEach(() => {
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  api.inspectFeature.mockResolvedValue({
    success: true,
    selectedType: 'local',
    binding: {
      type: 'ssh',
      runtimeCwd: '/remote/feature',
      sshWorkspace: { branch: 'automaker/run-id', baseBranch: 'main' },
    },
  });
  api.mergeEnvironmentFeature.mockResolvedValue({ success: true });
});
afterEach(() => {
  cleanup();
  cache.clear();
});
function open(model = 'direct-model') {
  return render(
    <QueryClientProvider client={cache}>
      <FeatureEnvironmentStatus
        projectPath="/controller/project"
        featureId="feature"
        model={model}
      />
    </QueryClientProvider>
  );
}
it('shows the actual pinned runtime even when the default changed, without connecting or merging', async () => {
  open();
  const status = await screen.findByLabelText('Feature execution environment');
  expect(status).toHaveTextContent('ssh — pinned');
  expect(status).toHaveTextContent('/remote/feature');
  expect(status).toHaveTextContent('automaker/run-id');
  expect(status).toHaveTextContent('Local project files are not synchronized');
  expect(api.inspectFeature).toHaveBeenCalledWith('/controller/project', 'feature');
  expect(api.mergeEnvironmentFeature).not.toHaveBeenCalled();
});
it('requires explicit review acceptance before invoking remote merge and reports its result', async () => {
  open();
  const button = await screen.findByRole('button', {
    name: 'Merge remote feature (fast-forward only)',
  });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed the remote commits/ }));
  fireEvent.click(button);
  await waitFor(() =>
    expect(api.mergeEnvironmentFeature).toHaveBeenCalledWith('/controller/project', 'feature')
  );
  expect(await screen.findByRole('status')).toHaveTextContent('Nothing was pushed');
  expect(button).toBeDisabled();
});
it('keeps an actionable remote merge refusal visible and does not retry', async () => {
  api.mergeEnvironmentFeature.mockRejectedValue(
    new Error('Target diverged. Inspect remote history.')
  );
  open();
  const button = await screen.findByRole('button', {
    name: 'Merge remote feature (fast-forward only)',
  });
  fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed the remote commits/ }));
  fireEvent.click(button);
  expect(await screen.findByRole('status')).toHaveTextContent('Target diverged');
  expect(api.mergeEnvironmentFeature).toHaveBeenCalledTimes(1);
});
it('does not advertise a binding or merge before the first feature run', async () => {
  api.inspectFeature.mockResolvedValue({ success: true, selectedType: 'ssh', binding: null });
  open();
  expect(await screen.findByLabelText('Feature execution environment')).toHaveTextContent(
    'ssh — not started, no binding yet'
  );
  expect(screen.queryByRole('button', { name: /Merge remote/ })).not.toBeInTheDocument();
});
it('shows a supported CLI feature binding without opening a remote connection', async () => {
  open('cursor-auto');
  expect(await screen.findByLabelText('Feature execution environment')).toHaveTextContent(
    '/remote/feature'
  );
  expect(api.inspectFeature).toHaveBeenCalledWith('/controller/project', 'feature');
});
it('shows the actual environment binding for an SDK provider', async () => {
  open('sonnet');
  expect(await screen.findByLabelText('Feature execution environment')).toHaveTextContent(
    '/remote/feature'
  );
});
it('shows the Docker feature branch, shared storage boundary and explicit merge action', async () => {
  api.inspectFeature.mockResolvedValue({
    success: true,
    selectedType: 'local',
    binding: {
      type: 'docker',
      runtimeCwd: '/project/.worktrees/feature',
      featureWorkspace: { branch: 'automaker/feature-abc', baseBranch: 'main' },
    },
  });
  open('codex-mini');
  const status = await screen.findByLabelText('Feature execution environment');
  expect(status).toHaveTextContent('docker — pinned');
  expect(status).toHaveTextContent('automaker/feature-abc');
  expect(status).toHaveTextContent('commands run inside the container');
  expect(screen.getByRole('button', { name: /Merge remote/ })).toBeDisabled();
  expect(api.mergeEnvironmentFeature).not.toHaveBeenCalled();
});
it('does not carry merge acceptance over to another pinned workspace', async () => {
  open();
  const checkbox = await screen.findByRole('checkbox', { name: /I reviewed/ });
  fireEvent.click(checkbox);
  expect(screen.getByRole('button', { name: /Merge remote/ })).toBeEnabled();
  cache.setQueryData(['feature-environment', '/controller/project', 'feature'], {
    success: true,
    selectedType: 'docker',
    binding: {
      type: 'docker',
      id: 'new-binding',
      runtimeCwd: '/different/worktree',
      featureWorkspace: { branch: 'automaker/new', baseBranch: 'main' },
    },
  });
  await waitFor(() => expect(screen.getByRole('button', { name: /Merge remote/ })).toBeDisabled());
  expect(checkbox).not.toBeChecked();
  expect(api.mergeEnvironmentFeature).not.toHaveBeenCalled();
});
