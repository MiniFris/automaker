import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { SourceEditorEnvironmentGate } from '@/components/shared/source-editor-environment-gate';
const api = vi.hoisted(() => ({ inspectGit: vi.fn(), mounted: vi.fn() }));
vi.mock('@/lib/http-api-client', () => ({
  getHttpApiClient: () => ({ executionEnvironments: { inspectGit: api.inspectGit } }),
}));
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
});
function Editor() {
  api.mounted();
  return <div>Controller editor mounted</div>;
}
function open() {
  return render(
    <QueryClientProvider client={client}>
      <SourceEditorEnvironmentGate path="/project">
        <Editor />
      </SourceEditorEnvironmentGate>
    </QueryClientProvider>
  );
}
it('does not mount controller readers/autosave while resolving a remote path', async () => {
  api.inspectGit.mockResolvedValue({
    success: true,
    executionEnvironment: { type: 'ssh', runtimeCwd: '/remote/project' },
  });
  open();
  expect(api.mounted).not.toHaveBeenCalled();
  expect(await screen.findByRole('alert')).toHaveTextContent('No local copy or autosave');
  expect(api.mounted).not.toHaveBeenCalled();
});
it('allows the existing editor for shared Docker files', async () => {
  api.inspectGit.mockResolvedValue({
    success: true,
    executionEnvironment: { type: 'docker', runtimeCwd: '/project' },
  });
  open();
  expect(await screen.findByText('Controller editor mounted')).toBeInTheDocument();
});
it('does not mount controller readers after a failed environment inspection', async () => {
  api.inspectGit.mockRejectedValue(new Error('Missing profile'));
  open();
  expect(await screen.findByRole('alert')).toHaveTextContent('not started');
  expect(api.mounted).not.toHaveBeenCalled();
});
