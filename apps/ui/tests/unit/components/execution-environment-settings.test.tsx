import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionEnvironmentSettingsResponse } from '@automaker/types';
import { ExecutionEnvironmentSettings } from '@/components/shared/execution-environment-settings';

const api = vi.hoisted(() => ({
  inspect: vi.fn(),
  saveGlobal: vi.fn(),
  saveProject: vi.fn(),
  checkDocker: vi.fn(),
  confirmLocal: vi.fn(),
  revokeLocal: vi.fn(),
  prepareDocker: vi.fn(),
  confirmAutoFallback: vi.fn(),
  revokeAutoFallback: vi.fn(),
}));
vi.mock('@/lib/http-api-client', () => ({
  getHttpApiClient: () => ({ executionEnvironments: api }),
}));

describe('execution environment settings UI', () => {
  let client: QueryClient;
  let data: ExecutionEnvironmentSettingsResponse;
  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    data = {
      success: true,
      settings: {
        default: { mode: 'profile', profileId: 'docker' },
        profiles: [
          { id: 'docker', name: 'Project Docker', type: 'docker', context: 'default' },
          {
            id: 'ssh',
            name: 'Development server',
            type: 'ssh',
            host: 'dev.example.com',
            username: 'developer',
            port: 22,
            basePath: '/srv/projects',
          },
        ],
      },
      projectOverride: null,
      resolved: {
        selection: { mode: 'profile', profileId: 'docker' },
        source: 'global',
        type: 'docker',
        profile: { id: 'docker', name: 'Project Docker', type: 'docker', context: 'default' },
        runtimeIntegrated: false,
      },
    };
    api.inspect.mockImplementation(async () => data);
    api.confirmLocal.mockImplementation(async (projectPath?: string) => {
      data = {
        ...data,
        localConsent: {
          warningVersion: 1,
          confirmed: true,
          scope: projectPath ? 'project' : 'global',
          legacy: false,
          serverContainerized: false,
        },
        resolved: { ...data.resolved, runtimeIntegrated: true },
      };
      return data;
    });
    api.revokeLocal.mockImplementation(async () => {
      data = {
        ...data,
        localConsent: {
          warningVersion: 1,
          confirmed: false,
          scope: null,
          legacy: false,
          serverContainerized: false,
        },
        resolved: { ...data.resolved, runtimeIntegrated: false },
      };
      return data;
    });
    api.saveGlobal.mockImplementation(async (settings) => {
      data = { ...data, settings };
      return data;
    });
    api.saveProject.mockImplementation(async (_path, selection) => {
      data = { ...data, projectOverride: selection };
      return data;
    });
    api.checkDocker.mockResolvedValue({
      success: true,
      diagnostic: {
        status: 'permission-denied',
        checkedAt: new Date().toISOString(),
        scope: 'connection-only',
        containerLifecycle: 'not-tested',
        projectStorage: 'not-tested',
        platform: 'linux',
        serverContainerized: true,
        message: 'Automaker server cannot access Docker Engine.',
        remediation: ['Mount the daemon socket into the server and configure group_add.'],
        documentation: [],
      },
    });
  });
  afterEach(() => {
    cleanup();
    client.clear();
  });
  async function open(projectPath?: string) {
    render(
      <QueryClientProvider client={client}>
        <ExecutionEnvironmentSettings projectPath={projectPath} />
      </QueryClientProvider>
    );
    await screen.findByRole('heading', { name: 'Execution Environment' });
  }
  function localConfiguration() {
    data = {
      ...data,
      settings: { ...data.settings, default: { mode: 'local' } },
      resolved: {
        selection: { mode: 'local' },
        source: 'global',
        type: 'local',
        runtimeIntegrated: false,
      },
      localConsent: {
        warningVersion: 1,
        confirmed: false,
        scope: null,
        legacy: false,
        serverContainerized: false,
      },
    };
  }
  it('requires explicit risk acceptance before sending a server confirmation', async () => {
    localConfiguration();
    await open();
    expect(screen.getByRole('button', { name: 'Enable Local execution' })).toBeDisabled();
    expect(api.confirmLocal).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('checkbox', { name: /I understand and accept unrestricted Local/ })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Enable Local execution' }));
    await waitFor(() => expect(api.confirmLocal).toHaveBeenCalledWith(undefined));
    expect(await screen.findByText('Local access confirmed (global scope).')).toBeInTheDocument();
  });
  it('revokes the applicable consent via the server rather than a localStorage preference', async () => {
    localConfiguration();
    data.localConsent = { ...data.localConsent!, confirmed: true, scope: 'global' };
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke Local confirmation' }));
    await waitFor(() => expect(api.revokeLocal).toHaveBeenCalledWith(undefined));
    expect(await screen.findByRole('button', { name: 'Enable Local execution' })).toBeDisabled();
  });
  it.each([undefined, '/project-a'])(
    'restores saved Local confirmation after a full page remount for %s',
    async (projectPath) => {
      localConfiguration();
      await open(projectPath);
      fireEvent.click(
        screen.getByRole('checkbox', { name: /I understand and accept unrestricted Local/ })
      );
      fireEvent.click(screen.getByRole('button', { name: 'Enable Local execution' }));
      const label = `Local access confirmed (${projectPath ? 'project' : 'global'} scope).`;
      await screen.findByText(label);
      cleanup();
      client.clear();
      client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      await open(projectPath);
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Enable Local execution' })
      ).not.toBeInTheDocument();
      expect(api.confirmLocal).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole('button', { name: 'Revoke Local confirmation' }));
      await screen.findByRole('button', { name: 'Enable Local execution' });
      cleanup();
      client.clear();
      await open(projectPath);
      expect(screen.getByRole('button', { name: 'Enable Local execution' })).toBeDisabled();
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  );
  it('does not offer to revoke an inherited global consent only for one project', async () => {
    localConfiguration();
    data.localConsent = { ...data.localConsent!, confirmed: true, scope: 'global' };
    await open('/project-a');
    expect(
      screen.queryByRole('button', { name: 'Revoke Local confirmation' })
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Revoke it in Global Settings/)).toBeInTheDocument();
  });
  it('shows global profiles and makes supported runtimes explicit', async () => {
    await open();
    expect(screen.getByLabelText('Default execution environment')).toHaveValue('profile:docker');
    expect(screen.getByRole('note')).toHaveTextContent(
      'confirmed Local and managed per-project Docker'
    );
    expect(screen.getByLabelText('SSH host')).toHaveValue('dev.example.com');
    expect(api.checkDocker).not.toHaveBeenCalled();
    expect(api.prepareDocker).not.toHaveBeenCalled();
  });
  it('prepares only after explicit acceptance, targeting the saved project/profile', async () => {
    api.prepareDocker.mockResolvedValue({
      success: true,
      preparation: {
        connection: 'available',
        containerLifecycle: 'verified',
        projectStorage: 'verified',
        message: 'Project storage verified',
      },
    });
    await open('/project-a');
    const button = screen.getByRole('button', {
      name: 'Prepare and verify saved Docker environment',
    });
    expect(button).toBeDisabled();
    expect(api.prepareDocker).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Allow image download\/build/ }));
    fireEvent.click(button);
    await waitFor(() => expect(api.prepareDocker).toHaveBeenCalledWith('/project-a', 'docker'));
    expect(await screen.findByText('Project storage verified')).toBeInTheDocument();
  });
  it('surfaces preparation failure without claiming readiness or falling back', async () => {
    api.prepareDocker.mockResolvedValue({ success: false, error: 'Project storage is not shared' });
    await open();
    fireEvent.click(screen.getByRole('checkbox', { name: /Allow image download\/build/ }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Prepare and verify saved Docker environment' })
    );
    expect(await screen.findByText('Project storage is not shared')).toBeInTheDocument();
    expect(screen.queryByText(/Lifecycle: verified/)).not.toBeInTheDocument();
    expect(api.confirmLocal).not.toHaveBeenCalled();
  });
  it('retains the actionable server message when the HTTP client throws for a failed preparation', async () => {
    api.prepareDocker.mockRejectedValue(
      new Error('Docker storage mapping failed; configure a shared volume.')
    );
    await open();
    fireEvent.click(screen.getByRole('checkbox', { name: /Allow image download\/build/ }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Prepare and verify saved Docker environment' })
    );
    expect(
      await screen.findByText('Docker storage mapping failed; configure a shared volume.')
    ).toBeInTheDocument();
  });
  it('requires separate explicit acceptance of Auto Local fallback', async () => {
    data = {
      ...data,
      settings: { ...data.settings, default: { mode: 'auto' } },
      resolved: {
        selection: { mode: 'auto' },
        source: 'global',
        type: 'auto',
        runtimeIntegrated: true,
      },
    };
    api.confirmAutoFallback.mockImplementation(async () => {
      data = {
        ...data,
        localConsent: {
          warningVersion: 1,
          confirmed: false,
          scope: null,
          legacy: false,
          serverContainerized: false,
          autoFallbackConfirmed: true,
          autoFallbackScope: 'global',
        },
      };
      return data;
    });
    await open();
    const button = screen.getByRole('button', { name: 'Allow Auto Local fallback' });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /I accept full Local access if Docker/ }));
    fireEvent.click(button);
    await waitFor(() => expect(api.confirmAutoFallback).toHaveBeenCalledWith(undefined));
    expect(
      await screen.findByText(/Auto Local fallback confirmed \(global scope\)/)
    ).toBeInTheDocument();
    expect(api.confirmLocal).not.toHaveBeenCalled();
    expect(api.prepareDocker).not.toHaveBeenCalled();
  });
  it('saves a global default separately from provider and credential settings', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Default execution environment'), {
      target: { value: 'local' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save environment configuration' }));
    await waitFor(() =>
      expect(api.saveGlobal).toHaveBeenCalledWith({ ...data.settings, default: { mode: 'local' } })
    );
    expect(api.saveProject).not.toHaveBeenCalled();
  });
  it('adds and saves a Docker context without creating a container or requesting an image ID', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Add Docker profile' }));
    fireEvent.change(screen.getAllByLabelText('Profile name').at(-1)!, {
      target: { value: 'Second Docker' },
    });
    fireEvent.change(screen.getAllByLabelText('Docker context (optional)').at(-1)!, {
      target: { value: 'desktop-linux' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save environment configuration' }));
    await waitFor(() =>
      expect(api.saveGlobal).toHaveBeenCalledWith(
        expect.objectContaining({
          profiles: expect.arrayContaining([
            expect.objectContaining({
              type: 'docker',
              name: 'Second Docker',
              context: 'desktop-linux',
            }),
          ]),
        })
      )
    );
    expect(api.checkDocker).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/image ID/)).not.toBeInTheDocument();
  });
  it('supports an explicit project local override and resetting to inherit', async () => {
    await open('/project-a');
    const select = screen.getByLabelText('Project execution environment');
    expect(select).toHaveValue('inherit');
    expect(screen.getByText(/Saved selection:/)).toHaveTextContent(
      'Project Docker (global default)'
    );
    fireEvent.change(select, { target: { value: 'local' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save environment configuration' }));
    await waitFor(() =>
      expect(api.saveProject).toHaveBeenCalledWith('/project-a', { mode: 'local' })
    );
    await screen.findByText(
      /Environment configuration saved. Local requires explicit confirmation/
    );
    fireEvent.change(select, { target: { value: 'inherit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save environment configuration' }));
    await waitFor(() => expect(api.saveProject).toHaveBeenCalledWith('/project-a', null));
    expect(api.saveGlobal).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Add SSH profile' })).not.toBeInTheDocument();
  });
  it('selects a reusable SSH profile without connecting or requesting a private key', async () => {
    await open('/project-a');
    fireEvent.change(screen.getByLabelText('Project execution environment'), {
      target: { value: 'profile:ssh' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save environment configuration' }));
    await waitFor(() =>
      expect(api.saveProject).toHaveBeenCalledWith('/project-a', {
        mode: 'profile',
        profileId: 'ssh',
      })
    );
    expect(api.checkDocker).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/Private key/)).not.toBeInTheDocument();
  });
  it('shows Docker failure and remediation without claiming isolated readiness', async () => {
    await open('/project-a');
    fireEvent.click(screen.getByRole('button', { name: 'Check Docker access' }));
    expect(await screen.findByText('Docker connection: permission-denied')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('group_add');
    expect(screen.getByRole('status')).toHaveTextContent('Isolated execution is not enabled');
    expect(api.checkDocker).toHaveBeenCalledWith('docker');
  });
  it('checks access when a user explicitly selects a saved Docker environment', async () => {
    await open('/project-a');
    fireEvent.change(screen.getByLabelText('Project execution environment'), {
      target: { value: 'profile:docker' },
    });
    expect(await screen.findByText('Docker connection: permission-denied')).toBeInTheDocument();
    expect(api.checkDocker).toHaveBeenCalledWith('docker');
    expect(api.saveProject).not.toHaveBeenCalled();
  });
  it('does not turn successful docker info into container/storage readiness', async () => {
    const current = await api.checkDocker();
    api.checkDocker.mockResolvedValue({
      ...current,
      diagnostic: { ...current.diagnostic, status: 'available', message: 'Engine reachable.' },
    });
    await open('/project-a');
    fireEvent.click(screen.getByRole('button', { name: 'Check Docker access' }));
    expect(await screen.findByText('Docker connection: available')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Container lifecycle: not tested. Project storage: not tested.'
    );
  });
  it('keeps an orphaned project selection visible instead of showing Local', async () => {
    data = {
      ...data,
      projectOverride: { mode: 'profile', profileId: 'deleted' },
      resolved: {
        selection: { mode: 'profile', profileId: 'deleted' },
        source: 'project',
        type: 'missing-profile',
        runtimeIntegrated: false,
      },
    };
    await open('/project-a');
    expect(screen.getByRole('alert')).toHaveTextContent('There is no local fallback');
    expect(screen.getByLabelText('Project execution environment')).toHaveValue('profile:deleted');
  });
  it('requires confirmation before removing a profile', async () => {
    await open();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove profile' })[0]);
    expect(screen.getByRole('option', { name: 'Project Docker (Docker)' })).toBeInTheDocument();
  });
  it('displays server save failures without claiming a successful configuration', async () => {
    api.saveProject.mockResolvedValue({
      success: false,
      error: 'Selected environment profile does not exist.',
    });
    await open('/project-a');
    fireEvent.click(screen.getByRole('button', { name: 'Save environment configuration' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Selected environment profile does not exist.'
    );
  });
});
