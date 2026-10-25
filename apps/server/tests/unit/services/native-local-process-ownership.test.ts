import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { spawn, execSync } from 'child_process';
import {
  DevServerService,
  type DevServerRuntime,
} from '../../../src/services/dev-server-service.js';
import { TestRunnerService } from '../../../src/services/test-runner-service.js';
import {
  OwnedLocalChildCleanupError,
  type OwnedLocalChild,
} from '../../../src/services/owned-local-child.js';
vi.mock('child_process', async () => ({
  ...(await vi.importActual('child_process')),
  spawn: vi.fn(),
  execSync: vi.fn(),
}));
vi.mock('@automaker/utils', async () => ({
  ...(await vi.importActual('@automaker/utils')),
  atomicWriteJson: vi.fn().mockResolvedValue(undefined),
}));

function child() {
  return Object.assign(new EventEmitter(), {
    pid: 12345,
    exitCode: null as number | null,
    signalCode: null,
    killed: false,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  }) as unknown as ChildProcess;
}
function supervisor() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  let closing = false;
  const completion = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const owner: OwnedLocalChild = {
    ready: vi.fn().mockResolvedValue(undefined),
    completion: () => completion,
    close: vi.fn(() => {
      closing = true;
      return completion;
    }),
    get closing() {
      return closing;
    },
  };
  return { owner, resolve, reject };
}
function runtime(owners: OwnedLocalChild[]): DevServerRuntime {
  return {
    filesystem: {
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
      access: vi.fn(),
    } as never,
    stateFilesystem: {} as never,
    dataDirectory: '/private-data',
    resolvePath: (value) => value,
    supervise: vi.fn(() => owners.shift()!),
    ports: { first: 49123, last: 49124, available: vi.fn().mockResolvedValue(true) },
  };
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it('native dev skips busy ports and never invokes port-occupant or livereload killers', async () => {
  const policy = runtime([]);
  vi.mocked(policy.ports!.available!).mockResolvedValue(false);
  const dev = new DevServerService(policy);
  const result = await dev.startDevServer('/project', '/project', 'node server.js');
  expect(result.success).toBe(false);
  expect(policy.ports!.available).toHaveBeenCalledTimes(2);
  expect(spawn).not.toHaveBeenCalled();
  expect(execSync).not.toHaveBeenCalled();
  await dev.stopAll();
});

it('native dev retains record/port through root exit and awaits proof before stopped events', async () => {
  const process = child();
  const owned = supervisor();
  const dev = new DevServerService(runtime([owned.owner]));
  const emit = vi.fn();
  dev.setEventEmitter({ emit } as never);
  vi.mocked(spawn).mockReturnValue(process);
  const starting = dev.startDevServer('/project', '/project', 'node server.js');
  await vi.advanceTimersByTimeAsync(501);
  expect((await starting).success).toBe(true);
  expect(spawn).toHaveBeenCalledWith(
    'node',
    ['server.js'],
    expect.objectContaining({ detached: true })
  );
  process.exitCode = 0;
  process.killed = true;
  process.emit('exit', 0);
  expect(dev.isRunning('/project')).toBe(true);
  expect(dev.getServerLogs('/project').success).toBe(true);
  const stopping = dev.stopDevServer('/project');
  let stopped = false;
  void stopping.then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  expect(dev.getAllocatedPorts()).toEqual([49123]);
  expect(emit.mock.calls.filter(([name]) => name === 'dev-server:stopped')).toHaveLength(0);
  await expect(dev.startDevServer('/project', '/project', 'never')).rejects.toMatchObject({
    code: 'LOCAL_PROCESS_CLEANUP_FAILED',
  });
  owned.resolve();
  expect((await stopping).success).toBe(true);
  expect(dev.getAllocatedPorts()).toEqual([]);
  expect(emit.mock.calls.filter(([name]) => name === 'dev-server:stopped')).toHaveLength(1);
  expect(process.kill).not.toHaveBeenCalled();
  expect(execSync).not.toHaveBeenCalled();
  await dev.stopAll();
});

it('native dev attempts sibling cleanup and retains only unconfirmed owner/port after failure', async () => {
  const first = supervisor();
  const second = supervisor();
  const dev = new DevServerService(runtime([first.owner, second.owner]));
  vi.mocked(spawn).mockReturnValueOnce(child()).mockReturnValueOnce(child());
  const a = dev.startDevServer('/a', '/a', 'node a.js');
  await vi.advanceTimersByTimeAsync(501);
  await a;
  const b = dev.startDevServer('/b', '/b', 'node b.js');
  await vi.advanceTimersByTimeAsync(501);
  await b;
  const closing = dev.stopAll();
  const failed = expect(closing).rejects.toThrow('cleanup could not be confirmed');
  await vi.advanceTimersByTimeAsync(0);
  expect(first.owner.close).toHaveBeenCalled();
  expect(second.owner.close).toHaveBeenCalled();
  first.reject(new OwnedLocalChildCleanupError());
  second.resolve();
  await failed;
  expect(dev.getServerInfo('/a')).toMatchObject({ cleanupUnknown: true });
  expect(dev.getServerInfo('/b')).toBeUndefined();
  expect(dev.getAllocatedPorts()).toEqual([49123]);
  expect(dev.stopAll()).toBe(closing);
});

it('native persisted entries never acquire ownership from a port or permit replay', async () => {
  const policy = runtime([]);
  policy.stateFilesystem = {
    access: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(
      JSON.stringify([
        {
          worktreePath: '/persisted',
          allocatedPort: 49123,
          port: 49123,
          url: 'http://localhost:49123',
          startedAt: new Date().toISOString(),
          urlDetected: true,
        },
      ])
    ),
  } as never;
  const dev = new DevServerService(policy);
  await dev.initialize('/ignored', { emit: vi.fn() } as never);
  expect(policy.ports!.available).not.toHaveBeenCalled();
  expect(dev.getServerInfo('/persisted')).toMatchObject({ process: null, cleanupUnknown: true });
  await expect(dev.stopDevServer('/persisted')).rejects.toMatchObject({ status: 503 });
  await expect(dev.startDevServer('/persisted', '/persisted', 'never')).rejects.toMatchObject({
    status: 503,
  });
  expect(spawn).not.toHaveBeenCalled();
  expect(execSync).not.toHaveBeenCalled();
  await expect(dev.stopAll()).rejects.toThrow('cleanup could not be confirmed');
});

it('native test cancellation waits for proof and never marks unknown work completed or restarts it', async () => {
  const process = child();
  const owned = supervisor();
  const tests = new TestRunnerService(runtime([owned.owner]));
  const emit = vi.fn();
  tests.setEventEmitter({ emit } as never);
  vi.mocked(spawn).mockReturnValue(process);
  const start = tests.startTests('/project', { command: 'node test.js' });
  await vi.advanceTimersByTimeAsync(201);
  const result = await start;
  const id = result.result!.sessionId;
  process.exitCode = 0;
  process.killed = true;
  process.emit('exit', 0);
  expect(tests.getActiveSession('/project')?.id).toBe(id);
  expect(tests.getSession(id)?.finishedAt).toBeNull();
  const stopping = tests.stopTests(id);
  const failed = expect(stopping).rejects.toMatchObject({ code: 'LOCAL_PROCESS_CLEANUP_FAILED' });
  owned.reject(new OwnedLocalChildCleanupError());
  await failed;
  expect(tests.getSession(id)).toMatchObject({
    status: 'running',
    finishedAt: null,
    cleanupUnknown: true,
  });
  expect(emit.mock.calls.filter(([name]) => name === 'test-runner:completed')).toHaveLength(0);
  await expect(tests.startTests('/project', { command: 'never' })).rejects.toMatchObject({
    status: 503,
  });
  await expect(tests.cleanup()).rejects.toMatchObject({ status: 503 });
  expect(tests.getSession(id)).toBeDefined();
  expect(process.kill).not.toHaveBeenCalled();
  expect(execSync).not.toHaveBeenCalled();
});

it('native natural completion emits final test status only after supervisor confirmation', async () => {
  const process = child();
  const owned = supervisor();
  const tests = new TestRunnerService(runtime([owned.owner]));
  const emit = vi.fn();
  tests.setEventEmitter({ emit } as never);
  vi.mocked(spawn).mockReturnValue(process);
  const start = tests.startTests('/project', { command: 'node test.js' });
  await vi.advanceTimersByTimeAsync(201);
  const id = (await start).result!.sessionId;
  process.exitCode = 0;
  process.emit('exit', 0);
  expect(tests.getSession(id)?.status).toBe('running');
  owned.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(tests.getSession(id)?.status).toBe('passed');
  expect(emit.mock.calls.filter(([name]) => name === 'test-runner:completed')).toHaveLength(1);
  await tests.cleanup();
});

it.each(['darwin', 'win32'] as const)(
  'keeps normal %s native lifecycle compatibility without routing through unsupported strict proof',
  async (platform) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
    const policy = runtime([]);
    const dev = new DevServerService(policy);
    const devChild = child();
    vi.mocked(spawn).mockReturnValue(devChild);
    const start = dev.startDevServer('/project', '/project', 'node dev.js');
    await vi.advanceTimersByTimeAsync(501);
    expect((await start).success).toBe(true);
    expect(policy.supervise).not.toHaveBeenCalled();
    expect((await dev.stopDevServer('/project')).success).toBe(true);
    expect(devChild.kill).toHaveBeenCalledWith('SIGTERM');
    expect(execSync).not.toHaveBeenCalled();
    const tests = new TestRunnerService(policy);
    const testChild = child();
    vi.mocked(spawn).mockReturnValue(testChild);
    const run = tests.startTests('/project', { command: 'node test.js' });
    await vi.advanceTimersByTimeAsync(201);
    const id = (await run).result!.sessionId;
    testChild.exitCode = 0;
    testChild.emit('exit', 0);
    expect(tests.getSession(id)?.status).toBe('passed');
    expect(policy.supervise).not.toHaveBeenCalled();
    await tests.cleanup();
    await dev.stopAll();
  }
);

it('native test cleanup attempts sibling owners and retains unknown identity after a sibling confirms', async () => {
  const first = supervisor();
  const second = supervisor();
  const tests = new TestRunnerService(runtime([first.owner, second.owner]));
  vi.mocked(spawn).mockReturnValueOnce(child()).mockReturnValueOnce(child());
  const a = tests.startTests('/a', { command: 'node a.js' });
  await vi.advanceTimersByTimeAsync(201);
  const firstId = (await a).result!.sessionId;
  const b = tests.startTests('/b', { command: 'node b.js' });
  await vi.advanceTimersByTimeAsync(201);
  const secondId = (await b).result!.sessionId;
  const closing = tests.cleanup();
  const failed = expect(closing).rejects.toMatchObject({ code: 'LOCAL_PROCESS_CLEANUP_FAILED' });
  await vi.advanceTimersByTimeAsync(0);
  expect(first.owner.close).toHaveBeenCalled();
  expect(second.owner.close).toHaveBeenCalled();
  first.reject(new OwnedLocalChildCleanupError());
  second.resolve();
  await failed;
  expect(tests.getSession(firstId)).toMatchObject({ cleanupUnknown: true, finishedAt: null });
  expect(tests.getSession(secondId)?.status).toBe('cancelled');
  expect(tests.getActiveSession('/b')).toBeUndefined();
  expect(tests.cleanup()).toBe(closing);
  expect(execSync).not.toHaveBeenCalled();
});

it.each(['dev', 'tests'] as const)(
  'reserves native %s canonical worktree before held preflight and keeps its captured key through active aliases',
  async (kind) => {
    const owned = supervisor();
    const policy = runtime([owned.owner]);
    policy.resolvePath = vi.fn((value: string) => (value === '/alias' ? '/canonical' : value));
    let release!: (value: { isDirectory: () => boolean }) => void;
    vi.mocked(policy.filesystem.stat).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }) as never
    );
    const dev = new DevServerService(policy);
    const tests = new TestRunnerService(policy);
    vi.mocked(spawn).mockReturnValue(child());
    const start = (value: string) =>
      kind === 'dev'
        ? dev.startDevServer('/project', value, 'node job.js')
        : tests.startTests(value, { command: 'node job.js' });
    const accepted = start('/alias');
    expect((await start('/alias')).success).toBe(false);
    expect((await start('/canonical')).success).toBe(false);
    expect(policy.filesystem.stat).toHaveBeenCalledTimes(1);
    expect(spawn).not.toHaveBeenCalled();
    release({ isDirectory: () => true });
    await vi.advanceTimersByTimeAsync(501);
    const result = await accepted;
    expect(result.success).toBe(true);
    expect(result.result!.worktreePath).toBe('/alias');
    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ cwd: '/canonical' })
    );
    await start('/canonical');
    expect(spawn).toHaveBeenCalledOnce();
    const calls = vi.mocked(policy.resolvePath).mock.calls.length;
    vi.mocked(policy.resolvePath).mockImplementation(() => {
      throw new Error('Alias was retargeted');
    });
    const closing =
      kind === 'dev'
        ? dev.stopDevServer('/alias')
        : tests.stopTests((result.result as { sessionId: string }).sessionId);
    owned.resolve();
    expect((await closing).success).toBe(true);
    expect(vi.mocked(policy.resolvePath).mock.calls).toHaveLength(calls);
    if (kind === 'dev') await dev.stopAll();
    else await tests.cleanup();
  }
);

it('atomically reserves native dev ports after concurrent delayed probes for different worktrees', async () => {
  const first = supervisor();
  const second = supervisor();
  const policy = runtime([first.owner, second.owner]);
  let release!: (available: boolean) => void;
  const gate = new Promise<boolean>((resolve) => {
    release = resolve;
  });
  vi.mocked(policy.ports!.available!).mockImplementation((port) =>
    port === 49123 ? gate : Promise.resolve(true)
  );
  const dev = new DevServerService(policy);
  vi.mocked(spawn).mockReturnValueOnce(child()).mockReturnValueOnce(child());
  const a = dev.startDevServer('/a', '/a', 'node a.js');
  const b = dev.startDevServer('/b', '/b', 'node b.js');
  await vi.advanceTimersByTimeAsync(0);
  expect(policy.ports!.available).toHaveBeenCalledTimes(2);
  release(true);
  await vi.advanceTimersByTimeAsync(501);
  expect((await a).success).toBe(true);
  expect((await b).success).toBe(true);
  expect(dev.getAllocatedPorts()).toEqual([49123, 49124]);
  expect(vi.mocked(spawn).mock.calls.map(([, , options]) => options!.env!.PORT)).toEqual([
    '49123',
    '49124',
  ]);
  first.resolve();
  second.resolve();
  await dev.stopAll();
  expect(dev.getAllocatedPorts()).toEqual([]);
});

it('releases a native port reservation after synchronous spawn failure', async () => {
  const dev = new DevServerService(runtime([]));
  vi.mocked(spawn).mockImplementation(() => {
    throw new Error('No child was created');
  });
  await expect(dev.startDevServer('/project', '/project', 'node job.js')).rejects.toThrow(
    'No child was created'
  );
  expect(dev.getAllocatedPorts()).toEqual([]);
  await dev.stopAll();
});

it.each(['dev', 'tests'] as const)(
  'releases native %s start reservation after failed preflight instead of blocking a retry',
  async (kind) => {
    const owned = supervisor();
    const policy = runtime([owned.owner]);
    const error = Object.assign(new Error('fixture EIO'), { code: 'EIO' });
    vi.mocked(policy.filesystem.stat).mockRejectedValueOnce(error);
    const dev = new DevServerService(policy);
    const tests = new TestRunnerService(policy);
    vi.mocked(spawn).mockReturnValue(child());
    const start = () =>
      kind === 'dev'
        ? dev.startDevServer('/project', '/project', 'node job.js')
        : tests.startTests('/project', { command: 'node job.js' });
    await expect(start()).rejects.toBe(error);
    const accepted = start();
    await vi.advanceTimersByTimeAsync(501);
    const result = await accepted;
    expect(result.success).toBe(true);
    expect(spawn).toHaveBeenCalledOnce();
    const closing =
      kind === 'dev'
        ? dev.stopDevServer('/project')
        : tests.stopTests((result.result as { sessionId: string }).sessionId);
    owned.resolve();
    await closing;
    if (kind === 'dev') await dev.stopAll();
    else await tests.cleanup();
  }
);

it.each(['dev', 'tests'] as const)(
  'blocks canonical alias replay while native %s retains unknown active identity',
  async (kind) => {
    const owned = supervisor();
    const policy = runtime([owned.owner]);
    policy.resolvePath = (value) => (value === '/alias' ? '/canonical' : value);
    const dev = new DevServerService(policy);
    const tests = new TestRunnerService(policy);
    vi.mocked(spawn).mockReturnValue(child());
    const start = (value: string) =>
      kind === 'dev'
        ? dev.startDevServer('/project', value, 'node job.js')
        : tests.startTests(value, { command: 'node job.js' });
    const accepted = start('/alias');
    await vi.advanceTimersByTimeAsync(501);
    const result = await accepted;
    const stopping =
      kind === 'dev'
        ? dev.stopDevServer('/alias')
        : tests.stopTests((result.result as { sessionId: string }).sessionId);
    const failed = expect(stopping).rejects.toMatchObject({ code: 'LOCAL_PROCESS_CLEANUP_FAILED' });
    owned.reject(new OwnedLocalChildCleanupError());
    await failed;
    await expect(start('/canonical')).rejects.toMatchObject({
      code: 'LOCAL_PROCESS_CLEANUP_FAILED',
    });
    expect(spawn).toHaveBeenCalledOnce();
    if (kind === 'dev')
      await expect(dev.stopAll()).rejects.toThrow('cleanup could not be confirmed');
    else
      await expect(tests.cleanup()).rejects.toMatchObject({ code: 'LOCAL_PROCESS_CLEANUP_FAILED' });
  }
);

it('does not publish a port reservation after a held native probe resumes during shutdown', async () => {
  const policy = runtime([]);
  let release!: (value: boolean) => void;
  vi.mocked(policy.ports!.available!).mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const dev = new DevServerService(policy);
  const accepted = dev.startDevServer('/project', '/project', 'never');
  await vi.advanceTimersByTimeAsync(0);
  expect(policy.ports!.available).toHaveBeenCalledOnce();
  const closing = dev.stopAll();
  release(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(await accepted).toMatchObject({ success: false, error: 'Dev server is shutting down' });
  await closing;
  expect(dev.getAllocatedPorts()).toEqual([]);
  expect(spawn).not.toHaveBeenCalled();
});
