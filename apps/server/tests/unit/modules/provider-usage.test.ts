import { describe, expect, it, vi } from 'vitest';

import { ProviderUsageService } from '../../../src/modules/providers/provider-usage.service.js';

const fixture = () => {
  const claude = {
    isAvailable: vi.fn().mockResolvedValue(true),
    fetchUsageData: vi.fn().mockResolvedValue({ usedPercent: 10 }),
  };
  const codex = {
    isAvailable: vi.fn().mockResolvedValue(true),
    fetchUsageData: vi.fn().mockResolvedValue({ usedPercent: 20 }),
  };
  const codexModels = {
    getModelsWithMetadata: vi.fn().mockResolvedValue({ models: [], cachedAt: null }),
  };
  const gemini = { fetchUsageData: vi.fn().mockResolvedValue({ authenticated: true }) };
  const zai = {
    setApiToken: vi.fn(),
    getApiToken: vi.fn().mockReturnValue(null),
    isAvailable: vi.fn().mockReturnValue(false),
    fetchUsageData: vi.fn(),
    configure: vi.fn().mockResolvedValue({ success: true }),
    verifyApiKey: vi.fn().mockResolvedValue({ success: true }),
  };
  const settings = {
    getCredentials: vi.fn().mockResolvedValue({ apiKeys: { zai: 'stored-key' } }),
  };
  const discovery = { statuses: vi.fn().mockResolvedValue({ gemini: { installed: true } }) };
  const config = {
    providers: { isEnvironmentVariableConfigured: vi.fn().mockReturnValue(false) },
  };
  const service = new ProviderUsageService(
    claude as never,
    codex as never,
    codexModels as never,
    gemini as never,
    zai as never,
    settings as never,
    discovery as never,
    config as never
  );
  return { service, claude, codex, codexModels, gemini, zai, settings, config };
};

describe('ProviderUsageService', () => {
  it.each([
    'claudeUsage',
    'codexUsage',
    'codexModelCatalog',
    'geminiUsage',
    'zaiUsage',
    'zaiConfigure',
    'zaiVerify',
  ] as const)('does not expose upstream exception text from %s', async (method) => {
    const f = fixture();
    const failure = new Error('PRIVATE_TOKEN_AND_PATH_SENTINEL');
    f.claude.fetchUsageData.mockRejectedValue(failure);
    f.codex.fetchUsageData.mockRejectedValue(failure);
    f.codexModels.getModelsWithMetadata.mockRejectedValue(failure);
    f.gemini.fetchUsageData.mockRejectedValue(failure);
    f.zai.isAvailable.mockReturnValue(true);
    f.zai.fetchUsageData.mockRejectedValue(failure);
    f.zai.configure.mockRejectedValue(failure);
    f.zai.verifyApiKey.mockRejectedValue(failure);
    const result =
      method === 'codexModelCatalog'
        ? await f.service.codexModelCatalog(true)
        : method === 'zaiConfigure'
          ? await f.service.zaiConfigure({ apiToken: 'fixture' })
          : method === 'zaiVerify'
            ? await f.service.zaiVerify({ apiKey: 'fixture' })
            : await f.service[method]();
    expect(JSON.stringify(result)).not.toContain('PRIVATE_TOKEN_AND_PATH_SENTINEL');
    expect(result.body).toHaveProperty('error');
  });
  it('loads the stored z.ai token during Nest lifecycle initialization', async () => {
    const { service, zai } = fixture();
    await service.onModuleInit();
    expect(zai.setApiToken).toHaveBeenCalledWith('stored-key');
  });

  it('keeps provider authentication failures out of Automaker 401/403 semantics', async () => {
    const { service, claude } = fixture();
    claude.fetchUsageData.mockRejectedValue(new Error('Authentication required: token_expired'));
    await expect(service.claudeUsage()).resolves.toEqual({
      status: 200,
      body: {
        error: 'Authentication required',
        message: "Please run 'claude login' to authenticate",
      },
    });
  });

  it('returns the established 503 contract for an unavailable Codex catalog', async () => {
    const { service, codexModels } = fixture();
    codexModels.getModelsWithMetadata.mockResolvedValue({ models: [], cachedAt: 'now' });
    await expect(service.codexModelCatalog(true)).resolves.toMatchObject({
      status: 503,
      body: { success: false, error: 'Codex CLI not available or not authenticated' },
    });
    expect(codexModels.getModelsWithMetadata).toHaveBeenCalledWith(true);
  });

  it('reports environment-backed z.ai configuration without reading process.env', () => {
    const { service, config } = fixture();
    expect(service.zaiStatus()).toMatchObject({
      status: 200,
      body: { available: false, hasEnvApiKey: false },
    });
    expect(config.providers.isEnvironmentVariableConfigured).toHaveBeenCalledWith('Z_AI_API_KEY');
  });
});
