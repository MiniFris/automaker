import { access, chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import {
  NodeSetupStatusRuntime,
  SetupStatusRuntime,
} from '../../src/core/platform/setup-status.runtime.js';
import { SetupCredentialCache } from '../../src/modules/providers/setup-credential-cache.service.js';
import { GithubAuthenticationService } from '../../src/modules/providers/github-authentication.service.js';

it.skipIf(process.platform === 'win32')(
  'serves native host status using owned CLI fixtures and immutable per-app environments',
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-host-status-'));
    const runtimes: Awaited<ReturnType<typeof createNestApplication>>[] = [];
    const originalPath = process.env.PATH;
    let releasePath: string | undefined;
    let closing: Promise<void> | undefined;
    const start = async (name: string, apiKey: boolean) => {
      const workingDirectory = path.join(directory, name);
      const bin = path.join(workingDirectory, 'bin');
      await mkdir(bin, { recursive: true });
      await mkdir(path.join(workingDirectory, '.automaker'));
      for (const command of ['claude', 'gh']) {
        const executable = path.join(bin, command);
        await writeFile(
          executable,
          `#!${process.execPath}\n` +
            `if(process.cwd()!==process.env.STATUS_TEST_CWD)process.exit(2);\n` +
            `if(process.argv[2]==='--version')process.stdout.write(${JSON.stringify(command === 'gh' ? 'gh version ' : 'Claude ')}+process.env.STATUS_TEST_VERSION);\n` +
            `else if(process.argv[2]==='api'){\n` +
            `const fs=require('node:fs');\n` +
            `fs.appendFileSync(process.env.STATUS_TEST_API_COUNT,'1');\n` +
            `if(!fs.existsSync(process.env.STATUS_TEST_GATE))process.stdout.write(process.env.STATUS_TEST_USER);\n` +
            `else{fs.writeFileSync(process.env.STATUS_TEST_STARTED,'');\n` +
            `const timer=setInterval(()=>{if(fs.existsSync(process.env.STATUS_TEST_RELEASE)){clearInterval(timer);process.stdout.write(process.env.STATUS_TEST_USER);}},10);}\n}\n`
        );
        await chmod(executable, 0o755);
      }
      const environment = {
        NODE_ENV: 'test',
        AUTOMAKER_API_KEY: 'fixture-api-key',
        ENABLE_REQUEST_LOGGING: 'false',
        PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${originalPath ?? ''}`,
        STATUS_TEST_CWD: workingDirectory,
        STATUS_TEST_USER: name,
        STATUS_TEST_VERSION: '2.40.1',
        STATUS_TEST_GATE: path.join(workingDirectory, 'probe-gate'),
        STATUS_TEST_STARTED: path.join(workingDirectory, 'probe-started'),
        STATUS_TEST_RELEASE: path.join(workingDirectory, 'probe-release'),
        STATUS_TEST_API_COUNT: path.join(workingDirectory, 'api-count'),
        ...(apiKey && { ANTHROPIC_API_KEY: 'private-fixture-anthropic-key' }),
      };
      const runtime = await createNestApplication({
        host: '127.0.0.1',
        port: 0,
        workingDirectory,
        dataDir: path.join(workingDirectory, 'data'),
        runStartupTasks: false,
        enableShutdownHooks: false,
        environment,
      });
      runtimes.push(runtime);
      // Do not read real user credential files; only CLI lookup/version/API fixtures are real.
      vi.spyOn(runtime.app.get(SetupStatusRuntime), 'claudeIndicators').mockResolvedValue({
        hasCredentialsFile: false,
        hasSettingsFile: false,
        hasStatsCacheWithActivity: false,
        hasProjectsSessions: false,
        credentials: null,
      });
      await runtime.start();
      const { port } = runtime.app.getHttpServer().address() as AddressInfo;
      const request = async (route: string, body?: unknown, expected = 200) => {
        const response = await fetch(`http://127.0.0.1:${port}/api/setup/${route}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          ...(body !== undefined && { body: JSON.stringify(body) }),
        });
        expect(response.status).toBe(expected);
        return response.json();
      };
      environment.STATUS_TEST_USER = 'mutated-after-bootstrap';
      environment.STATUS_TEST_VERSION = 'mutated-after-bootstrap';
      return { runtime, request, workingDirectory };
    };
    try {
      const first = await start('first', false);
      releasePath = path.join(first.workingDirectory, 'probe-release');
      const second = await start('second', true);
      for (const [name, state] of [
        ['first', first],
        ['second', second],
      ] as const) {
        const gh = await state.request('gh-status');
        await expect(access(path.join(state.workingDirectory, 'api-count'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
        expect(gh).toEqual({
          success: true,
          installed: true,
          authenticationChecked: false,
          authenticated: false,
          user: null,
          version: '2.40.1',
          path: path.join(state.workingDirectory, 'bin', 'gh'),
        });
        const target = (await state.request('github-authentication-target')).target;
        await state.request('verify-github-auth', { confirmed: false, target }, 400);
        expect(
          await state.request('verify-github-auth', { confirmed: true, target })
        ).toMatchObject({ authenticationChecked: true, authenticated: true, user: name, target });
        expect(await state.request('claude-status')).toMatchObject({
          success: true,
          installed: true,
          status: 'installed',
          method: 'path',
          version: 'Claude 2.40.1',
          path: path.join(state.workingDirectory, 'bin', 'claude'),
          auth: { authenticated: name === 'second', hasEnvApiKey: name === 'second' },
        });
        expect(await state.request('platform')).toEqual({
          success: true,
          platform: os.platform(),
          arch: os.arch(),
          homeDir: os.homedir(),
          isWindows: false,
          isMac: os.platform() === 'darwin',
          isLinux: os.platform() === 'linux',
        });
        expect(await state.request('api-keys')).toEqual({
          success: true,
          hasAnthropicKey: name === 'second',
          hasGoogleKey: false,
          hasOpenaiKey: false,
        });
        expect(JSON.stringify(gh)).not.toContain('private-fixture');
      }
      first.runtime.app.get(SetupCredentialCache).set('anthropic', 'private-owned-key');
      expect((await first.request('claude-status')).auth).toMatchObject({
        authenticated: true,
        method: 'api_key',
        hasStoredApiKey: true,
      });
      expect(second.runtime.app.get(SetupCredentialCache).get('anthropic')).toBeUndefined();
      await writeFile(path.join(first.workingDirectory, '.automaker', '.claude-disconnected'), '');
      expect((await first.request('claude-status')).auth).toMatchObject({
        authenticated: false,
        hasStoredApiKey: false,
        hasEnvApiKey: false,
      });
      expect((await second.request('claude-status')).auth).toMatchObject({
        authenticated: true,
        method: 'api_key_env',
      });
      expect(process.env.PATH).toBe(originalPath);

      const host = first.runtime.app.get<NodeSetupStatusRuntime>(SetupStatusRuntime);
      await writeFile(path.join(first.workingDirectory, 'probe-gate'), '');
      const target = (await first.request('github-authentication-target')).target;
      await second.request('verify-github-auth', { confirmed: true, target }, 409);
      const probe = first.request('verify-github-auth', { confirmed: true, target });
      // Synchronize on the real fixture child, not a timer or an intent flag.
      await vi.waitFor(() => access(path.join(first.workingDirectory, 'probe-started')));
      const service = first.runtime.app.get(GithubAuthenticationService);
      const shutdown = vi.spyOn(service, 'beforeApplicationShutdown');
      let closed = false;
      closing = first.runtime.app.close().then(() => {
        closed = true;
      });
      await vi.waitFor(() => expect(shutdown).toHaveBeenCalledOnce());
      expect(closed).toBe(false);
      await expect(service.target()).rejects.toThrow();
      await writeFile(releasePath, '');
      expect(await probe).toMatchObject({ authenticated: true, user: 'first' });
      await closing;
      expect(closed).toBe(true);
      expect((await second.request('gh-status')).authenticationChecked).toBe(false);
    } finally {
      if (releasePath) await writeFile(releasePath, '');
      await closing;
      vi.restoreAllMocks();
      for (const runtime of runtimes) await runtime.app.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  15_000
);
