import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RemoteProviderSetup } from '@/components/shared/remote-provider-setup';

const api = vi.hoisted(() => ({
  inspectProvider: vi.fn(),
  installProvider: vi.fn(),
  saveProviderKey: vi.fn(),
  clearProviderKey: vi.fn(),
}));
vi.mock('@/lib/http-api-client', () => ({
  getHttpApiClient: () => ({ executionEnvironments: api }),
}));
const status = {
  provider: 'claude',
  targetId: 'target',
  environment: 'ssh',
  cwd: '/remote/project',
  root: '/home/remote/sdk',
  packageVersion: '0.2.32',
  installed: false,
  hasStoredKey: false,
  credentialSource: 'not-detected',
  authentication: 'not-detected',
};
beforeEach(() => {
  vi.clearAllMocks();
  api.inspectProvider.mockResolvedValue({ success: true, status });
  api.installProvider.mockResolvedValue({ success: true, status: { ...status, installed: true } });
  api.saveProviderKey.mockResolvedValue({
    success: true,
    status: {
      ...status,
      installed: true,
      hasStoredKey: true,
      credentialSource: 'managed-key',
      authentication: 'configured-unverified',
    },
  });
});
afterEach(cleanup);
it('does not connect or install on mount and shows an explicit inspection action', () => {
  render(<RemoteProviderSetup projectPath="/project" />);
  expect(api.inspectProvider).not.toHaveBeenCalled();
  expect(api.installProvider).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Inspect saved provider target' })).toBeEnabled();
});
async function inspect() {
  fireEvent.click(screen.getByRole('button', { name: 'Inspect saved provider target' }));
  await screen.findByText(/SDK 0.2.32/);
}
it('requires target consent before installing and passes the inspected identity', async () => {
  render(<RemoteProviderSetup projectPath="/project" />);
  await inspect();
  const button = screen.getByRole('button', { name: 'Install pinned SDK on target' });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(button);
  await waitFor(() =>
    expect(api.installProvider).toHaveBeenCalledWith('/project', 'claude', 'target')
  );
  expect(await screen.findByText('SDK 0.2.32: installed.')).toBeInTheDocument();
});
it('saves a separate target secret, clears the password field and does not call it verified', async () => {
  api.inspectProvider.mockResolvedValue({ success: true, status: { ...status, installed: true } });
  render(<RemoteProviderSetup projectPath="/project" />);
  await inspect();
  fireEvent.click(screen.getByRole('checkbox'));
  const input = screen.getByLabelText('Target API key / Copilot token');
  fireEvent.change(input, { target: { value: 'target-test-token' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save key on target' }));
  await waitFor(() =>
    expect(api.saveProviderKey).toHaveBeenCalledWith(
      '/project',
      'claude',
      'target',
      'target-test-token'
    )
  );
  await waitFor(() => expect(input).toHaveValue(''));
  expect(
    screen.getByText(/Credentials: managed-key; authentication: configured-unverified/)
  ).toBeInTheDocument();
});
it('resets consent/status/key when the provider changes', async () => {
  api.inspectProvider.mockResolvedValue({ success: true, status: { ...status, installed: true } });
  render(<RemoteProviderSetup projectPath="/project" />);
  await inspect();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Target API key / Copilot token'), {
    target: { value: 'target-test-token' },
  });
  fireEvent.change(screen.getByLabelText('SDK provider'), { target: { value: 'codex' } });
  expect(screen.queryByLabelText('Target API key / Copilot token')).not.toBeInTheDocument();
  expect(api.saveProviderKey).not.toHaveBeenCalled();
});
it('shows failures and never silently attempts Local or a second installation', async () => {
  api.inspectProvider.mockRejectedValue(new Error('Prepare saved Docker project first.'));
  render(<RemoteProviderSetup projectPath="/project" />);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect saved provider target' }));
  expect(await screen.findByText('Prepare saved Docker project first.')).toBeInTheDocument();
  expect(api.installProvider).not.toHaveBeenCalled();
});
