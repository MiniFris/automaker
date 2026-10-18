import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SSHEnvironmentProfile, SSHEnvironmentStatus } from '@automaker/types';
import { SSHEnvironmentSetup } from '@/components/shared/ssh-environment-setup';

const api = vi.hoisted(() => ({
  scanSSH: vi.fn(),
  trustSSH: vi.fn(),
  saveSSHKey: vi.fn(),
  clearSSHKey: vi.fn(),
  checkSSH: vi.fn(),
  prepareSSH: vi.fn(),
  prepareSSHProject: vi.fn(),
  recoverSSH: vi.fn(),
}));
vi.mock('@/lib/http-api-client', () => ({
  getHttpApiClient: () => ({ executionEnvironments: api }),
}));

describe('SSH connection setup', () => {
  let cache: QueryClient;
  const profile: SSHEnvironmentProfile = {
    id: 'remote',
    name: 'Remote',
    type: 'ssh',
    host: 'example.com',
    port: 22,
    username: 'developer',
    basePath: '/srv/projects',
    credentialId: 'key',
  };
  const fingerprint = 'SHA256:' + 'a'.repeat(43);
  beforeEach(() => {
    cache = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    for (const action of Object.values(api)) action.mockResolvedValue({ success: true });
    api.scanSSH.mockResolvedValue({
      success: true,
      hostKey: { algorithm: 'ssh-ed25519', fingerprint },
    });
  });
  afterEach(() => {
    cleanup();
    cache.clear();
  });
  function open(status?: SSHEnvironmentStatus, projectPath?: string, selected = profile) {
    return render(
      <QueryClientProvider client={cache}>
        <SSHEnvironmentSetup profile={selected} status={status} projectPath={projectPath} />
      </QueryClientProvider>
    );
  }
  const trusted: SSHEnvironmentStatus = {
    hasPrivateKey: true,
    agentAvailable: false,
    trustedHost: { algorithm: 'ssh-ed25519', fingerprint },
  };
  it('does not contact SSH or prepare anything on mount and requires independent fingerprint confirmation', async () => {
    open();
    for (const action of Object.values(api)) expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Prepare saved SSH worker' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect SSH host fingerprint' }));
    const confirm = await screen.findByRole('button', { name: 'Confirm SSH fingerprint' });
    expect(confirm).toBeDisabled();
    expect(api.trustSSH).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'I independently verified this SSH fingerprint' })
    );
    fireEvent.click(confirm);
    await waitFor(() => expect(api.trustSSH).toHaveBeenCalledWith('remote', fingerprint, false));
  });
  it('requires a separate acknowledgment before replacing a changed host key', async () => {
    open({
      ...trusted,
      trustedHost: { algorithm: 'ssh-ed25519', fingerprint: 'SHA256:' + 'b'.repeat(43) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Inspect SSH host fingerprint' }));
    const confirm = await screen.findByRole('button', { name: 'Confirm SSH fingerprint' });
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'I independently verified this SSH fingerprint' })
    );
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Replace the trusted host key/ }));
    fireEvent.click(confirm);
    await waitFor(() => expect(api.trustSSH).toHaveBeenCalledWith('remote', fingerprint, true));
  });
  it('sends private keys only through the credential endpoint and clears the transient form after saving', async () => {
    open(trusted);
    const key = screen.getByLabelText('SSH private key (server storage only)');
    const passphrase = screen.getByLabelText('SSH key passphrase (optional)');
    fireEvent.change(key, { target: { value: 'private-test-key' } });
    fireEvent.change(passphrase, { target: { value: 'passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save SSH private key' }));
    await waitFor(() =>
      expect(api.saveSSHKey).toHaveBeenCalledWith('remote', 'private-test-key', 'passphrase')
    );
    await waitFor(() => expect(key).toHaveValue(''));
    expect(passphrase).toHaveValue('');
    expect(JSON.stringify(window.localStorage)).not.toContain('private-test-key');
  });
  it('prepares only after explicit acceptance and sends an exact authoritative checkout source', async () => {
    open(trusted, '/local/project');
    const prepare = screen.getByRole('button', { name: 'Prepare authoritative SSH checkout' });
    expect(prepare).toBeDisabled();
    expect(api.prepareSSHProject).not.toHaveBeenCalled();
    expect(screen.getByText(/may include project secrets/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /I allow remote worker installation/ }));
    fireEvent.change(screen.getByLabelText('Initial remote checkout'), {
      target: { value: 'existing' },
    });
    fireEvent.change(screen.getByLabelText('Existing remote repository path'), {
      target: { value: '/srv/existing' },
    });
    fireEvent.click(prepare);
    await waitFor(() =>
      expect(api.prepareSSHProject).toHaveBeenCalledWith('remote', '/local/project', {
        method: 'existing',
        remotePath: '/srv/existing',
      })
    );
    expect(api.prepareSSH).not.toHaveBeenCalled();
  });
  it('surfaces unknown outcomes and requires acknowledgment before recovery without replay', async () => {
    open(
      { ...trusted, project: { remotePath: '/srv/repo', pendingOperations: 1 } },
      '/local/project'
    );
    expect(screen.getByRole('alert')).toHaveTextContent('does not replay or roll back commands');
    const recover = screen.getByRole('button', { name: 'Verify and acknowledge SSH recovery' });
    expect(recover).toBeDisabled();
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'I inspected the remote effects and acknowledge recovery',
      })
    );
    fireEvent.click(recover);
    await waitFor(() => expect(api.recoverSSH).toHaveBeenCalledWith('remote', '/local/project'));
    expect(api.prepareSSHProject).not.toHaveBeenCalled();
  });
  it('shows backend-agent availability without exposing a key form and keeps failure diagnostics visible', async () => {
    api.checkSSH.mockRejectedValue(new Error('SSH fingerprint changed; execution refused.'));
    open({ ...trusted, agentAvailable: true }, undefined, { ...profile, credentialId: undefined });
    expect(screen.getByText(/SSH_AUTH_SOCK/)).toHaveTextContent('available');
    expect(
      screen.queryByLabelText('SSH private key (server storage only)')
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check SSH connection and prerequisites' }));
    expect(
      await screen.findByText('SSH fingerprint changed; execution refused.')
    ).toBeInTheDocument();
  });
});
