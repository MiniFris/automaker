import { describe, expect, it, vi } from 'vitest';
import {
  ProviderSetupStatusService,
  type CliSetupProvider,
} from '../../../src/modules/providers/provider-setup-status.service.js';

function fixture(disconnected = false) {
  const adapter = {
    isInstalled: vi.fn().mockResolvedValue(true),
    getVersion: vi.fn().mockResolvedValue('1.2.3'),
    getCliPath: vi.fn().mockReturnValue('/fixture/cli'),
    checkAuth: vi.fn().mockResolvedValue({
      authenticated: true,
      method: 'oauth',
      hasApiKey: true,
      hasEnvApiKey: true,
      login: 'fixture-user',
      host: 'github.com',
    }),
    detectInstallation: vi
      .fn()
      .mockResolvedValue({ installed: true, authenticated: true, hasApiKey: true }),
  };
  const providers = { byName: vi.fn().mockReturnValue(adapter) };
  const connections = { isDisconnected: vi.fn().mockReturnValue(disconnected) };
  const configured = vi.fn().mockReturnValue(false);
  const service = new ProviderSetupStatusService(
    providers as never,
    connections as never,
    {
      providers: { isEnvironmentVariableConfigured: configured },
    } as never
  );
  return { service, adapter, providers, connections, configured };
}

const names: CliSetupProvider[] = ['gemini', 'copilot', 'cursor'];
describe('native provider setup status', () => {
  it('masks OpenCode credentials when disconnected without probing the adapter', async () => {
    const { service, providers, configured } = fixture(true);
    configured.mockReturnValue(true);
    expect((await service.installationStatus('opencode')).auth).toEqual({
      authenticated: false,
      method: 'none',
      hasApiKey: false,
      hasEnvApiKey: false,
      hasOAuthToken: false,
    });
    expect(providers.byName).not.toHaveBeenCalled();
  });
  it.each(names)(
    'uses the injected %s adapter and checks authentication exactly once',
    async (name) => {
      const { service, adapter, providers, connections } = fixture();
      expect(await service.status(name)).toMatchObject({
        success: true,
        installed: true,
        version: '1.2.3',
        path: '/fixture/cli',
        auth: { authenticated: true, method: 'oauth' },
      });
      expect(connections.isDisconnected).toHaveBeenCalledWith(name);
      expect(providers.byName).toHaveBeenCalledWith(name);
      expect(adapter.isInstalled).toHaveBeenCalledTimes(1);
      expect(adapter.getVersion).toHaveBeenCalledTimes(1);
      expect(adapter.checkAuth).toHaveBeenCalledTimes(1);
      expect(adapter.detectInstallation).not.toHaveBeenCalled();
    }
  );

  it('preserves Gemini key hints and install/login commands', async () => {
    const { service } = fixture();
    expect(await service.status('gemini')).toEqual({
      success: true,
      installed: true,
      version: '1.2.3',
      path: '/fixture/cli',
      auth: { authenticated: true, method: 'oauth', hasApiKey: true, hasEnvApiKey: true },
      installCommand: 'npm install -g @google/gemini-cli',
      loginCommand: 'gemini',
    });
  });

  it('preserves Copilot identity but does not expose unrelated auth metadata', async () => {
    const { service } = fixture();
    expect((await service.status('copilot')).auth).toEqual({
      authenticated: true,
      method: 'oauth',
      login: 'fixture-user',
      host: 'github.com',
    });
  });

  it('preserves the narrow Cursor auth response', async () => {
    const { service } = fixture();
    expect((await service.status('cursor')).auth).toEqual({ authenticated: true, method: 'oauth' });
  });

  it.each(['gemini', 'copilot'] as const)(
    'does not create or probe a disconnected %s adapter',
    async (name) => {
      const { service, adapter, providers } = fixture(true);
      expect(await service.status(name)).toMatchObject({
        installed: true,
        version: null,
        path: null,
        auth: { authenticated: false, method: 'none' },
      });
      expect(providers.byName).not.toHaveBeenCalled();
      expect(adapter.checkAuth).not.toHaveBeenCalled();
      if (name === 'gemini')
        expect((await service.status(name)).auth).toEqual({
          authenticated: false,
          method: 'none',
          hasApiKey: false,
        });
    }
  );

  it('still reports Cursor installation when disconnected, without checking auth', async () => {
    const { service, adapter } = fixture(true);
    expect(await service.status('cursor')).toMatchObject({
      installed: true,
      version: '1.2.3',
      path: '/fixture/cli',
      auth: { authenticated: false, method: 'none' },
    });
    expect(adapter.isInstalled).toHaveBeenCalledOnce();
    expect(adapter.checkAuth).not.toHaveBeenCalled();
  });

  it.each(names)(
    'normalizes a missing %s installation without inventing a path/version',
    async (name) => {
      const { service, adapter } = fixture();
      adapter.isInstalled.mockResolvedValue(false);
      adapter.getVersion.mockResolvedValue(null);
      adapter.checkAuth.mockResolvedValue({ authenticated: false, method: 'none' });
      expect(await service.status(name)).toMatchObject({
        installed: false,
        version: null,
        path: null,
        auth: { authenticated: false, method: 'none' },
      });
      expect(adapter.getCliPath).not.toHaveBeenCalled();
    }
  );

  it.each(names)('does not expose raw %s adapter errors', async (name) => {
    const { service, adapter } = fixture();
    adapter.checkAuth.mockRejectedValue(new Error('secret-token /private/credentials'));
    try {
      await service.status(name);
      expect.fail('Expected a safe HTTP exception');
    } catch (error) {
      expect(error).toMatchObject({
        response: { success: false, error: `Failed to read ${name} status.` },
        status: 500,
      });
      expect(JSON.stringify(error)).not.toContain('secret-token');
    }
  });

  it('does not expose raw auth error details on a successful response', async () => {
    const { service, adapter } = fixture();
    adapter.checkAuth.mockResolvedValue({
      authenticated: false,
      method: 'none',
      error: 'secret-token',
    });
    const response = await service.status('gemini');
    expect(response.auth).toMatchObject({ error: 'Provider authentication check failed.' });
    expect(JSON.stringify(response)).not.toContain('secret-token');
  });

  it.each([null, {}])(
    'fails closed for a missing or incompatible setup adapter (%s)',
    async (adapter) => {
      const { service, providers } = fixture();
      providers.byName.mockReturnValue(adapter as never);
      await expect(service.status('cursor')).rejects.toMatchObject({ status: 500 });
    }
  );

  it('observes disconnect/reconnect on every read rather than retaining stale status', async () => {
    const { service, connections, adapter } = fixture();
    expect((await service.status('gemini')).auth.authenticated).toBe(true);
    connections.isDisconnected.mockReturnValue(true);
    expect((await service.status('gemini')).auth.authenticated).toBe(false);
    connections.isDisconnected.mockReturnValue(false);
    expect((await service.status('gemini')).auth.authenticated).toBe(true);
    expect(adapter.checkAuth).toHaveBeenCalledTimes(2);
  });

  it.each(['codex', 'opencode'] as const)(
    'uses the injected %s installation detector once',
    async (name) => {
      const { service, adapter, providers } = fixture();
      expect(await service.installationStatus(name)).toMatchObject({
        success: true,
        installed: true,
        version: null,
        path: null,
        auth: { authenticated: true, method: 'api_key_env', hasApiKey: true },
      });
      expect(providers.byName).toHaveBeenCalledWith(name);
      expect(adapter.detectInstallation).toHaveBeenCalledOnce();
      expect(adapter.checkAuth).not.toHaveBeenCalled();
    }
  );

  it('does not probe disconnected Codex or claim its API key is usable', async () => {
    const { service, providers } = fixture(true);
    expect(await service.installationStatus('codex')).toEqual({
      success: true,
      installed: true,
      version: null,
      path: null,
      auth: { authenticated: false, method: 'none', hasApiKey: false },
      installCommand: 'npm install -g @openai/codex',
      loginCommand: 'codex login',
    });
    expect(providers.byName).not.toHaveBeenCalled();
  });

  it.each(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'])(
    'reads the OpenCode %s hint from application config',
    async (variable) => {
      const { service, configured } = fixture();
      configured.mockImplementation((name) => name === variable);
      expect((await service.installationStatus('opencode')).auth).toMatchObject({
        hasEnvApiKey: true,
        hasOAuthToken: false,
      });
      expect(configured).toHaveBeenCalledWith(variable);
    }
  );

  it.each([
    { authenticated: false, hasApiKey: true, method: 'none' },
    { authenticated: true, hasApiKey: false, method: 'cli_authenticated' },
  ])(
    'derives the Codex auth method from installation status: %s',
    async ({ authenticated, hasApiKey, method }) => {
      const { service, adapter } = fixture();
      adapter.detectInstallation.mockResolvedValue({ installed: true, authenticated, hasApiKey });
      expect((await service.installationStatus('codex')).auth).toEqual({
        authenticated,
        hasApiKey,
        method,
      });
    }
  );

  it('preserves OpenCode missing installation recommendation and OAuth hints', async () => {
    const { service, adapter } = fixture();
    adapter.detectInstallation.mockResolvedValue({
      installed: false,
      authenticated: false,
      hasOAuthToken: true,
    });
    expect(await service.installationStatus('opencode')).toEqual({
      success: true,
      installed: false,
      version: null,
      path: null,
      auth: {
        authenticated: false,
        method: 'none',
        hasApiKey: false,
        hasEnvApiKey: false,
        hasOAuthToken: true,
      },
      recommendation: 'Install OpenCode CLI to use multi-provider AI models.',
      installCommand: 'curl -fsSL https://opencode.ai/install | bash',
      loginCommand: 'opencode auth login',
      installCommands: {
        macos: 'curl -fsSL https://opencode.ai/install | bash',
        linux: 'curl -fsSL https://opencode.ai/install | bash',
        npm: 'npm install -g opencode-ai',
      },
    });
  });

  it.each(['codex', 'opencode'] as const)(
    'returns safe %s detection errors without command output',
    async (name) => {
      const { service, adapter } = fixture();
      adapter.detectInstallation.mockRejectedValue(new Error('private-cli-token'));
      await expect(service.installationStatus(name)).rejects.toMatchObject({
        status: 500,
        response: { success: false, error: `Failed to read ${name} status.` },
      });
    }
  );
});
