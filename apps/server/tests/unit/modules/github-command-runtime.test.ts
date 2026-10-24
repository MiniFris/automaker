import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { githubReadFixture } from '../../helpers/github-read-fixture.js';
import { NodeGithubCommandRuntime } from '../../../src/modules/github/github-command.runtime.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
const execute = promisify(execFile);
const observer = vi.hoisted(() => ({ wait: vi.fn() }));
vi.mock('../../../src/core/platform/linux-process-group.js', () => ({
  waitForLinuxProcessGroupExit: observer.wait,
}));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe.skipIf(process.platform !== 'linux')('owned GitHub command runtime', () => {
  let fixture: Awaited<ReturnType<typeof githubReadFixture>>, runtime: NodeGithubCommandRuntime;
  beforeEach(async () => {
    fixture = await githubReadFixture();
    runtime = new NodeGithubCommandRuntime(fixture.environment);
    observer.wait.mockResolvedValue(undefined);
  });
  afterEach(async () => {
    await runtime.onModuleDestroy().catch(() => {});
    vi.useRealTimers();
    await fixture.cleanup();
  });
  const request = (cwd: string, signal = new AbortController().signal) => ({
    program: 'gh' as const,
    args: ['repo', 'view'],
    cwd,
    signal,
  });

  it('reads the requested repository despite inherited repository and config overrides', async () => {
    const project = path.join(fixture.root, 'requested');
    const other = path.join(fixture.root, 'unrelated');
    for (const directory of [project, other]) {
      await execute('git', ['-c', 'init.templateDir=', 'init', '--quiet', directory]);
      await execute('git', [
        '-C',
        directory,
        'remote',
        'add',
        'origin',
        `https://github.com/owned/${directory === project ? 'requested' : 'unrelated'}.git`,
      ]);
    }
    await runtime.onModuleDestroy();
    const inherited = {
      ...fixture.environment,
      GIT_DIR: path.join(other, '.git'),
      GIT_WORK_TREE: other,
      GIT_COMMON_DIR: path.join(other, '.git'),
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'remote.origin.url',
      GIT_CONFIG_VALUE_0: 'https://github.com/owned/injected.git',
    };
    runtime = new NodeGithubCommandRuntime(inherited);
    const response = await runtime.run({
      program: 'git',
      args: ['remote', 'get-url', 'origin'],
      cwd: project,
      signal: new AbortController().signal,
    });
    expect(response.stdout.trim()).toBe('https://github.com/owned/requested.git');
    expect(inherited.GIT_DIR).toBe(path.join(other, '.git'));
    expect(inherited.GIT_CONFIG_COUNT).toBe('1');
  });

  it.each(['pairs', 'parameters'] as const)(
    'ignores inherited %s URL rewrites in real Git',
    async (mode) => {
      await execute('git', ['-c', 'init.templateDir=', 'init', '--quiet', fixture.root]);
      await execute('git', [
        '-C',
        fixture.root,
        'remote',
        'add',
        'origin',
        'https://github.com/owned/requested.git',
      ]);
      await runtime.onModuleDestroy();
      runtime = new NodeGithubCommandRuntime({
        ...fixture.environment,
        ...(mode === 'pairs'
          ? {
              GIT_CONFIG_COUNT: '1',
              GIT_CONFIG_KEY_0: 'url.https://unrelated.test/.insteadOf',
              GIT_CONFIG_VALUE_0: 'https://github.com/',
            }
          : {
              GIT_CONFIG_PARAMETERS: "'url.https://unrelated.test/.insteadOf=https://github.com/'",
            }),
      });
      const response = await runtime.run({
        program: 'git',
        args: ['remote', 'get-url', 'origin'],
        cwd: fixture.root,
        signal: new AbortController().signal,
      });
      expect(response.stdout.trim()).toBe('https://github.com/owned/requested.git');
    }
  );

  it('waits for owned group observation even after the parent process and stdio closed', async () => {
    const entered = deferred(),
      release = deferred();
    observer.wait.mockImplementation(async () => {
      entered.resolve();
      await release.promise;
    });
    let settled = false;
    const task = runtime.run(request(fixture.root)).finally(() => {
      settled = true;
    });
    try {
      await entered.promise;
      await Promise.resolve();
      expect(settled).toBe(false);
      release.resolve();
      expect(JSON.parse((await task).stdout)).toMatchObject({ name: 'repo.v2' });
      expect(observer.wait).toHaveBeenCalledOnce();
    } finally {
      release.resolve();
      await task;
    }
  });

  it('reports bounded unconfirmed cleanup and blocks replacement commands instead of forgetting the child identity', async () => {
    vi.useFakeTimers();
    const entered = deferred(),
      release = deferred();
    observer.wait.mockImplementation(async () => {
      entered.resolve();
      await release.promise;
    });
    const task = runtime.run(request(fixture.root));
    const failed = expect(task).rejects.toMatchObject({ kind: 'cleanup' });
    try {
      await entered.promise;
      await vi.advanceTimersByTimeAsync(2000);
      await failed;
      expect((runtime as unknown as { unconfirmed: Set<number> }).unconfirmed.size).toBe(1);
      expect(() => runtime.run(request(fixture.root))).toThrow('not accepting');
      await expect(runtime.onModuleDestroy()).rejects.toMatchObject({
        code: 'GITHUB_COMMAND_CLEANUP_FAILED',
      });
    } finally {
      release.resolve();
      await task.catch(() => {});
    }
  });

  it('rejects oversized output and never exposes stderr details in a rate-limit error', async () => {
    await fixture.scenario('flood');
    await expect(runtime.run(request(fixture.root))).rejects.toMatchObject({ kind: 'limit' });
    await fixture.scenario('rate');
    const failure = await runtime.run(request(fixture.root)).catch((error) => error);
    expect(failure).toMatchObject({ kind: 'exit', rateLimited: true });
    expect(JSON.stringify(failure)).not.toContain('private-provider-credential');
  });

  it('handles spawn failure and cancellation before spawn without invoking the fixture', async () => {
    await expect(runtime.run(request(fixture.root + '/missing-cwd'))).rejects.toMatchObject({
      kind: 'spawn',
    });
    expect(observer.wait).not.toHaveBeenCalled();
    const task = runtime.run(request(fixture.root));
    const closing = runtime.onModuleDestroy();
    await expect(task).rejects.toMatchObject({ kind: 'cancel' });
    await closing;
    expect(runtime.onModuleDestroy()).toBe(closing);
    await expect(fixture.calls()).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
