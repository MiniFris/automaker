import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';
import { ProviderConnectionRepository } from '../../src/modules/providers/provider-connection.repository.js';
import { ProviderModelCatalogService } from '../../src/modules/providers/provider-model-catalog.service.js';
import { MockProvider } from '../helpers/mock-provider.js';

it('owns model discovery/cache per Nest app and preserves native catalog/status HTTP contracts', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-native-catalog-'));
  const runtimes: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  let release = () => {};
  let closing: Promise<void> | undefined;
  const start = async (application: string, configured: boolean) => {
    const workingDirectory = path.join(directory, application);
    await mkdir(path.join(workingDirectory, '.automaker'), { recursive: true });
    const refresh = vi.fn();
    const detect = vi.fn();
    class CatalogProvider extends MockProvider {
      async refreshModels() {
        await refresh(this.getName());
        return super.refreshModels();
      }
      async detectInstallation() {
        detect(this.getName());
        return {
          installed: true,
          version: 'fixture-version',
          path: '/fixture/cli',
          authenticated: true,
          hasApiKey: false,
          hasOAuthToken: true,
        };
      }
      async fetchAuthenticatedProviders() {
        return [
          { id: 'yes', name: application, authenticated: true },
          { id: 'no', name: 'Other', authenticated: false },
        ];
      }
    }
    const registry = new ProviderRegistry(
      ['copilot', 'opencode', 'codex'].map((name) => ({
        name,
        create: () =>
          new CatalogProvider(name, [
            {
              id: `${name}-${application}`,
              name: application,
              modelString: application,
              provider: name,
            },
          ]),
      })),
      ProviderConnectionRepository.forWorkingDirectory(workingDirectory)
    );
    const runtime = await createNestApplication({
      host: '127.0.0.1',
      port: 0,
      dataDir: path.join(workingDirectory, 'data'),
      workingDirectory,
      runStartupTasks: false,
      enableShutdownHooks: false,
      services: { providerRegistry: registry },
      environment: {
        NODE_ENV: 'test',
        AUTOMAKER_API_KEY: 'fixture-key',
        ENABLE_REQUEST_LOGGING: 'false',
        ...(configured && { OPENAI_API_KEY: 'configuration-hint-only' }),
      },
    });
    runtimes.push(runtime);
    await runtime.start();
    const { port } = runtime.app.getHttpServer().address() as AddressInfo;
    const request = async (route: string, method = 'GET') => {
      const response = await fetch(`http://127.0.0.1:${port}/api/setup/${route}`, {
        method,
        ...(method === 'POST' && { headers: { 'Content-Type': 'application/json' }, body: '{}' }),
      });
      expect(response.status).toBe(200);
      return response.json();
    };
    return { request, refresh, detect, workingDirectory, runtime };
  };
  try {
    const first = await start('first', true);
    const second = await start('second', false);
    for (const name of ['copilot', 'opencode']) {
      const initial = await first.request(`${name}/models`);
      expect(initial).toMatchObject({
        success: true,
        cached: false,
        count: 1,
        models: [{ id: `${name}-first` }],
      });
      expect(await first.request(`${name}/models`)).toEqual({ ...initial, cached: true });
      expect(first.refresh.mock.calls.filter(([owner]) => owner === name)).toHaveLength(1);
      expect(await first.request(`${name}/models?refresh=true`)).toEqual(initial);
      expect(await first.request(`${name}/models/refresh`, 'POST')).toEqual(initial);
      const independent = await second.request(`${name}/models`);
      expect(independent).toMatchObject({ cached: false, models: [{ id: `${name}-second` }] });
      expect(await first.request(`${name}/cache/clear`, 'POST')).toEqual({
        success: true,
        message: `${name === 'copilot' ? 'Copilot' : 'OpenCode'} model cache cleared`,
      });
      expect(await second.request(`${name}/models`)).toEqual({ ...independent, cached: true });
      expect(await first.request(`${name}/models`)).toEqual(initial);
    }
    expect(await first.request('opencode/providers')).toEqual({
      success: true,
      providers: [
        { id: 'yes', name: 'first', authenticated: true },
        { id: 'no', name: 'Other', authenticated: false },
      ],
      authenticated: [{ id: 'yes', name: 'first', authenticated: true }],
    });
    for (const name of ['codex', 'opencode']) {
      expect(await first.request(`${name}-status`)).toMatchObject({
        success: true,
        installed: true,
        version: 'fixture-version',
        path: '/fixture/cli',
        auth: { authenticated: true, method: 'cli_authenticated', hasApiKey: false },
      });
    }
    expect((await first.request('opencode-status')).auth).toMatchObject({
      hasEnvApiKey: true,
      hasOAuthToken: true,
    });
    expect((await second.request('opencode-status')).auth).toMatchObject({ hasEnvApiKey: false });
    await writeFile(path.join(first.workingDirectory, '.automaker', '.codex-disconnected'), '');
    first.detect.mockClear();
    expect(await first.request('codex-status')).toMatchObject({
      auth: { authenticated: false, method: 'none', hasApiKey: false },
    });
    expect(first.detect).not.toHaveBeenCalled();
    expect(await second.request('codex-status')).toMatchObject({ auth: { authenticated: true } });

    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    first.refresh.mockClear();
    first.refresh.mockImplementationOnce(() => delayed);
    const catalog = first.runtime.app.get(ProviderModelCatalogService);
    const read = catalog.models('opencode', true);
    await vi.waitFor(() => expect(first.refresh).toHaveBeenCalledOnce());
    catalog.clear('opencode');
    const shutdown = vi.spyOn(catalog, 'onApplicationShutdown');
    let closed = false;
    closing = first.runtime.app.close().then(() => {
      closed = true;
    });
    await vi.waitFor(() => expect(shutdown).toHaveBeenCalledOnce());
    expect(closed).toBe(false);
    await expect(catalog.models('copilot')).rejects.toMatchObject({ status: 503 });
    release();
    await read;
    await closing;
    expect(closed).toBe(true);
  } finally {
    release();
    await closing;
    for (const runtime of runtimes) await runtime.app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
