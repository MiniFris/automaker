import { createTestWorktreeRouteServices } from '../../helpers/worktree-route-services.js';
import { createTestProviderRegistry } from '../../helpers/provider-registry.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import express from 'express';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '@/services/settings-service.js';
import { ManagedSSH } from '@/services/execution-environment/ssh.js';
import { ProjectGitService, workspaceAlias } from '@/services/execution-environment/project-git.js';
import { FeatureWorkspaceService } from '@/services/execution-environment/feature-workspace.js';
import { ManagedTestRunnerService } from '@/services/execution-environment/test-runner.js';
import { createWorktreeRoutes } from '@/routes/worktree/index.js';
import { createEventEmitter } from '@/lib/events.js';
import { createTestAuth } from '../../helpers/auth-context.js';
import { sshPeer, testSSHKey } from '../../helpers/ssh-peer.js';

const exec = promisify(execFile);
describe.skipIf(process.platform !== 'linux')('manual test runner on real SSH', () => {
  let auth: Awaited<ReturnType<typeof createTestAuth>>;
  let root: string, project: string, checkout: string, settings: SettingsService;
  let peer: Awaited<ReturnType<typeof sshPeer>>;
  let tests: ManagedTestRunnerService;
  let server: ReturnType<ReturnType<typeof express>['listen']>, url: string;
  let events: ReturnType<typeof createEventEmitter>;
  let received: Array<{ type: string; payload: Record<string, unknown> }>;
  const signal = () => new AbortController().signal;
  const post = async (action: string, body: object, authenticated = true) => {
    const response = await fetch(`${url}/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authenticated ? { 'X-API-Key': 'fixture-secret' } : {}),
      },
      body: JSON.stringify(body),
    });
    return { httpStatus: response.status, ...(await response.json()) };
  };
  const logs = async (alias?: string, id?: string) => {
    const query = new URLSearchParams();
    if (alias) query.set('worktreePath', alias);
    if (id) query.set('sessionId', id);
    const response = await fetch(`${url}/test-logs?${query}`, {
      headers: { 'X-API-Key': 'fixture-secret' },
    });
    return { httpStatus: response.status, ...(await response.json()) };
  };
  const start = async (command: string, alias = project, extras: object = {}) => {
    await settings.updateProjectSettings(project, { testCommand: command });
    const target = (await new ProjectGitService(settings).resolve(alias))!;
    return post('start-tests', {
      worktreePath: alias,
      environmentTargetId: target.environment.targetId,
      ...extras,
    });
  };
  const finished = async (id: string) => {
    await vi.waitFor(() => expect(tests.find(undefined, id)?.finishedAt).not.toBeNull(), {
      timeout: 7000,
    });
    return tests.describe(tests.find(undefined, id)!);
  };
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "managed-tests-'"));
    project = path.join(root, 'controller');
    checkout = path.join(root, "target 'space");
    for (const [cwd, content] of [
      [project, 'CONTROLLER_ONLY'],
      [checkout, 'TARGET_ONLY'],
    ]) {
      await fs.mkdir(cwd);
      await exec('git', ['-C', cwd, 'init', '-qb', 'main']);
      await fs.writeFile(path.join(cwd, 'source.txt'), content);
      await fs.writeFile(
        path.join(cwd, '.gitignore'),
        '.automaker/\n.worktrees/\n*.pid\neffects\n'
      );
      await exec('git', ['-C', cwd, 'add', '.']);
      await exec('git', [
        '-C',
        cwd,
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        'commit',
        '-qm',
        'base',
      ]);
    }
    const key = testSSHKey();
    peer = await sshPeer(path.join(root, 'peer'), key);
    const profile = {
      id: 'ssh',
      name: 'SSH',
      type: 'ssh' as const,
      host: '127.0.0.1',
      port: peer.port,
      username: 'developer',
      basePath: path.join(root, 'peer', 'base'),
      credentialId: 'key',
    };
    settings = new SettingsService(path.join(root, 'data'));
    await settings.updateGlobalSettings({
      executionEnvironment: { default: { mode: 'profile', profileId: 'ssh' }, profiles: [profile] },
    });
    const manager = new ManagedSSH(settings),
      host = await manager.state.scan(profile);
    await manager.state.confirm(profile, host.fingerprint, false);
    await manager.state.saveKey('key', key);
    await manager.prepareProject(
      profile,
      project,
      { method: 'existing', remotePath: checkout },
      signal()
    );
    events = createEventEmitter();
    received = [];
    events.subscribe((type, payload) =>
      received.push({ type, payload: payload as Record<string, unknown> })
    );
    tests = new ManagedTestRunnerService(settings, events);
    vi.stubEnv('AUTOMAKER_API_KEY', 'fixture-secret');
    const app = express();
    app.use(express.json());
    auth = await createTestAuth(path.join(root, 'auth'), { AUTOMAKER_API_KEY: 'fixture-secret' });
    app.use(
      '/worktree',
      auth.middleware,
      createWorktreeRoutes(
        createTestWorktreeRouteServices({ managedTests: tests }),
        createTestProviderRegistry(settings),
        events,
        settings
      )
    );
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/worktree`;
  }, 15000);
  afterEach(async () => {
    await auth?.close();
    await tests?.cleanup();
    server?.closeAllConnections();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await peer?.close();
    await fs.rm(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('requires application auth and a fresh inspected target before any remote dispatch', async () => {
    const count = peer.commands.length;
    expect((await post('start-tests', { worktreePath: project }, false)).httpStatus).toBe(401);
    expect((await post('start-tests', { worktreePath: project })).code).toBe('TEST_TARGET_CHANGED');
    expect(
      (await post('start-tests', { worktreePath: project, environmentTargetId: 'stale' })).code
    ).toBe('TEST_TARGET_CHANGED');
    expect(peer.commands).toHaveLength(count);
  });
  it('runs the project command on target, streams/finalizes in order and never copies controller env', async () => {
    const response = await start(
      "cat source.txt; printf '%s\\n' \"$AUTOMAKER_API_KEY\"; printf '%s\\n' \"$CI\"; echo once >> effects; sleep 0.3; printf 'Готово\\n'",
      project,
      { command: 'touch CONTROLLER_INJECTION' }
    );
    expect(response.success).toBe(true);
    const session = await finished(response.result.sessionId);
    expect(session).toMatchObject({
      status: 'passed',
      exitCode: 0,
      executionEnvironment: { type: 'ssh', runtimeCwd: checkout },
    });
    expect(session.logs).toContain('TARGET_ONLY');
    expect(session.logs).toContain('true');
    expect(session.logs).toContain('Готово');
    expect(session.logs).not.toContain('CONTROLLER_ONLY');
    expect(session.logs).not.toContain('fixture-secret');
    expect(await fs.readFile(path.join(checkout, 'effects'), 'utf8')).toBe('once\n');
    await expect(fs.stat(path.join(project, 'effects'))).rejects.toThrow();
    await expect(fs.stat(path.join(project, 'CONTROLLER_INJECTION'))).rejects.toThrow();
    const sequence = received
      .filter((e) => e.payload.sessionId === session.sessionId)
      .map((e) => e.type);
    expect(sequence[0]).toBe('test-runner:started');
    expect(sequence).toContain('test-runner:output');
    expect(sequence.at(-1)).toBe('test-runner:completed');
    expect((await logs(project)).result).toEqual(JSON.parse(JSON.stringify(session)));
  });
  it('preserves failure/255 status and quotes a literal test-file argument without shell injection', async () => {
    const filename = "unit ' space; touch INJECTED; #.test.ts";
    const response = await start(
      "node -e 'console.log(JSON.stringify(process.argv)); process.exit(255)'",
      project,
      { testFile: filename, projectPath: '/wrong-controller-settings' }
    );
    const session = await finished(response.result.sessionId);
    expect(session).toMatchObject({ status: 'failed', exitCode: 255, testFile: filename });
    expect(session.logs).toContain(filename);
    await expect(fs.stat(path.join(checkout, 'INJECTED'))).rejects.toThrow();
  });
  it('rejects malformed/traversal arguments before target commands, and requires configured tests', async () => {
    const before = peer.commands.length;
    for (const testFile of ['../escape.ts', '/absolute.ts', '', {}, 'a\0b'])
      expect((await start('true', project, { testFile })).code).toBe('TEST_FILE_INVALID');
    expect((await start('')).code).toBe('TEST_COMMAND_MISSING');
    expect(peer.commands).toHaveLength(before);
    expect((await post('start-tests', { worktreePath: {} })).code).toBe('TEST_REQUEST_INVALID');
  });
  it(
    'reserves concurrent creates and stops the original target after removing its profile/default',
    { timeout: 20000 },
    async () => {
      await settings.updateProjectSettings(project, {
        testCommand: 'sleep 60 & echo $! > background.pid; echo $$ > shell.pid; wait',
      });
      const target = (await new ProjectGitService(settings).resolve(project))!;
      const results = await Promise.all(
        [1, 2].map(() =>
          post('start-tests', {
            worktreePath: project,
            environmentTargetId: target.environment.targetId,
          })
        )
      );
      expect(results.filter((r) => r.success)).toHaveLength(1);
      expect(results.find((r) => !r.success).code).toBe('TEST_ALREADY_RUNNING');
      const sessionId = results.find((r) => r.success).result.sessionId;
      await vi.waitFor(() => fs.access(path.join(checkout, 'background.pid')));
      await settings.updateGlobalSettings({
        executionEnvironment: { default: { mode: 'local' }, profiles: [] },
      });
      expect(
        (await post('start-tests', { worktreePath: project, environmentTargetId: '' })).code
      ).toBe('TEST_ALREADY_RUNNING');
      expect((await logs(project)).result.executionEnvironment).toMatchObject({
        type: 'ssh',
        runtimeCwd: checkout,
      });
      const stop = await post('stop-tests', { sessionId });
      expect(stop.success).toBe(true);
      expect(tests.find(undefined, sessionId)?.status).toBe('cancelled');
      for (const file of ['background.pid', 'shell.pid']) {
        const pid = (await fs.readFile(path.join(checkout, file), 'utf8')).trim();
        await expect(fs.stat('/proc/' + pid)).rejects.toThrow();
      }
      expect((await post('stop-tests', { sessionId })).success).toBe(true);
    }
  );
  it(
    'uses an old feature worktree pin after its profile is deleted',
    { timeout: 20000 },
    async () => {
      const run = (await new FeatureWorkspaceService(settings).prepare(
        project,
        { id: 'feature', model: 'cursor-auto', branchName: 'main' },
        signal()
      ))!;
      const alias = workspaceAlias(run.binding)!;
      await settings.updateGlobalSettings({
        executionEnvironment: { default: { mode: 'local' }, profiles: [] },
      });
      const response = await start('pwd; cat source.txt', alias);
      const session = await finished(response.result.sessionId);
      expect(session.executionEnvironment).toMatchObject({
        type: 'ssh',
        pinned: true,
        runtimeCwd: run.environment.cwd,
      });
      expect(session.logs).toContain(run.environment.cwd);
      expect(session.logs).toContain('TARGET_ONLY');
      await expect(fs.stat(alias)).rejects.toThrow();
    }
  );
  it(
    'reports transport loss as unconfirmed error, never as cancelled/pass or a replay',
    { timeout: 20000 },
    async () => {
      const response = await start(
        'echo once >> effects; sleep 60 & echo $! > background.pid; wait'
      );
      const id = response.result.sessionId;
      await vi.waitFor(() => fs.access(path.join(checkout, 'background.pid')));
      const pid = (await fs.readFile(path.join(checkout, 'background.pid'), 'utf8')).trim();
      peer.disconnect();
      const session = await finished(id);
      expect(session).toMatchObject({ status: 'error', exitCode: null });
      expect(session.error).toContain('unconfirmed');
      expect((await post('stop-tests', { sessionId: id })).code).toBe('TEST_CLEANUP_UNVERIFIED');
      await vi.waitFor(async () => await expect(fs.stat('/proc/' + pid)).rejects.toThrow(), {
        timeout: 7000,
      });
      expect(await fs.readFile(path.join(checkout, 'effects'), 'utf8')).toBe('once\n');
      await expect(fs.stat(path.join(project, 'effects'))).rejects.toThrow();
    }
  );
  it('does not recreate unknown managed IDs or route them into legacy processes', async () => {
    const before = peer.commands.length;
    expect((await post('stop-tests', { sessionId: 'managed-test-expired' })).code).toBe(
      'TEST_SESSION_GONE'
    );
    expect((await logs(undefined, 'managed-test-expired')).httpStatus).toBe(404);
    expect((await logs(project)).httpStatus).toBe(404);
    expect(peer.commands).toHaveLength(before);
  });
  it('refuses a stale remote scope after switching to Local and preserves ordinary Local tests', async () => {
    const older = await start("printf 'REMOTE_OLD\\n'");
    await finished(older.result.sessionId);
    const target = (await new ProjectGitService(settings).resolve(project))!;
    await settings.updateProjectSettings(project, {
      testCommand: "printf 'LEGACY_LOCAL\\n'; cat source.txt",
    });
    await settings.updateGlobalSettings({
      executionEnvironment: { default: { mode: 'local' }, profiles: [] },
    });
    const before = peer.commands.length;
    expect(
      (
        await post('start-tests', {
          worktreePath: project,
          environmentTargetId: target.environment.targetId,
        })
      ).code
    ).toBe('TEST_TARGET_CHANGED');
    const response = await post('start-tests', {
      worktreePath: project,
      projectPath: project,
      environmentTargetId: '',
    });
    expect(response.success).toBe(true);
    expect(response.result.sessionId).not.toMatch(/^managed-test-/);
    const result = await logs(undefined, response.result.sessionId);
    expect(result.result.logs).toContain('CONTROLLER_ONLY');
    expect(result.result.logs).toContain('LEGACY_LOCAL');
    expect((await logs(project)).result.sessionId).toBe(response.result.sessionId);
    expect(peer.commands).toHaveLength(before);
  });
  it('bounds retained logs while preserving final output', async () => {
    const response = await start(
      'node -e \'process.stdout.write("x".repeat(150000)+"FINAL_TAIL\\n")\''
    );
    const session = await finished(response.result.sessionId);
    expect(session.status).toBe('passed');
    expect(session.logs.length).toBeLessThanOrEqual(50000);
    expect(session.logs).toContain('FINAL_TAIL');
  });
});
