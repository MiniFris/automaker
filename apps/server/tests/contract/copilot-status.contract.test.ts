import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { CopilotSetupStatusSchema } from '@automaker/contracts';
import { CopilotProvider } from '../../src/providers/copilot-provider.js';
import { ProviderConnectionRepository } from '../../src/modules/providers/provider-connection.repository.js';
import { createNestApplication } from '../../src/main.js';

it('uses real application snapshots and passive file hints over native HTTP without auth commands', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-copilot-passive-'));
  const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  // Only installation discovery/version are fixtures. Real production factories,
  // credential readers, filesystem inspection and native status controller run.
  const installed = vi.spyOn(CopilotProvider.prototype, 'isInstalled').mockResolvedValue(true);
  const version = vi.spyOn(CopilotProvider.prototype, 'getVersion').mockResolvedValue('fixture');
  const cli = vi.spyOn(CopilotProvider.prototype, 'getCliPath').mockReturnValue('/fixture/copilot');
  const before = { ...process.env };
  const start = async (name: string, token?: string) => {
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
        GH_CONFIG_DIR: path.join(root, 'gh'),
        ...(token && { GITHUB_TOKEN: token }),
      },
    });
    apps.push(app);
    await app.start();
    const address = app.app.getHttpServer().address();
    const status = async () => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/setup/copilot-status`);
      expect(response.status).toBe(200);
      expect(response.headers.get('X-Automaker-API-Version')).toBe('13');
      return CopilotSetupStatusSchema.parse(await response.json());
    };
    return { root, app, status };
  };
  try {
    const first = await start('one', 'private-application-token-fixture');
    const second = await start('two');
    await mkdir(path.join(first.root, 'gh'));
    await writeFile(
      path.join(first.root, 'gh', 'hosts.yml'),
      'private-token private-user invalid-yaml'
    );
    const one = await first.status();
    expect(one.connected).toBe(true);
    expect(one.auth).toEqual({
      authenticated: false,
      authenticationChecked: false,
      method: 'oauth',
      hasEnvToken: true,
      hasConfigFile: true,
    });
    expect(JSON.stringify(one)).not.toContain('private-');
    expect((await second.status()).auth).toEqual({
      authenticated: false,
      authenticationChecked: false,
      method: 'none',
      hasEnvToken: false,
      hasConfigFile: false,
    });
    const connections = first.app.app.get(ProviderConnectionRepository);
    await connections.disconnect('copilot');
    expect((await first.status()).connected).toBe(false);
    expect((await first.status()).auth).toEqual({
      authenticated: false,
      authenticationChecked: false,
      method: 'none',
      hasEnvToken: false,
      hasConfigFile: false,
    });
    await connections.reconnect('copilot');
    expect((await first.status()).connected).toBe(true);
    expect((await first.status()).auth).toEqual(one.auth);
    expect(process.env).toEqual(before);
  } finally {
    for (const app of apps) await app.app.close();
    installed.mockRestore();
    version.mockRestore();
    cli.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
