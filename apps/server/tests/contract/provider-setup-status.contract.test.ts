import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';
import { ProviderConnectionRepository } from '../../src/modules/providers/provider-connection.repository.js';
import { MockProvider } from '../helpers/mock-provider.js';

it('serves native setup status through injected adapters and isolates disconnect markers between apps', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-setup-status-'));
  const runtimes: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const names = ['gemini', 'copilot', 'cursor'] as const;
  const start = async (name: string) => {
    const workingDirectory = path.join(directory, name);
    await mkdir(path.join(workingDirectory, '.automaker'), { recursive: true });
    const checkAuth = vi.fn(async () => ({ authenticated: true, method: 'test-fixture' }));
    class StatusProvider extends MockProvider {
      checkAuth() {
        return checkAuth();
      }
    }
    const registry = new ProviderRegistry(
      names.map((provider) => ({ name: provider, create: () => new StatusProvider(provider) })),
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
        AUTOMAKER_API_KEY: 'fixture-api-key',
        ENABLE_REQUEST_LOGGING: 'false',
      },
    });
    runtimes.push(runtime);
    await runtime.start();
    const { port } = runtime.app.getHttpServer().address() as AddressInfo;
    const status = async (provider: string) => {
      // Setup endpoints were public before migration; do not require an API key.
      const response = await fetch(`http://127.0.0.1:${port}/api/setup/${provider}-status`);
      return { code: response.status, body: await response.json() };
    };
    return { workingDirectory, checkAuth, status };
  };
  try {
    const first = await start('first');
    const second = await start('second');
    for (const name of names) {
      const auth = { authenticated: false, authenticationChecked: false, method: 'none' };
      expect(await first.status(name)).toMatchObject({
        code: 200,
        body: {
          success: true,
          installed: true,
          version: 'test-fixture',
          path: '/test-only/cli',
          auth,
        },
      });
      await writeFile(path.join(first.workingDirectory, '.automaker', `.${name}-disconnected`), '');
      first.checkAuth.mockClear();
      expect(await first.status(name)).toMatchObject({
        code: 200,
        body: {
          success: true,
          auth: { authenticated: false, method: 'none' },
        },
      });
      expect(first.checkAuth).not.toHaveBeenCalled();
      expect(await second.status(name)).toMatchObject({
        code: 200,
        body: {
          success: true,
          auth,
        },
      });
      await rm(path.join(first.workingDirectory, '.automaker', `.${name}-disconnected`));
      expect(await first.status(name)).toMatchObject({
        code: 200,
        body: {
          auth,
        },
      });
    }
    first.checkAuth.mockRejectedValueOnce(new Error('secret-token fixture-secret'));
    const error = await first.status('copilot');
    expect(error).toMatchObject({
      code: 500,
      body: { success: false, error: 'Failed to read copilot status.' },
    });
    expect(JSON.stringify(error)).not.toContain('fixture-secret');
  } finally {
    for (const runtime of runtimes) await runtime.app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
