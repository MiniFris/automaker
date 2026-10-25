import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, access } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { TemplatesService } from '../../src/modules/templates/templates.service.js';
import {
  TEMPLATE_COMMAND_RUNNER,
  type SpawnTemplateCommandRunner,
  type TemplateCommandRuntime,
} from '../../src/modules/templates/template-command.runner.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/security.module.js';

let root: string;
const owners: Awaited<ReturnType<typeof createNestApplication>>[] = [];
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'templates-native-lifecycle-'));
});
afterEach(async () => {
  const closed = await Promise.allSettled(owners.splice(0).map((owner) => owner.app.close()));
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
  for (const result of closed) if (result.status === 'rejected') throw result.reason;
});
async function start() {
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  const owner = await createNestApplication({
    workingDirectory: root,
    dataDir: path.join(root, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: { NODE_ENV: 'test', AUTOMAKER_API_KEY: 'fixture', ALLOWED_ROOT_DIRECTORY: root },
  });
  owners.push(owner);
  return {
    ...owner,
    workspace,
    service: owner.app.get(TemplatesService),
    runner: owner.app.get<SpawnTemplateCommandRunner>(TEMPLATE_COMMAND_RUNNER),
    filesystem: owner.app.get(SECURE_FILESYSTEM),
  };
}
const input = (parentDir: string, projectName = 'project') => ({
  parentDir,
  projectName,
  repoUrl: 'https://github.com/offline/fixture',
});

it('reserves canonical targets before yielding and never removes a competing/foreign directory', async () => {
  const owner = await start();
  const alias = path.join(root, 'alias');
  await symlink(owner.workspace, alias, 'dir');
  const gate = deferred(),
    entered = deferred();
  const run = vi.spyOn(owner.runner, 'run').mockImplementation(async (_, args) => {
    if (args[0] === 'clone') {
      entered.resolve();
      await gate.promise;
    }
    return { exitCode: 0, stderr: '' };
  });
  const first = owner.service.clone(input(owner.workspace));
  const conflict = owner.service.clone(input(alias));
  await expect(conflict).rejects.toMatchObject({ statusCode: 409 });
  await entered.promise;
  const target = path.join(owner.workspace, 'project');
  await access(target);
  const foreign = path.join(owner.workspace, 'foreign');
  await mkdir(foreign);
  await writeFile(path.join(foreign, 'marker'), 'foreign');
  await expect(owner.service.clone(input(owner.workspace, 'foreign'))).rejects.toMatchObject({
    statusCode: 400,
  });
  expect(await readFile(path.join(foreign, 'marker'), 'utf8')).toBe('foreign');
  const original = owner.filesystem.mkdir.bind(owner.filesystem);
  const raceTarget = path.join(owner.workspace, 'raced');
  const race = vi
    .spyOn(owner.filesystem, 'mkdir')
    .mockImplementation(async (candidate, options) => {
      if (candidate === raceTarget && options?.recursive === false) {
        await mkdir(raceTarget);
        await writeFile(path.join(raceTarget, 'marker'), 'other attempt');
      }
      return original(candidate, options);
    });
  await expect(owner.service.clone(input(owner.workspace, 'raced'))).rejects.toMatchObject({
    statusCode: 400,
  });
  race.mockRestore();
  expect(await readFile(path.join(raceTarget, 'marker'), 'utf8')).toBe('other attempt');
  gate.resolve();
  expect(await first).toMatchObject({ success: true, projectPath: target });
  expect(run.mock.calls.map(([, args]) => args[0])).toEqual(['clone', 'init']);
});

it('drains the whole held clone and owned cleanup before FS close, with no late init or success', async () => {
  const owner = await start();
  const gate = deferred(),
    entered = deferred(),
    cleaned = deferred(),
    releaseCleanup = deferred();
  let signal!: AbortSignal;
  const run = vi.spyOn(owner.runner, 'run').mockImplementation(async (_, args, __, abort) => {
    expect(args[0]).toBe('clone');
    signal = abort!;
    entered.resolve();
    await gate.promise;
    return { exitCode: 0, stderr: '' };
  });
  const target = path.join(owner.workspace, 'project');
  const remove = owner.filesystem.rm.bind(owner.filesystem);
  vi.spyOn(owner.filesystem, 'rm').mockImplementation(async (candidate, options) => {
    if (candidate === target) {
      cleaned.resolve();
      await releaseCleanup.promise;
    }
    return remove(candidate, options);
  });
  const close = vi.spyOn(owner.filesystem, 'close');
  const workflow = owner.service.clone(input(owner.workspace));
  const cancelled = expect(workflow).rejects.toMatchObject({ errorCode: 'CANCELLED' });
  await entered.promise;
  const closing = owner.app.close();
  await vi.waitFor(() => expect(signal.aborted).toBe(true));
  gate.resolve();
  await cleaned.promise;
  expect(close).not.toHaveBeenCalled();
  releaseCleanup.resolve();
  await cancelled;
  await closing;
  expect(run).toHaveBeenCalledTimes(1);
  await expect(access(target)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(owner.service.clone(input(owner.workspace))).rejects.toMatchObject({
    statusCode: 503,
  });
});

it.skipIf(process.platform !== 'linux')(
  'cancels an actual private owned command before target cleanup and native FS closure',
  async () => {
    const owner = await start();
    const commandRuntime = (owner.runner as unknown as { runtime: TemplateCommandRuntime }).runtime;
    let child!: ChildProcess;
    const entered = deferred();
    vi.spyOn(commandRuntime, 'spawn').mockImplementation((command, args, cwd) => {
      expect(command).toBe('git');
      expect(args[0]).toBe('clone');
      child = spawn(
        process.execPath,
        [
          '-e',
          "process.on('SIGTERM',()=>{});process.send('ready');setTimeout(()=>process.exit(0),4000);",
        ],
        { cwd, detached: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }
      );
      child.once('message', () => entered.resolve());
      return child;
    });
    const kill = process.kill.bind(process),
      signals: unknown[] = [];
    const trace = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (!child || pid !== -child.pid!) throw new Error('Unowned fixture signal target.');
      if (signal !== 0) signals.push(signal);
      return kill(pid, signal);
    });
    const target = path.join(owner.workspace, 'project');
    const workflow = owner.service.clone(input(owner.workspace));
    const cancelled = expect(workflow).rejects.toMatchObject({ errorCode: 'CANCELLED' });
    try {
      await entered.promise;
      await owner.app.close();
      await cancelled;
      expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
      await expect(access(target)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      trace.mockRestore();
      if (child?.connected) child.disconnect();
    }
  }
);
