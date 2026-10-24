import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { HostSetupStatusService } from '../../../src/modules/providers/host-setup-status.service.js';
import { SetupCredentialCache } from '../../../src/modules/providers/setup-credential-cache.service.js';

function fixture() {
  const runtime = {
    platformInfo: vi.fn(() => ({ platform: 'linux', arch: 'arm64', homeDir: '/fixture/home' })),
    detect: vi
      .fn()
      .mockResolvedValue({ installed: true, version: '2.0', path: '/fixture/cli', method: 'path' }),
    claudeIndicators: vi.fn().mockResolvedValue({
      hasCredentialsFile: false,
      hasSettingsFile: false,
      hasStatsCacheWithActivity: false,
      hasProjectsSessions: false,
      credentials: null,
    }),
    profileHint: vi.fn().mockResolvedValue(false),
    githubAuthentication: vi.fn().mockResolvedValue({ authenticated: true, user: 'fixture' }),
  };
  const connections = { isDisconnected: vi.fn(() => false) };
  const configured = vi.fn(() => false);
  const keys = new SetupCredentialCache();
  const service = new HostSetupStatusService(
    runtime as never,
    connections as never,
    {
      presence: async () => ({
        hasAnthropicKey:
          !!keys.get('anthropic') ||
          keys.isEnvironmentConfigured('ANTHROPIC_API_KEY', configured('ANTHROPIC_API_KEY')),
        hasOpenaiKey:
          !!keys.get('openai') ||
          keys.isEnvironmentConfigured('OPENAI_API_KEY', configured('OPENAI_API_KEY')),
        hasGoogleKey: !!keys.get('google'),
        hasEnvOpenaiKey: configured('OPENAI_API_KEY'),
        hasStoredAnthropicKey: !!keys.get('anthropic'),
        hasStoredAnthropicOAuthToken: !!keys.get('anthropic_oauth_token'),
        hasEnvAnthropicKey: keys.isEnvironmentConfigured(
          'ANTHROPIC_API_KEY',
          configured('ANTHROPIC_API_KEY')
        ),
      }),
    } as never
  );
  return { service, runtime, connections, keys, configured };
}

describe('native host setup status', () => {
  it.each(['codex', 'opencode'] as const)(
    'reads passive %s installation and profile presence without a provider instance',
    async (name) => {
      const { service, runtime } = fixture();
      runtime.profileHint.mockResolvedValue(true);
      expect(await service.installationStatus(name)).toMatchObject({
        installed: true,
        auth: {
          authenticated: false,
          authenticationChecked: false,
          hasAuthFile: true,
          hasApiKey: false,
        },
      });
      expect(runtime.detect).toHaveBeenCalledExactlyOnceWith(name);
      expect(runtime.profileHint).toHaveBeenCalledExactlyOnceWith(name);
    }
  );
  it.each(['codex', 'opencode'] as const)(
    'does not inspect disconnected %s credentials or assert installation',
    async (name) => {
      const { service, runtime, connections } = fixture();
      connections.isDisconnected.mockReturnValue(true);
      runtime.detect.mockResolvedValue({ installed: false, method: 'none', version: '', path: '' });
      expect(await service.installationStatus(name)).toMatchObject({
        connected: false,
        installed: false,
        auth: {
          authenticated: false,
          authenticationChecked: false,
          hasApiKey: false,
          hasAuthFile: false,
        },
      });
      expect(runtime.profileHint).not.toHaveBeenCalled();
    }
  );
  it.each(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'])(
    'reports an application environment %s as a hint, not a verified credential',
    async (variable) => {
      const { service, configured } = fixture();
      configured.mockImplementation((name) => name === variable);
      expect((await service.installationStatus('opencode')).auth).toMatchObject({
        authenticationChecked: false,
        authenticated: false,
        hasEnvApiKey: true,
        hasApiKey: true,
        hasOAuthToken: false,
      });
    }
  );
  it('retains missing OpenCode installation guidance without parsing OAuth credentials', async () => {
    const { service, runtime } = fixture();
    runtime.detect.mockResolvedValue({ installed: false, method: 'none', version: '', path: '' });
    runtime.profileHint.mockResolvedValue(true);
    expect(await service.installationStatus('opencode')).toMatchObject({
      installed: false,
      recommendation: 'Install OpenCode CLI to use multi-provider AI models.',
      auth: {
        authenticated: false,
        authenticationChecked: false,
        hasAuthFile: true,
        hasOAuthToken: false,
      },
    });
  });
  it.each(['codex', 'opencode'] as const)(
    'redacts %s installation failure diagnostics',
    async (name) => {
      const { service, runtime } = fixture();
      runtime.detect.mockRejectedValue(new Error('private-cli-token'));
      await expect(service.installationStatus(name)).rejects.toMatchObject({
        status: 500,
        response: { success: false, error: 'Failed to read ' + name + ' status.' },
      });
    }
  );
  it.each(['linux', 'darwin', 'win32'])(
    'reports %s platform flags through the runtime port',
    (platform) => {
      const { service, runtime } = fixture();
      runtime.platformInfo.mockReturnValue({ platform, arch: 'arm64', homeDir: '/fixture/home' });
      expect(service.platform()).toEqual({
        success: true,
        platform,
        arch: 'arm64',
        homeDir: '/fixture/home',
        isLinux: platform === 'linux',
        isMac: platform === 'darwin',
        isWindows: platform === 'win32',
      });
    }
  );

  it('keeps the full Claude auth response shape without inventing credentials', async () => {
    const { service, runtime } = fixture();
    expect(await service.claude()).toEqual({
      success: true,
      status: 'installed',
      installed: true,
      method: 'path',
      version: '2.0',
      path: '/fixture/cli',
      auth: {
        authenticated: false,
        authenticationChecked: false,
        method: 'none',
        hasCredentialsFile: false,
        hasToken: false,
        hasStoredOAuthToken: false,
        hasStoredApiKey: false,
        hasEnvApiKey: false,
        oauthTokenValid: false,
        apiKeyValid: false,
        hasCliAuth: false,
        hasRecentActivity: false,
      },
    });
    expect(runtime.detect).toHaveBeenCalledExactlyOnceWith('claude');
  });

  it('preserves not-installed defaults and still reports local auth evidence', async () => {
    const { service, runtime } = fixture();
    runtime.detect.mockResolvedValue({ installed: false, method: 'none', version: '', path: '' });
    expect(await service.claude()).toMatchObject({
      status: 'not_installed',
      installed: false,
      version: '',
      path: '',
      auth: { authenticated: false },
    });
  });

  it('masks all Claude auth hints when disconnected and skips credential inspection', async () => {
    const { service, runtime, connections, keys, configured } = fixture();
    connections.isDisconnected.mockReturnValue(true);
    keys.set('anthropic', 'secret');
    keys.set('anthropic_oauth_token', 'oauth-secret');
    configured.mockReturnValue(true);
    const result = await service.claude();
    expect(result.auth).toEqual({
      authenticated: false,
      authenticationChecked: false,
      method: 'none',
      hasCredentialsFile: false,
      hasToken: false,
      hasStoredOAuthToken: false,
      hasStoredApiKey: false,
      hasEnvApiKey: false,
      oauthTokenValid: false,
      apiKeyValid: false,
      hasCliAuth: false,
      hasRecentActivity: false,
    });
    expect(result.installed).toBe(true);
    expect(runtime.claudeIndicators).not.toHaveBeenCalled();
  });

  it.each([
    { hasStatsCacheWithActivity: true, hasRecentActivity: true },
    { hasSettingsFile: true, hasProjectsSessions: true, hasRecentActivity: false },
  ])(
    'does not promote historical CLI evidence to verified authentication: %s',
    async ({ ...indicators }) => {
      const { service, runtime } = fixture();
      runtime.claudeIndicators.mockResolvedValue(indicators);
      expect((await service.claude()).auth).toMatchObject({
        authenticated: false,
        authenticationChecked: false,
        method: 'none',
        hasCliAuth: false,
        hasRecentActivity: false,
      });
    }
  );

  it.each([{ hasSettingsFile: true }, { hasProjectsSessions: true }])(
    'does not authenticate from incomplete CLI evidence: %s',
    async (indicators) => {
      const { service, runtime } = fixture();
      runtime.claudeIndicators.mockResolvedValue(indicators);
      expect((await service.claude()).auth.authenticated).toBe(false);
    }
  );

  it.each([
    {
      hasOAuthToken: true,
      hasApiKey: true,
      method: 'oauth_token',
      oauthTokenValid: true,
      apiKeyValid: false,
    },
    {
      hasOAuthToken: false,
      hasApiKey: true,
      method: 'api_key',
      oauthTokenValid: false,
      apiKeyValid: true,
    },
  ])('never inspects or validates credential file contents: %s', async ({ ...credentials }) => {
    const { service, runtime } = fixture();
    runtime.claudeIndicators.mockResolvedValue({
      hasStatsCacheWithActivity: true,
      hasCredentialsFile: true,
      credentials,
    });
    expect((await service.claude()).auth).toMatchObject({
      authenticated: false,
      authenticationChecked: false,
      hasCredentialsFile: true,
      hasCliAuth: false,
      method: 'none',
      oauthTokenValid: false,
      apiKeyValid: false,
    });
  });

  it('gives the configured environment key priority over credential file OAuth', async () => {
    const { service, runtime, configured } = fixture();
    configured.mockReturnValue(true);
    runtime.claudeIndicators.mockResolvedValue({
      hasCredentialsFile: true,
      credentials: { hasOAuthToken: true },
    });
    expect((await service.claude()).auth).toMatchObject({
      method: 'api_key_env',
      hasEnvApiKey: true,
      apiKeyValid: false,
      hasStoredOAuthToken: false,
    });
    expect(configured).toHaveBeenCalledWith('ANTHROPIC_API_KEY');
  });

  it.each(['anthropic', 'anthropic_oauth_token'])(
    'uses the injected wizard cache for %s',
    async (provider) => {
      const { service, keys } = fixture();
      keys.set(provider, 'private-fixture-key');
      const result = await service.claude();
      expect(result.auth).toMatchObject({
        authenticated: false,
        authenticationChecked: false,
        method: provider === 'anthropic' ? 'api_key' : 'oauth_token',
      });
      expect(JSON.stringify(result)).not.toContain('private-fixture-key');
    }
  );

  it('preserves app-owned store/delete environment effects without observing other apps', async () => {
    const first = fixture();
    const second = fixture();
    first.keys.set('anthropic', 'private-key');
    first.keys.setEnvironmentConfigured('ANTHROPIC_API_KEY', true);
    expect((await first.service.claude()).auth.method).toBe('api_key_env');
    expect((await second.service.claude()).auth.authenticated).toBe(false);
    first.keys.set('anthropic', '');
    first.keys.setEnvironmentConfigured('ANTHROPIC_API_KEY', false);
    first.configured.mockReturnValue(true);
    expect((await first.service.claude()).auth.authenticated).toBe(false);
  });

  it('reports API-key booleans only and does not probe CLI/network', async () => {
    const { service, keys, runtime } = fixture();
    keys.set('openai', 'private-openai');
    keys.set('google', 'private-google');
    expect(await service.apiKeys()).toEqual({
      success: true,
      hasAnthropicKey: false,
      hasGoogleKey: true,
      hasOpenaiKey: true,
    });
    expect(runtime.detect).not.toHaveBeenCalled();
  });

  it('supports arbitrary cache keys without object-prototype lookup', () => {
    const keys = new SetupCredentialCache();
    expect(keys.get('__proto__')).toBeUndefined();
    keys.set('__proto__', 'fixture');
    expect(keys.get('__proto__')).toBe('fixture');
    keys.set('__proto__', '');
    expect(keys.get('__proto__')).toBeUndefined();
  });

  it('does not perform GitHub auth when the CLI is missing', async () => {
    const { service, runtime } = fixture();
    runtime.detect.mockResolvedValue({ installed: false, path: '', version: '', method: 'none' });
    expect(await service.github()).toEqual({
      success: true,
      installed: false,
      authenticationChecked: false,
      authenticated: false,
      version: null,
      path: null,
      user: null,
    });
    expect(runtime.githubAuthentication).not.toHaveBeenCalled();
  });

  it.each([
    ['gh version 2.40.1 (date)', '2.40.1'],
    ['custom version\nother text', 'custom version'],
    ['', null],
  ])('formats GitHub version %s as %s', async (version, expected) => {
    const { service, runtime } = fixture();
    runtime.detect.mockResolvedValue({
      installed: true,
      version,
      path: '/fixture/gh',
      method: 'local',
    });
    expect(await service.github()).toEqual({
      success: true,
      installed: true,
      authenticationChecked: false,
      authenticated: false,
      user: null,
      version: expected,
      path: '/fixture/gh',
    });
    expect(runtime.githubAuthentication).not.toHaveBeenCalled();
  });

  it.each(['claude', 'github'] as const)(
    'returns safe %s failures rather than command output',
    async (method) => {
      const { service, runtime } = fixture();
      runtime.detect.mockRejectedValue(new Error('private-token /private/credentials'));
      await expect(service[method]()).rejects.toMatchObject({
        status: 500,
        response: { success: false },
      });
    }
  );

  it('retains runtime shutdown 503 instead of turning it into a generic 500', async () => {
    const { service, runtime } = fixture();
    runtime.detect.mockRejectedValue(new ServiceUnavailableException());
    await expect(service.claude()).rejects.toMatchObject({ status: 503 });
  });
});
