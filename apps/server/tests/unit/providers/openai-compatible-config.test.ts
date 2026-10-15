import { describe, expect, it } from 'vitest';
import { toDirectModelId, type OpenAICompatibleEndpoint } from '@automaker/types';
import {
  DEFAULT_DIRECT_MAX_RETRIES,
  DEFAULT_DIRECT_TIMEOUT_MS,
  normalizeOpenAICompatibleBaseUrl,
  parseOpenAICompatibleEndpoint,
  parseOpenAICompatibleEndpoints,
  resolveOpenAICompatibleConnection,
} from '@/providers/openai-compatible/config.js';

function endpoint(overrides: Partial<OpenAICompatibleEndpoint> = {}): OpenAICompatibleEndpoint {
  return {
    id: 'local',
    name: 'Local endpoint',
    enabled: true,
    baseUrl: 'http://localhost:8000/v1',
    protocol: 'chat-completions',
    auth: { type: 'none' },
    models: [
      {
        id: 'Qwen/Qwen3-Coder:latest',
        displayName: 'Coder',
        capabilities: { tools: true, streaming: true },
      },
    ],
    ...overrides,
  };
}

function resolve(
  config = endpoint(),
  overrides: Partial<Parameters<typeof resolveOpenAICompatibleConnection>[0]> = {}
) {
  return resolveOpenAICompatibleConnection({
    endpoints: [config],
    providerId: config.id,
    model: toDirectModelId(config.models[0].id),
    env: {},
    ...overrides,
  });
}

describe('OpenAI-compatible endpoint configuration', () => {
  it('validates endpoint collections and rejects duplicate endpoint IDs', () => {
    expect(parseOpenAICompatibleEndpoints([])).toEqual([]);
    expect(parseOpenAICompatibleEndpoints([endpoint()])).toHaveLength(1);
    expect(() => parseOpenAICompatibleEndpoints(null)).toThrow('endpoints');
    expect(() => parseOpenAICompatibleEndpoints([endpoint(), endpoint()])).toThrow(
      'endpoints (duplicate IDs)'
    );
  });

  it.each([
    ['http://localhost:8000/v1', 'http://localhost:8000/v1/'],
    ['http://127.0.0.1:1234/', 'http://127.0.0.1:1234/'],
    ['http://192.168.1.5:8080/api', 'http://192.168.1.5:8080/api/'],
    ['https://example.test/custom/v1/', 'https://example.test/custom/v1/'],
    ['https://example.test', 'https://example.test/'],
  ])('normalizes %s without guessing an API prefix', (url, normalized) => {
    expect(normalizeOpenAICompatibleBaseUrl(url)).toBe(normalized);
  });

  it.each([
    'not-a-url',
    'ftp://example.test/v1',
    'https://user:secret@example.test/v1',
    'https://example.test/v1?key=secret',
    'https://example.test/v1#secret',
    ' https://example.test/v1',
    'https://example.test/\nsecret',
  ])('rejects unsafe or ambiguous URL without echoing its value (%#)', (baseUrl) => {
    expect(() => normalizeOpenAICompatibleBaseUrl(baseUrl)).toThrow(
      /^Invalid OpenAI-compatible configuration: baseUrl\.$/
    );
  });

  it('parses a detached secret-free config with deterministic defaults', () => {
    const input = endpoint();
    const parsed = parseOpenAICompatibleEndpoint(input);
    expect(parsed).toEqual({
      ...input,
      baseUrl: 'http://localhost:8000/v1/',
      timeoutMs: DEFAULT_DIRECT_TIMEOUT_MS,
      maxRetries: DEFAULT_DIRECT_MAX_RETRIES,
    });
    parsed.models[0].capabilities.tools = false;
    expect(input.models[0].capabilities.tools).toBe(true);
    expect(input.baseUrl).toBe('http://localhost:8000/v1');
  });

  it('accepts explicit Responses configuration and a discoverable empty catalog', () => {
    expect(
      parseOpenAICompatibleEndpoint(endpoint({ protocol: 'responses', models: [] }))
    ).toMatchObject({ protocol: 'responses', models: [] });
  });

  it.each([
    { enabled: 'true' },
    { protocol: 'auto' },
    { timeoutMs: 0 },
    { timeoutMs: 2_147_483_648 },
    { timeoutMs: 1.5 },
    { maxRetries: -1 },
    { maxRetries: 6 },
    { models: null },
    { models: [{ id: 'm', displayName: 'm', capabilities: { tools: 'true', streaming: true } }] },
    { models: [{ id: 'm', displayName: 'm', capabilities: { tools: true } }] },
    {
      models: [
        {
          id: 'm',
          displayName: 'm',
          capabilities: { tools: true, streaming: true },
          contextWindow: -1,
        },
      ],
    },
    { auth: { type: 'env', variableName: 'invalid-name' } },
    { auth: { type: 'none', apiKey: 'secret' } },
    { apiKey: 'secret' },
    { headers: { Authorization: 'secret' } },
  ])('rejects invalid schema or inline credentials (%#)', (overrides) => {
    expect(() => parseOpenAICompatibleEndpoint({ ...endpoint(), ...overrides })).toThrow(
      /^Invalid OpenAI-compatible configuration:/
    );
  });

  it('rejects duplicate model IDs', () => {
    const config = endpoint();
    config.models.push({ ...config.models[0] });
    expect(() => parseOpenAICompatibleEndpoint(config)).toThrow('models (duplicate IDs)');
  });

  it('resolves a no-auth connection without inventing a default key', () => {
    const connection = resolve();
    expect(connection).toMatchObject({
      endpointId: 'local',
      baseUrl: 'http://localhost:8000/v1/',
      model: { id: 'Qwen/Qwen3-Coder:latest' },
      timeoutMs: DEFAULT_DIRECT_TIMEOUT_MS,
      maxRetries: DEFAULT_DIRECT_MAX_RETRIES,
    });
    expect(connection).not.toHaveProperty('apiKey');
  });

  it('selects the exact endpoint when two endpoints serve the same model', () => {
    const local = endpoint();
    const remote = endpoint({ id: 'remote', baseUrl: 'https://example.test/api', maxRetries: 0 });
    const connection = resolve(local, { endpoints: [local, remote], providerId: 'remote' });
    expect(connection.endpointId).toBe('remote');
    expect(connection.baseUrl).toBe('https://example.test/api/');
    expect(connection.maxRetries).toBe(0);
  });

  it.each(['claude-custom', 'gemini-pro', 'gpt-5.2', 'direct-model', 'Vendor/Model:Latest'])(
    'preserves API model %s, stripping exactly one prefix',
    (id) => {
      const config = endpoint();
      config.models[0].id = id;
      expect(resolve(config).model.id).toBe(id);
    }
  );

  it('does not match model IDs case-insensitively or accept bare model IDs', () => {
    expect(() => resolve(endpoint(), { model: 'direct-qwen/qwen3-coder:latest' })).toThrow(
      'model (not configured'
    );
    expect(() => resolve(endpoint(), { model: 'Qwen/Qwen3-Coder:latest' })).toThrow(
      'direct- prefix required'
    );
  });

  it('rejects missing, ambiguous or disabled endpoints and unknown models', () => {
    expect(() => resolve(endpoint(), { endpoints: undefined })).toThrow(
      'missing or duplicate endpoint'
    );
    expect(() => resolve(endpoint(), { providerId: 'unknown' })).toThrow(
      'missing or duplicate endpoint'
    );
    const config = endpoint();
    expect(() => resolve(config, { endpoints: [config, config] })).toThrow(
      'missing or duplicate endpoint'
    );
    expect(() => resolve(endpoint({ enabled: false }))).toThrow('endpoint disabled');
    expect(() => resolve(config, { model: 'direct-unknown' })).toThrow('model (not configured');
  });

  it('resolves only the named environment key without changing the environment', () => {
    const env = Object.freeze({ LOCAL_API_KEY: 'local-secret', OPENAI_API_KEY: 'other-secret' });
    const config = endpoint({ auth: { type: 'env', variableName: 'LOCAL_API_KEY' } });
    const before = { ...process.env };
    expect(resolve(config, { env }).apiKey).toBe('local-secret');
    expect(process.env).toEqual(before);
    expect(() => resolve(config, { env: { OPENAI_API_KEY: 'other-secret' } })).toThrow(
      'auth (configured secret missing'
    );
  });

  it('resolves the referenced credential without using legacy global OpenAI credentials', () => {
    const config = endpoint({ auth: { type: 'credentials', credentialId: 'remote-key' } });
    expect(
      resolve(config, {
        credentials: {
          openaiCompatibleApiKeys: { 'remote-key': 'remote-secret', other: 'other-secret' },
        },
      }).apiKey
    ).toBe('remote-secret');
    expect(() => resolve(config, { env: { OPENAI_API_KEY: 'fallback-secret' } })).toThrow(
      'auth (configured secret missing'
    );
    expect(JSON.stringify(parseOpenAICompatibleEndpoint(config))).not.toContain('remote-secret');
  });

  it.each(['', '   ', 'secret\r\ninjected', 'secret\u0000injected'])(
    'rejects empty or invalid secrets without exposing them (%#)',
    (secret) => {
      const config = endpoint({ auth: { type: 'env', variableName: 'LOCAL_API_KEY' } });
      expect(() => resolve(config, { env: { LOCAL_API_KEY: secret } })).toThrow(
        /^Invalid OpenAI-compatible configuration: auth \(configured secret missing or invalid\)\.$/
      );
    }
  );

  it('does not resolve inherited object properties as secrets', () => {
    const config = endpoint({ auth: { type: 'credentials', credentialId: 'toString' } });
    expect(() =>
      resolve(config, {
        credentials: { openaiCompatibleApiKeys: Object.create({ toString: 'inherited-secret' }) },
      })
    ).toThrow('auth (configured secret missing');
  });
});
