import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { RETIRED_CREDENTIAL_WRITE } from '@automaker/contracts';
import { createNestApplication } from '../../src/main.js';
import { ApplicationCredentialsService } from '../../src/modules/providers/application-credentials.service.js';

it('rejects bulk private-record writes and settings-import key resurrection while retaining explicit native imports', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-credential-transport-'));
  const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const before = { ...process.env };
  const start = async (name: string) => {
    const root = path.join(directory, name);
    const app = await createNestApplication({
      host: '127.0.0.1',
      port: 0,
      workingDirectory: root,
      dataDir: path.join(root, 'data'),
      runStartupTasks: false,
      enableShutdownHooks: false,
      environment: {
        NODE_ENV: 'test',
        AUTOMAKER_API_KEY: `${name}-key`,
        ENABLE_REQUEST_LOGGING: 'false',
        OPENAI_API_KEY: 'bootstrap-private-fixture',
      },
    });
    apps.push(app);
    await app.start();
    const address = app.app.getHttpServer().address();
    const call = async (route: string, method = 'GET', body?: unknown, authenticated = true) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/${route}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(authenticated && { 'x-api-key': `${name}-key` }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      expect(response.headers.get('X-Automaker-API-Version')).toBe('12');
      return { status: response.status, body: await response.json() };
    };
    const credentials = app.app.get(ApplicationCredentialsService);
    return { app, root, call, credentials, port: address.port };
  };
  try {
    const first = await start('one');
    const second = await start('two');
    await first.credentials.change('anthropic', 'sk-ant-existing-native-fixture-12345');
    await first.credentials.change('openai', null);
    const file = path.join(first.root, 'data', 'credentials.json');
    const snapshot = await readFile(file, 'utf8');
    expect(
      (
        await first.call(
          'settings/credentials',
          'PUT',
          { apiKeys: { openai: 'private-stale-key' } },
          false
        )
      ).status
    ).toBe(401);
    for (const body of [
      {},
      [],
      { apiKeys: { anthropic: 'private-stale-value', openai: 'private-stale-value' } },
      {
        disabledBootstrapApiKeys: { openai: false },
        anthropicOAuthToken: 'private-injected-oauth',
        openaiCompatibleApiKeys: { other: 'private-direct-key' },
      },
    ]) {
      expect(await first.call('settings/credentials', 'PUT', body)).toEqual({
        status: 410,
        body: RETIRED_CREDENTIAL_WRITE,
      });
      expect(await readFile(file, 'utf8')).toBe(snapshot);
    }
    const malformed = await fetch(`http://127.0.0.1:${first.port}/api/settings/credentials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'one-key' },
      body: '{"apiKeys":{"openai":"malformed-private-token',
    });
    expect(malformed.status).toBe(400);
    const invalidBody = await malformed.json();
    expect(invalidBody).toMatchObject({ success: false, error: 'Invalid JSON request body.' });
    expect(JSON.stringify(invalidBody)).not.toContain('malformed-private-token');
    const data = {
      'automaker-storage': JSON.stringify({
        state: {
          theme: 'light',
          apiKeys: {
            anthropic: 'private-stale-anthropic',
            google: 'private-stale-google',
            openai: 'private-stale-openai',
          },
        },
      }),
    };
    for (let repeat = 0; repeat < 2; repeat++) {
      expect(await first.call('settings/migrate', 'POST', { data })).toMatchObject({
        status: 200,
        body: {
          success: true,
          migratedGlobalSettings: true,
          migratedCredentials: false,
          credentialImportRequired: true,
        },
      });
      expect(await readFile(file, 'utf8')).toBe(snapshot);
    }
    expect(await readFile(path.join(first.root, 'data', 'settings.json'), 'utf8')).not.toContain(
      'private-stale-'
    );
    const malformedMigration = await first.call('settings/migrate', 'POST', {
      data: { 'automaker-storage': 'private-token-invalid-json' },
    });
    expect(JSON.stringify(malformedMigration.body)).not.toContain('private-token-invalid-json');
    const masked = await first.call('settings/credentials');
    expect(masked.body.credentials.anthropic.configured).toBe(true);
    expect(JSON.stringify(masked.body)).not.toContain('sk-ant-existing-native-fixture-12345');
    expect(JSON.stringify(masked.body)).not.toContain('disabledBootstrapApiKeys');
    const target = (await first.call('setup/credential-target?provider=google')).body.target;
    const apiKey = 'opaque-explicit-import-google-123456';
    expect(
      (await second.call('setup/store-api-key', 'POST', { confirmed: true, target, apiKey })).status
    ).toBe(409);
    expect(
      (await first.call('setup/store-api-key', 'POST', { confirmed: false, target, apiKey })).status
    ).toBe(400);
    expect(
      (await first.call('setup/store-api-key', 'POST', { confirmed: true, target, apiKey })).status
    ).toBe(200);
    expect((await first.credentials.environment()).GEMINI_API_KEY).toBe(apiKey);
    expect((await first.credentials.environment()).OPENAI_API_KEY).toBeUndefined();
    await first.app.app.close();
    const restarted = await start('one');
    expect((await restarted.credentials.environment()).GEMINI_API_KEY).toBe(apiKey);
    expect((await restarted.credentials.environment()).OPENAI_API_KEY).toBeUndefined();
    expect((await second.credentials.environment()).OPENAI_API_KEY).toBe(
      'bootstrap-private-fixture'
    );
    expect(process.env).toEqual(before);
  } finally {
    for (const app of apps) await app.app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
