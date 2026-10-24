import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { CodexAppServerService } from '../../src/services/codex-app-server-service.js';
import { CodexUsageService } from '../../src/services/codex-usage-service.js';
import { ApplicationCredentialsService } from '../../src/modules/providers/application-credentials.service.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const jwt = (plan: string) =>
  `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_plan_type: plan } })).toString('base64url')}.signature`;

it.skipIf(process.platform !== 'linux')(
  'isolates native Codex discovery, actual RPC child credentials and CODEX_HOME fallback across applications',
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-codex-context-'));
    const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
    const before = { ...process.env };
    const program = await readFile(
      new URL('../fixtures/codex-usage/app-server.cjs', import.meta.url),
      'utf8'
    );
    try {
      for (const name of ['one', 'two']) {
        const root = path.join(directory, `${name} "$literal" $(not-a-command)`);
        const bin = path.join(root, 'bin');
        await mkdir(bin, { recursive: true });
        await mkdir(path.join(root, 'selected-auth'));
        await mkdir(path.join(root, '.codex'));
        await writeFile(path.join(bin, 'codex'), `#!${process.execPath}\n${program}`, {
          mode: 0o700,
        });

        await writeFile(
          path.join(root, 'selected-auth', 'auth.json'),
          JSON.stringify({ tokens: { id_token: jwt(name === 'one' ? 'plus' : 'free') } })
        );
        await writeFile(
          path.join(root, '.codex', 'auth.json'),
          JSON.stringify({ tokens: { id_token: jwt('enterprise') } })
        );
        const runtime = await createNestApplication({
          host: '127.0.0.1',
          port: 0,
          dataDir: path.join(root, 'data'),
          workingDirectory: root,
          runStartupTasks: false,
          enableShutdownHooks: false,
          environment: {
            NODE_ENV: 'test',
            HOME: root,
            CODEX_HOME: 'selected-auth',
            PATH: bin,
            OPENAI_API_KEY: `bootstrap-${name}`,
            FIXTURE_CAPTURE: path.join(root, 'capture.json'),
            AUTOMAKER_API_KEY: 'offline-fixture',
            ENABLE_REQUEST_LOGGING: 'false',
          },
        });
        apps.push(runtime);
        await runtime.start();
      }
      const readModels = async (index: number) => {
        const runtime = apps[index];
        const response = await fetch(
          `http://127.0.0.1:${runtime.app.getHttpServer().address().port}/api/codex/models?refresh=true`,
          { headers: { 'x-api-key': 'offline-fixture' } }
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          success: true,
          models: [{ id: 'codex-offline-model' }],
        });
        const root = path.join(
          directory,
          `${index === 0 ? 'one' : 'two'} "$literal" $(not-a-command)`
        );
        const record = JSON.parse(await readFile(path.join(root, 'capture.json'), 'utf8'));
        expect(record.cwd).toBe(root);
        expect(record.home).toBe(root);
        expect(record.codexHome).toBe('selected-auth');
        expect(record.omitted).toBeNull();
        expect(() => process.kill(record.pid, 0)).toThrow();
        return record;
      };
      await apps[0].app
        .get(ApplicationCredentialsService)
        .change('openai', 'sk-managed-offline-one');
      const first = await readModels(0);
      expect(first.key).toBe(hash('sk-managed-offline-one'));
      expect(first.alternate).toBe(first.key);
      expect((await readModels(1)).key).toBe(hash('bootstrap-two'));
      await apps[0].app.get(ApplicationCredentialsService).change('openai', null);
      const deleted = await readModels(0);
      expect(deleted.key).toBeNull();
      expect(deleted.alternate).toBeNull();
      // Force only the read-only RPC unavailable result; the actual fallback uses each app's auth path.
      for (const [index, plan] of ['plus', 'free'].entries()) {
        const server = apps[index].app.get(CodexAppServerService);
        vi.spyOn(server, 'getAccount').mockResolvedValue(null);
        vi.spyOn(server, 'getRateLimits').mockResolvedValue(null);
        expect(await apps[index].app.get(CodexUsageService).fetchUsageData()).toMatchObject({
          rateLimits: { planType: plan },
        });
      }
      await apps[0].app.close();
      expect((await readModels(1)).key).toBe(hash('bootstrap-two'));
      expect(
        Object.keys({ ...before, ...process.env }).filter((key) => before[key] !== process.env[key])
      ).toEqual([]);
    } finally {
      await Promise.all(apps.map(({ app }) => app.close()));
      vi.restoreAllMocks();
      await rm(directory, { recursive: true, force: true });
    }
  }
);

it.skipIf(process.platform !== 'linux')(
  'drains an actual active native RPC child during Nest before-shutdown',
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-codex-native-close-'));
    let runtime: Awaited<ReturnType<typeof createNestApplication>> | undefined;
    try {
      const bin = path.join(directory, 'bin');
      await mkdir(bin);
      const program = await readFile(
        new URL('../fixtures/codex-usage/app-server.cjs', import.meta.url),
        'utf8'
      );
      await writeFile(path.join(bin, 'codex'), `#!${process.execPath}\n${program}`, {
        mode: 0o700,
      });
      const capture = path.join(directory, 'capture.json');
      runtime = await createNestApplication({
        workingDirectory: directory,
        dataDir: path.join(directory, 'data'),
        runStartupTasks: false,
        enableShutdownHooks: false,
        environment: {
          NODE_ENV: 'test',
          HOME: directory,
          CODEX_HOME: directory,
          PATH: bin,
          FIXTURE_MODE: 'hang',
          FIXTURE_CAPTURE: capture,
          ENABLE_REQUEST_LOGGING: 'false',
        },
      });
      const server = runtime.app.get(CodexAppServerService);
      const query = server.getModels();
      await vi.waitFor(async () =>
        expect(JSON.parse(await readFile(capture, 'utf8')).methods.length).toBeGreaterThan(0)
      );
      const record = JSON.parse(await readFile(capture, 'utf8'));
      await runtime.app.close();
      expect(await query).toBeNull();
      expect(() => process.kill(record.pid, 0)).toThrow();
      await expect(server.getModels()).rejects.toThrow('unavailable');
    } finally {
      await runtime?.app.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
);
