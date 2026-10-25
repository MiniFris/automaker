import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { SetupStatusRuntime } from '../../src/core/platform/setup-status.runtime.js';
import { EVENT_BUS, type EventBus } from '../../src/core/eventing/index.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { ClaudeUsageService } from '../../src/services/claude-usage-service.js';
import { CodexUsageService } from '../../src/services/codex-usage-service.js';
import { GeminiUsageService } from '../../src/services/gemini-usage-service.js';
import { ZaiUsageService } from '../../src/services/zai-usage-service.js';
import { CodexModelCacheService } from '../../src/services/codex-model-cache-service.js';
import { MockProvider } from '../helpers/mock-provider.js';

it('uses native passive discovery and refuses expired Gemini OAuth without provider factories, refresh or vendor writes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-passive-discovery-'));
  const credential = path.join(directory, '.gemini', 'oauth_creds.json');
  await mkdir(path.dirname(credential));
  const content = JSON.stringify({
    access_token: 'expired-offline',
    refresh_token: 'no-refresh',
    expiry_date: Date.now() - 1,
  });
  await writeFile(credential, content);
  const create = vi.fn((name: string) => new MockProvider(name));
  const runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: directory,
    dataDir: path.join(directory, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    environment: {
      NODE_ENV: 'test',
      HOME: directory,
      AUTOMAKER_API_KEY: 'fixture',
      ENABLE_REQUEST_LOGGING: 'false',
    },
    providerRegistrations: ['claude', 'cursor', 'codex', 'opencode', 'gemini', 'copilot'].map(
      (name) => ({ name, create: () => create(name) })
    ),
  });
  const fetchOriginal = globalThis.fetch;
  try {
    const detect = vi
      .spyOn(runtime.app.get(SetupStatusRuntime), 'detect')
      .mockImplementation(async (name) => ({
        installed: true,
        version: `owned-${name}`,
        path: path.join(directory, name),
        method: 'path',
      }));
    await runtime.start();
    create.mockClear();
    const { port } = runtime.app.getHttpServer().address() as AddressInfo;
    const origin = `http://127.0.0.1:${port}`;
    const network = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.origin !== origin) throw new Error('Vendor network forbidden in fixture');
      return fetchOriginal(input, init);
    });
    vi.stubGlobal('fetch', network);
    const request = async (route: string) => {
      const response = await fetch(`${origin}/api/${route}`, {
        headers: { 'x-api-key': 'fixture' },
      });
      expect(response.status).toBe(200);
      return response.json();
    };
    expect(await request('models/providers')).toMatchObject({
      providers: {
        anthropic: { available: true },
        cursor: {
          available: true,
          version: 'owned-cursor-agent',
          authenticated: false,
          authenticationChecked: false,
        },
      },
    });
    expect(await request('gemini/status')).toMatchObject({
      installed: true,
      version: 'owned-gemini',
      authenticated: false,
      authenticationChecked: false,
    });
    expect(await request('gemini/usage')).toMatchObject({
      authenticated: false,
      error: expect.stringContaining('gemini auth login'),
    });
    expect(create).not.toHaveBeenCalled();
    expect(detect).toHaveBeenCalledWith('cursor-agent');
    expect(network).toHaveBeenCalledTimes(3);
    expect(await readFile(credential, 'utf8')).toBe(content);
  } finally {
    vi.unstubAllGlobals();
    await runtime.app.close();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  }
});

it('commits ZAI credentials before activation, publishes only owned events, and redacts native usage errors', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-usage-policy-'));
  const runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: directory,
    dataDir: path.join(directory, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      NODE_ENV: 'test',
      HOME: directory,
      AUTOMAKER_API_KEY: 'fixture',
      ENABLE_REQUEST_LOGGING: 'false',
    },
  });
  try {
    await runtime.start();
    const { port } = runtime.app.getHttpServer().address() as AddressInfo;
    const request = async (route: string, body?: object, status = 200) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/${route}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'x-api-key': 'fixture', 'Content-Type': 'application/json' },
        ...(body && { body: JSON.stringify(body) }),
      });
      const result = await response.json();
      expect(response.status, JSON.stringify(result)).toBe(status);
      return result;
    };
    const settings = runtime.app.get(SettingsService),
      zai = runtime.app.get(ZaiUsageService);
    const events: unknown[] = [];
    runtime.app
      .get<EventBus>(EVENT_BUS)
      .subscribe('notification:created', (event) => events.push(event));
    await request('zai/configure', { apiToken: 'committed-offline' });
    expect(zai.getApiToken()).toBe('committed-offline');
    expect((await settings.getCredentials()).apiKeys.zai).toBe('committed-offline');
    await request('zai/configure', { apiToken: 'comm...line' });
    expect(zai.getApiToken()).toBe('committed-offline');
    expect(events).toContainEqual(
      expect.objectContaining({ id: expect.any(String), type: 'zai.configured' })
    );
    events.length = 0;
    const failure = new Error('PRIVATE_UPSTREAM_SECRET_SENTINEL');
    const persist = vi.spyOn(settings, 'updateCredentials').mockRejectedValueOnce(failure);
    expect(
      await request(
        'zai/configure',
        { apiToken: 'uncommitted', apiHost: 'https://session.invalid' },
        500
      )
    ).toEqual({ error: 'Failed to save z.ai configuration.' });
    expect(zai.getApiToken()).toBe('committed-offline');
    expect(zai.getApiHost()).toBe('https://api.z.ai');
    expect(events).toEqual([]);
    persist.mockRestore();
    const result = await request('zai/configure', {
      apiToken: 'committed-two',
      apiHost: 'https://session.invalid',
    });
    expect(result.message).toContain('until server restart');
    expect(zai.getApiHost()).toBe('https://session.invalid');
    expect((await settings.getCredentials()).apiKeys.zai).toBe('committed-two');
    const claude = runtime.app.get(ClaudeUsageService),
      codex = runtime.app.get(CodexUsageService);
    vi.spyOn(claude, 'isAvailable').mockResolvedValue(true);
    vi.spyOn(codex, 'isAvailable').mockResolvedValue(true);
    for (const service of [claude, codex, zai, runtime.app.get(GeminiUsageService)])
      vi.spyOn(service, 'fetchUsageData').mockRejectedValue(failure);
    vi.spyOn(runtime.app.get(CodexModelCacheService), 'getModelsWithMetadata').mockRejectedValue(
      failure
    );
    for (const [route, status] of [
      ['claude/usage', 500],
      ['codex/usage', 500],
      ['gemini/usage', 200],
      ['zai/usage', 500],
      ['codex/models', 500],
    ] as const) {
      const response = await request(route, undefined, status);
      expect(response).toHaveProperty('error');
      expect(JSON.stringify(response)).not.toContain('PRIVATE_UPSTREAM_SECRET_SENTINEL');
    }
  } finally {
    await runtime.app.close();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  }
});
