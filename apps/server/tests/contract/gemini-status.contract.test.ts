import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { GeminiSetupStatusSchema } from '@automaker/contracts';
import type { SubprocessOptions } from '@automaker/platform';
import type { ExecuteOptions } from '../../src/providers/types.js';
import { GeminiProvider } from '../../src/providers/gemini-provider.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';
import { ProviderConnectionRepository } from '../../src/modules/providers/provider-connection.repository.js';
import { createNestApplication } from '../../src/main.js';

it('persists confirmed Google keys, feeds real local children and never promotes Gemini hints into authentication', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-gemini-passive-'));
  const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const installed = vi.spyOn(GeminiProvider.prototype, 'isInstalled').mockResolvedValue(true);
  const version = vi.spyOn(GeminiProvider.prototype, 'getVersion').mockResolvedValue('fixture');
  const cli = vi.spyOn(GeminiProvider.prototype, 'getCliPath').mockReturnValue('/fixture/gemini');
  const before = { ...process.env };
  const start = async (name: string) => {
    const root = path.join(directory, name);
    await mkdir(root, { recursive: true });
    const app = await createNestApplication({
      host: '127.0.0.1',
      port: 0,
      workingDirectory: root,
      dataDir: path.join(root, 'data'),
      runStartupTasks: false,
      enableShutdownHooks: false,
      environment: {
        NODE_ENV: 'test',
        AUTOMAKER_API_KEY: 'fixture',
        ENABLE_REQUEST_LOGGING: 'false',
        HOME: root,
        GEMINI_API_KEY: `bootstrap-${name}`,
        GOOGLE_API_KEY: `vertex-${name}`,
      },
    });
    apps.push(app);
    await app.start();
    const address = app.app.getHttpServer().address();
    const request = async (route: string, body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/setup/${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      expect(response.headers.get('X-Automaker-API-Version')).toBe('12');
      return { status: response.status, body: await response.json() };
    };
    const status = async () => GeminiSetupStatusSchema.parse((await request('gemini-status')).body);
    const childEnvironment = async () => {
      const provider = app.app.get(ProviderRegistry).byName('gemini') as unknown as {
        streamProcess(
          options: ExecuteOptions,
          subprocess: SubprocessOptions
        ): AsyncGenerator<unknown>;
      };
      const events = [];
      for await (const event of provider.streamProcess({} as ExecuteOptions, {
        command: process.execPath,
        args: [
          '-e',
          'console.log(JSON.stringify({gemini:process.env.GEMINI_API_KEY??null,google:process.env.GOOGLE_API_KEY??null}))',
        ],
      }))
        events.push(event);
      return events;
    };
    return { root, app, request, status, childEnvironment };
  };
  try {
    const first = await start('one');
    const second = await start('two');
    await mkdir(path.join(first.root, '.gemini'));
    await writeFile(
      path.join(first.root, '.gemini', 'settings.json'),
      'invalid-private-token-file-content'
    );
    await writeFile(path.join(first.root, '.env'), 'GEMINI_API_KEY=operator-owned\n');
    expect((await first.status()).auth).toMatchObject({
      authenticated: false,
      authenticationChecked: false,
      hasConfigFile: true,
      hasApiKey: true,
    });
    const target = (await first.request('credential-target?provider=google')).body.target;
    const apiKey = 'opaque-managed-google-fixture-123456';
    expect((await first.request('store-api-key', { target, apiKey })).status).toBe(400);
    expect(
      (await second.request('store-api-key', { confirmed: true, target, apiKey })).status
    ).toBe(409);
    const stored = await first.request('store-api-key', { confirmed: true, target, apiKey });
    expect(stored).toMatchObject({ status: 200, body: { operation: 'store', configured: true } });
    expect(JSON.stringify(stored.body)).not.toContain(apiKey);
    expect(await first.childEnvironment()).toEqual([{ gemini: apiKey, google: null }]);
    expect(await second.childEnvironment()).toEqual([
      { gemini: 'bootstrap-two', google: 'vertex-two' },
    ]);
    expect((await first.status()).auth).toMatchObject({
      authenticated: false,
      authenticationChecked: false,
      method: 'api_key',
    });
    expect((await first.request('api-keys')).body.hasGoogleKey).toBe(true);
    const connections = first.app.app.get(ProviderConnectionRepository);
    await connections.disconnect('gemini');
    expect(await first.status()).toMatchObject({
      connected: false,
      auth: { authenticated: false, hasApiKey: false, hasConfigFile: false },
    });
    await connections.reconnect('gemini');
    expect(await first.status()).toMatchObject({
      connected: true,
      auth: { authenticated: false, hasApiKey: true },
    });
    expect((await first.request('delete-api-key', { confirmed: true, target })).status).toBe(200);
    await first.app.app.close();
    const restarted = await start('one');
    expect(await restarted.childEnvironment()).toEqual([{ gemini: null, google: null }]);
    expect((await restarted.status()).auth).toMatchObject({
      authenticated: false,
      hasApiKey: false,
    });
    expect((await restarted.request('api-keys')).body.hasGoogleKey).toBe(false);
    expect(await readFile(path.join(first.root, '.env'), 'utf8')).toBe(
      'GEMINI_API_KEY=operator-owned\n'
    );
    expect(process.env).toEqual(before);
  } finally {
    for (const app of apps) await app.app.close();
    installed.mockRestore();
    version.mockRestore();
    cli.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
