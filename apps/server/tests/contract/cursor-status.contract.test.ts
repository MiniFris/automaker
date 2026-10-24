import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { CursorSetupStatusSchema } from '@automaker/contracts';
import { createNestApplication } from '../../src/main.js';
import { CursorProvider } from '../../src/providers/cursor-provider.js';
import { ProviderConnectionRepository } from '../../src/modules/providers/provider-connection.repository.js';

it('serves passive Cursor hints over native HTTP with independent application credentials and connection markers', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-cursor-native-'));
  const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  vi.spyOn(CursorProvider.prototype, 'isInstalled').mockResolvedValue(true);
  vi.spyOn(CursorProvider.prototype, 'getVersion').mockResolvedValue('offline-fixture');
  vi.spyOn(CursorProvider.prototype, 'getCliPath').mockReturnValue('/fixture/cursor-agent');
  const before = { ...process.env };
  const start = async (name: string) => {
    const root = path.join(directory, name);
    await mkdir(root);
    const runtime = await createNestApplication({
      host: '127.0.0.1',
      port: 0,
      dataDir: path.join(root, 'data'),
      workingDirectory: root,
      runStartupTasks: false,
      enableShutdownHooks: false,
      environment: {
        NODE_ENV: 'test',
        AUTOMAKER_API_KEY: 'offline-fixture',
        HOME: root,
        CURSOR_CONFIG_DIR: root,
        ...(name === 'one' && { CURSOR_API_KEY: 'private-opaque-key' }),
        ENABLE_REQUEST_LOGGING: 'false',
      },
    });
    apps.push(runtime);
    await runtime.start();
    const status = async () => {
      const response = await fetch(
        `http://127.0.0.1:${runtime.app.getHttpServer().address().port}/api/setup/cursor-status`
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('X-Automaker-API-Version')).toBe('13');
      return CursorSetupStatusSchema.parse(await response.json());
    };
    return { root, runtime, status };
  };
  try {
    const first = await start('one');
    const second = await start('two');
    await writeFile(path.join(first.root, 'credentials.json'), 'private-identity-invalid-json');
    const connected = await first.status();
    expect(connected.connected).toBe(true);
    expect(connected.auth).toEqual({
      authenticated: false,
      authenticationChecked: false,
      scope: 'host',
      method: 'api_key',
      hasEnvApiKey: true,
      hasCredentialsFile: true,
    });
    expect(JSON.stringify(connected)).not.toContain('private-');
    expect((await second.status()).auth).toEqual({
      authenticated: false,
      authenticationChecked: false,
      scope: 'host',
      method: 'none',
      hasEnvApiKey: false,
      hasCredentialsFile: false,
    });
    const connections = first.runtime.app.get(ProviderConnectionRepository);
    await connections.disconnect('cursor');
    expect(await first.status()).toMatchObject({
      installed: true,
      connected: false,
      auth: {
        authenticated: false,
        method: 'none',
        hasEnvApiKey: false,
        hasCredentialsFile: false,
      },
    });
    await connections.reconnect('cursor');
    expect((await first.status()).auth).toEqual(connected.auth);
    await first.runtime.app.close();
    expect((await second.status()).connected).toBe(true);
    expect(
      Object.keys({ ...before, ...process.env }).filter((key) => before[key] !== process.env[key])
    ).toEqual([]);
  } finally {
    await Promise.all(apps.map(({ app }) => app.close()));
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  }
});
