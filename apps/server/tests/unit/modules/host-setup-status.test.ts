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
    githubAuthentication: vi.fn().mockResolvedValue({ authenticated: true, user: 'fixture' }),
  };
  const connections = { isDisconnected: vi.fn(() => false) };
  const configured = vi.fn(() => false);
  const keys = new SetupCredentialCache();
  const service = new HostSetupStatusService(runtime as never, connections as never, keys, {
    providers: { isEnvironmentVariableConfigured: configured },
  } as never);
  return { service, runtime, connections, keys, configured };
}

describe('native host setup status', () => {
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
  ])('recognizes existing CLI evidence: %s', async ({ hasRecentActivity, ...indicators }) => {
    const { service, runtime } = fixture();
    runtime.claudeIndicators.mockResolvedValue(indicators);
    expect((await service.claude()).auth).toMatchObject({
      authenticated: true,
      method: 'cli_authenticated',
      hasCliAuth: true,
      hasRecentActivity,
    });
  });

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
  ])(
    'preserves credential priority: %s',
    async ({ method, oauthTokenValid, apiKeyValid, ...credentials }) => {
      const { service, runtime } = fixture();
      runtime.claudeIndicators.mockResolvedValue({
        hasStatsCacheWithActivity: true,
        hasCredentialsFile: true,
        credentials,
      });
      expect((await service.claude()).auth).toMatchObject({
        authenticated: true,
        hasCredentialsFile: true,
        hasCliAuth: true,
        method,
        oauthTokenValid,
        apiKeyValid,
      });
    }
  );

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
      apiKeyValid: true,
      hasStoredOAuthToken: true,
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
        authenticated: true,
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

  it('reports API-key booleans only and does not probe CLI/network', () => {
    const { service, keys, runtime } = fixture();
    keys.set('openai', 'private-openai');
    keys.set('google', 'private-google');
    expect(service.apiKeys()).toEqual({
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
      authenticated: true,
      user: 'fixture',
      version: expected,
      path: '/fixture/gh',
    });
    expect(runtime.githubAuthentication).toHaveBeenCalledWith('/fixture/gh');
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
