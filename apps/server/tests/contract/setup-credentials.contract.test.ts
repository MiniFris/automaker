import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import {
  SetupCredentialTargetResponseSchema,
  SetupCredentialMutationResponseSchema,
} from '@automaker/contracts';
import { createNestApplication } from '../../src/main.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { ApplicationCredentialsService } from '../../src/modules/providers/application-credentials.service.js';
import { SetupCredentialsService } from '../../src/modules/providers/setup-credentials.service.js';

it('persists confirmed native key changes, isolates apps, preserves env files, and suppresses bootstrap after restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-native-key-http-'));
  const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const before = { ...process.env };
  let release: (() => void) | undefined;
  let closing: Promise<void> | undefined;
  const start = async (name: string) => {
    const root = path.join(directory, name);
    await mkdir(root, { recursive: true });
    const runtime = await createNestApplication({
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
        OPENAI_API_KEY: `sk-bootstrap-${name}`,
      },
    });
    apps.push(runtime);
    await runtime.start();
    const port = (runtime.app.getHttpServer().address() as AddressInfo).port;
    const request = async (route: string, body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/setup/${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      expect(response.headers.get('X-Automaker-API-Version')).toBe('9');
      return { status: response.status, body: await response.json() };
    };
    return { runtime, root, request };
  };
  try {
    const first = await start('first');
    const second = await start('second');
    await writeFile(path.join(first.root, '.env'), 'OPENAI_API_KEY=operator-owned-bootstrap\n');
    const target = SetupCredentialTargetResponseSchema.parse(
      (await first.request('credential-target?provider=openai')).body
    ).target;
    expect(target.credentialsPath).toBe(path.join(first.root, 'data', 'credentials.json'));
    for (const input of [
      { provider: 'openai', apiKey: 'sk-old-body' },
      { confirmed: false, target },
      { confirmed: true, target, apiKey: 'sk-mask...1234' },
    ])
      expect((await first.request('store-api-key', input)).status).toBe(400);
    expect((await second.request('delete-api-key', { confirmed: true, target })).status).toBe(409);
    const apiKey = 'sk-native-private-fixture-123456';
    const stored = await first.request('store-api-key', { confirmed: true, target, apiKey });
    expect(stored.status).toBe(200);
    expect(SetupCredentialMutationResponseSchema.parse(stored.body)).toMatchObject({
      target,
      operation: 'store',
      configured: true,
    });
    expect(JSON.stringify(stored.body)).not.toContain(apiKey);
    expect(
      (await first.runtime.app.get(ApplicationCredentialsService).environment()).OPENAI_API_KEY
    ).toBe(apiKey);
    expect(
      (await second.runtime.app.get(ApplicationCredentialsService).environment()).OPENAI_API_KEY
    ).toBe('sk-bootstrap-second');
    expect((await first.request('api-keys')).body.hasOpenaiKey).toBe(true);
    expect((await first.request('delete-api-key', { confirmed: true, target })).body).toMatchObject(
      { operation: 'delete', configured: false }
    );
    expect((await first.request('api-keys')).body.hasOpenaiKey).toBe(false);
    const oauthTarget = (await first.request('credential-target?provider=anthropic_oauth_token'))
      .body.target;
    const oauth = 'offline-subscription-token-fixture-123456';
    expect(
      (
        await first.request('store-api-key', {
          confirmed: true,
          target: oauthTarget,
          apiKey: oauth,
        })
      ).status
    ).toBe(200);
    expect(
      (await first.runtime.app.get(ApplicationCredentialsService).environment())
        .CLAUDE_CODE_OAUTH_TOKEN
    ).toBe(oauth);
    expect((await first.runtime.app.get(SettingsService).getCredentials()).apiKeys.anthropic).toBe(
      ''
    );
    expect(
      (await first.request('delete-api-key', { confirmed: true, target: oauthTarget })).status
    ).toBe(200);
    expect(
      (await first.runtime.app.get(ApplicationCredentialsService).environment())
        .CLAUDE_CODE_OAUTH_TOKEN
    ).toBeUndefined();
    expect((await first.runtime.app.get(SettingsService).getCredentials()).apiKeys.openai).toBe('');
    expect(await readFile(path.join(first.root, '.env'), 'utf8')).toBe(
      'OPENAI_API_KEY=operator-owned-bootstrap\n'
    );
    await first.runtime.app.close();
    const restarted = await start('first');
    expect((await restarted.request('api-keys')).body.hasOpenaiKey).toBe(false);
    expect(
      (await restarted.runtime.app.get(ApplicationCredentialsService).environment()).OPENAI_API_KEY
    ).toBeUndefined();
    expect((await restarted.request('delete-api-key', { confirmed: true, target })).status).toBe(
      409
    );
    expect(process.env).toEqual(before);

    const nextTarget = (await restarted.request('credential-target?provider=openai')).body.target;
    const writer = restarted.runtime.app.get(SettingsService);
    const persist = writer.setSetupCredential.bind(writer);
    vi.spyOn(writer, 'setSetupCredential').mockImplementationOnce(async (provider, value) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await persist(provider, value);
    });
    const pending = restarted.request('store-api-key', {
      confirmed: true,
      target: nextTarget,
      apiKey,
    });
    await vi.waitFor(() => expect(writer.setSetupCredential).toHaveBeenCalledOnce());
    const command = restarted.runtime.app.get(SetupCredentialsService);
    const shutdown = vi.spyOn(command, 'beforeApplicationShutdown');
    closing = restarted.runtime.app.close();
    await vi.waitFor(() => expect(shutdown).toHaveBeenCalledOnce());
    expect(() => command.target('openai')).toThrow('shutting down');
    release!();
    expect((await pending).status).toBe(200);
    await closing;
    expect(
      (await new SettingsService(path.join(restarted.root, 'data')).getCredentials()).apiKeys.openai
    ).toBe(apiKey);
  } finally {
    release?.();
    await closing;
    for (const app of apps) await app.app.close();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
