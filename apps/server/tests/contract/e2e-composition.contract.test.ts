import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';

import { createNestApplication } from '../../src/main.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';
import { simpleQuery } from '../../src/providers/simple-query-service.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { createE2eApplication } from '../helpers/e2e-application.js';

describe('explicit Nest E2E composition', () => {
  it('starts the standalone test process and removes its owned DATA_DIR on SIGTERM', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'tests/e2e-server.ts'], {
      cwd: path.resolve(import.meta.dirname, '../..'),
      env: { ...process.env, NODE_ENV: 'test', PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const closed = once(child, 'close');
    let output = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dataDirectory: string | undefined;
    try {
      const ready = await new Promise<{ port: number; dataDirectory: string }>(
        (resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`E2E startup timed out: ${output}`)), 8000);
          child.once('error', reject);
          child.once('close', () =>
            reject(new Error(`E2E process stopped before readiness: ${output}`))
          );
          child.stderr.on('data', (chunk) => {
            output += chunk.toString();
          });
          child.stdout.on('data', (chunk) => {
            output += chunk.toString();
            for (const line of output.split('\n')) {
              if (line.startsWith('{"event":"e2e-ready",')) resolve(JSON.parse(line));
            }
          });
        }
      );
      dataDirectory = ready.dataDirectory;
      expect((await fetch(`http://127.0.0.1:${ready.port}/api/health`)).status).toBe(200);
    } finally {
      clearTimeout(timer);
      child.kill('SIGTERM');
      const forceKill = setTimeout(() => child.kill('SIGKILL'), 3000);
      try {
        await closed;
      } finally {
        clearTimeout(forceKill);
      }
    }
    expect(child.exitCode).toBe(0);
    expect(dataDirectory).toBeTruthy();
    await expect(access(dataDirectory!)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 15_000);

  it('refuses the test composition in production', async () => {
    await expect(createE2eApplication({ NODE_ENV: 'production' })).rejects.toThrow(
      'must not run in production'
    );
  });

  it('overrides providers and auth probes only in the test module and cleans its storage', async () => {
    const runtime = await createE2eApplication({ HOST: '127.0.0.1', PORT: '0' });
    try {
      expect(runtime.app.getHttpServer().listening).toBe(false);
      await runtime.app.listen(0, '127.0.0.1');
      const { port } = runtime.app.getHttpServer().address() as AddressInfo;
      const base = `http://127.0.0.1:${port}/api`;
      expect((await fetch(`${base}/models/available`)).status).toBe(401);
      for (const provider of ['claude', 'codex']) {
        const response = await fetch(`${base}/setup/verify-${provider}-auth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': 'automaker-test-api-key' },
          body: JSON.stringify({ authMethod: 'api_key', apiKey: 'fixture-not-a-real-key' }),
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ authenticated: true });
      }
      const registry = runtime.app.get(ProviderRegistry);
      const settingsService = runtime.app.get(SettingsService);
      await settingsService.updateGlobalSettings({
        openaiCompatibleEndpoints: [
          {
            id: 'fixture',
            name: 'Test-only endpoint (never contacted)',
            enabled: true,
            baseUrl: 'http://127.0.0.1:9/v1',
            protocol: 'chat-completions',
            auth: { type: 'none' },
            models: [
              {
                id: 'fixture',
                displayName: 'Fixture',
                capabilities: { tools: false, streaming: false },
              },
            ],
          },
        ],
      });
      for (const model of ['claude-sonnet-4-6', 'codex-gpt-5', 'direct-fixture']) {
        const result = await simpleQuery(
          { prompt: 'fixture', model, settingsService, providerId: 'fixture' },
          registry
        );
        expect(result.text).toBe('Mock agent output for testing.');
      }
    } finally {
      await runtime.app.close();
    }
    await expect(access(runtime.dataDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not let the retired mock environment flag bypass production login limits', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-auth-limit-'));
    const runtime = await createNestApplication({
      host: '127.0.0.1',
      port: 0,
      dataDir: directory,
      runStartupTasks: false,
      enableShutdownHooks: false,
      environment: { ...process.env, NODE_ENV: 'production', AUTOMAKER_MOCK_AGENT: 'true' },
    });
    try {
      await runtime.start();
      const { port } = runtime.app.getHttpServer().address() as AddressInfo;
      const login = (apiKey: string) =>
        fetch(`http://127.0.0.1:${port}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey }),
        });
      // Successful logins must not consume the failed-attempt allowance.
      for (let index = 0; index < 7; index++) {
        expect((await login('invalid')).status).toBe(401);
        expect((await login('automaker-test-api-key')).status).toBe(200);
      }
      for (let index = 0; index < 5; index++) expect((await login('invalid')).status).toBe(401);
      expect((await login('invalid')).status).toBe(429);
      expect((await login('automaker-test-api-key')).status).toBe(429);
    } finally {
      await runtime.app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
