import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { CliConnectionProviderSchema } from '@automaker/contracts';
import { createNestApplication } from '../../src/main.js';
import {
  SetupStatusRuntime,
  NodeSetupStatusRuntime,
} from '../../src/core/platform/setup-status.runtime.js';
import { ProviderConnectionCommandService } from '../../src/modules/providers/provider-connection-command.service.js';
import { ProviderConnectionRepository } from '../../src/modules/providers/provider-connection.repository.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';
import { MockProvider } from '../helpers/mock-provider.js';

it('requires a confirmed instance/provider target and persists only the selected app disconnect for all six providers', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-disconnect-http-'));
  const runtimes: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  let release = () => {};
  let closing: Promise<void> | undefined;
  const names = CliConnectionProviderSchema.options;
  const start = async (name: string) => {
    const workingDirectory = path.join(directory, name);
    const runtime = await createNestApplication({
      host: '127.0.0.1',
      port: 0,
      workingDirectory,
      dataDir: path.join(workingDirectory, 'data'),
      runStartupTasks: false,
      enableShutdownHooks: false,
      providerRegistrations: names.map((provider) => ({
        name: provider,
        create: () => new MockProvider(provider),
      })),
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
    vi.spyOn(runtime.app.get(SetupStatusRuntime), 'claudeIndicators').mockResolvedValue({
      hasCredentialsFile: false,
      hasSettingsFile: false,
      hasStatsCacheWithActivity: true,
      hasProjectsSessions: false,
      credentials: null,
    });
    vi.spyOn(runtime.app.get(SetupStatusRuntime), 'codexIndicators').mockResolvedValue({
      hasApiKey: false,
      hasAuthFile: true,
      hasOAuthToken: true,
    });
    vi.spyOn(runtime.app.get(SetupStatusRuntime), 'cursorCredentials').mockResolvedValue(true);
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
    return { runtime, registry: runtime.app.get(ProviderRegistry), request, workingDirectory };
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
    for (const provider of names) {
      const preview = await first.request(`connection-target?provider=${provider}`);
      expect(preview.body.protocolVersion).toBe(3);
      const target = preview.body.target;
      expect((await first.request(`auth-${provider}`, {})).status).toBe(400);
      expect((await first.request(`auth-${provider}`, { confirmed: false, target })).status).toBe(
        400
      );
      expect((await second.request(`auth-${provider}`, { confirmed: true, target })).status).toBe(
        409
      );
      expect(() => first.registry.providerForModel(`${provider}-fixture`)).toThrow('disconnected');
      const reconnected = await first.request(`auth-${provider}`, { confirmed: true, target });
      expect(reconnected).toMatchObject({
        status: 200,
        body: { success: true, connected: true, target },
      });
      expect(await first.request(`auth-${provider}`, { confirmed: true, target })).toEqual(
        reconnected
      );
      expect(first.registry.providerForModel(`${provider}-fixture`).getName()).toBe(provider);
      const status = (await first.request(`${provider}-status`)).body.auth;
      expect(status.authenticated).toBe(!['copilot', 'gemini', 'cursor'].includes(provider));
      if (['copilot', 'gemini', 'cursor'].includes(provider))
        expect(status.authenticationChecked).toBe(false);
    }
    expect(await readdir(path.join(first.workingDirectory, '.automaker'))).toEqual([]);

    const repository = first.runtime.app.get(ProviderConnectionRepository);
    await repository.disconnect('cursor');
    const service = first.runtime.app.get(ProviderConnectionCommandService);
    const host = first.runtime.app.get<NodeSetupStatusRuntime>(SetupStatusRuntime);
    const delayed = new Promise<boolean>((resolve) => {
      release = () => resolve(true);
    });
    vi.mocked(host.cursorCredentials).mockClear().mockReturnValueOnce(delayed);
    const target = service.target('cursor').target;
    const read = service.reconnect('cursor', { confirmed: true, target });
    const queued = service.disconnect('cursor', { confirmed: true, target });
    await vi.waitFor(() => expect(host.cursorCredentials).toHaveBeenCalled());
    const before = vi.spyOn(service, 'beforeApplicationShutdown');
    const hostShutdown = vi.spyOn(host, 'onApplicationShutdown');
    let closed = false;
    closing = first.runtime.app.close().then(() => {
      closed = true;
    });
    await vi.waitFor(() => expect(before).toHaveBeenCalledOnce());
    expect(closed).toBe(false);
    expect(hostShutdown).not.toHaveBeenCalled();
    await expect(service.reconnect('cursor', { confirmed: true, target })).rejects.toMatchObject({
      statusCode: 503,
    });
    release();
    await read;
    await queued;
    await closing;
    expect(hostShutdown).toHaveBeenCalledOnce();
    expect(repository.isDisconnected('cursor')).toBe(true);
    expect(second.registry.providerForModel('cursor-fixture').getName()).toBe('cursor');
  } finally {
    release();
    await closing;
    vi.restoreAllMocks();
    for (const runtime of runtimes) await runtime.app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
