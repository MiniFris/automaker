import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { CliConnectionProviderSchema } from '@automaker/contracts';
import { createNestApplication } from '../../src/main.js';
import { SetupStatusRuntime } from '../../src/core/platform/setup-status.runtime.js';
import { ProviderConnectionRepository } from '../../src/modules/providers/provider-connection.repository.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';
import { MockProvider } from '../helpers/mock-provider.js';

it('requires a confirmed instance/provider target and persists only the selected app disconnect for all six providers', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-disconnect-http-'));
  const runtimes: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const names = CliConnectionProviderSchema.options;
  const start = async (name: string) => {
    const workingDirectory = path.join(directory, name);
    const registry = new ProviderRegistry(
      names.map((provider) => ({ name: provider, create: () => new MockProvider(provider) })),
      ProviderConnectionRepository.forWorkingDirectory(workingDirectory)
    );
    const runtime = await createNestApplication({
      host: '127.0.0.1',
      port: 0,
      workingDirectory,
      dataDir: path.join(workingDirectory, 'data'),
      runStartupTasks: false,
      enableShutdownHooks: false,
      services: { providerRegistry: registry },
      environment: {
        NODE_ENV: 'test',
        AUTOMAKER_API_KEY: 'fixture-key',
        ENABLE_REQUEST_LOGGING: 'false',
      },
    });
    runtimes.push(runtime);
    vi.spyOn(runtime.app.get(SetupStatusRuntime), 'detect').mockResolvedValue({
      installed: true,
      version: 'fixture',
      path: '/fixture/cli',
      method: 'path',
    });
    await runtime.start();
    const { port } = runtime.app.getHttpServer().address() as AddressInfo;
    const request = async (route: string, body?: unknown) => {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/setup/${route}`,
        body === undefined
          ? {}
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
      );
      return { status: response.status, body: await response.json() };
    };
    return { runtime, registry, request, workingDirectory };
  };
  try {
    const first = await start('first');
    const second = await start('second');
    for (const provider of names) {
      const preview = await first.request(`connection-target?provider=${provider}`);
      expect(preview.status).toBe(200);
      const target = preview.body.target;
      expect(target).toMatchObject({
        kind: 'host-application',
        provider,
        workingDirectory: first.workingDirectory,
      });
      expect((await first.request(`deauth-${provider}`, {})).status).toBe(400);
      expect((await first.request(`deauth-${provider}`, { confirmed: false, target })).status).toBe(
        400
      );
      expect(
        (
          await first.request(`deauth-${provider}`, {
            confirmed: true,
            target: { ...target, workingDirectory: second.workingDirectory },
          })
        ).status
      ).toBe(409);
      expect((await second.request(`deauth-${provider}`, { confirmed: true, target })).status).toBe(
        409
      );
      expect(first.registry.providerForModel(`${provider}-fixture`).getName()).toBe(provider);
      const disconnected = await first.request(`deauth-${provider}`, { confirmed: true, target });
      expect(disconnected).toMatchObject({
        status: 200,
        body: { success: true, connected: false, target },
      });
      expect(await first.request(`deauth-${provider}`, { confirmed: true, target })).toEqual(
        disconnected
      );
      expect(
        await readFile(
          path.join(first.workingDirectory, '.automaker', `.${provider}-disconnected`),
          'utf8'
        )
      ).toBe('');
      expect(() => first.registry.providerForModel(`${provider}-fixture`)).toThrow('disconnected');
      expect(second.registry.providerForModel(`${provider}-fixture`).getName()).toBe(provider);
      const status = await first.request(`${provider}-status`);
      expect(status).toMatchObject({
        status: 200,
        body: { success: true, auth: { authenticated: false, method: 'none' } },
      });
    }
    expect(await readdir(path.join(first.workingDirectory, '.automaker'))).toHaveLength(6);
    await expect(readdir(path.join(second.workingDirectory, '.automaker'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect((await first.request('connection-target?provider=constructor')).status).toBe(400);
  } finally {
    vi.restoreAllMocks();
    for (const runtime of runtimes) await runtime.app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
