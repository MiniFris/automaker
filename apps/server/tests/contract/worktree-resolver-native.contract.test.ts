import { EnvironmentBindingStore } from '../../src/services/execution-environment/bindings.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { AutoModeServiceCompat } from '../../src/services/auto-mode/index.js';
import { WorktreeResolver } from '../../src/services/worktree-resolver.js';
import { FeatureWorkspaceService } from '../../src/services/execution-environment/feature-workspace.js';
import { ExecutionEnvironmentError } from '../../src/services/execution-environment/runtime.js';
const exec = promisify(execFile),
  apps: Awaited<ReturnType<typeof createNestApplication>>[] = [],
  roots: string[] = [];
afterEach(async () => {
  const results = await Promise.allSettled(apps.splice(0).map((owner) => owner.app.close()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
});
async function fixture(name: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'resolver-' + name + '-'));
  roots.push(root);
  const project = path.join(root, 'project'),
    worktree = path.join(root, 'feature-worktree'),
    bin = path.join(root, 'bin');
  await fs.mkdir(project);
  await fs.mkdir(bin);
  const gitEnvironment = {
    HOME: root,
    PATH: '/usr/bin:/bin',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const git = (...args: string[]) =>
    exec('/usr/bin/git', ['-C', project, ...args], { env: gitEnvironment });
  await git('init', '-q', '--initial-branch=owner-' + name);
  await git('config', 'user.email', 'fixture@example.invalid');
  await git('config', 'user.name', 'Fixture');
  await fs.writeFile(path.join(project, 'owned.txt'), name);
  await git('add', '.');
  await git('commit', '-qm', 'owned');
  await git('worktree', 'add', '-qb', 'feature-' + name, worktree);
  const source =
    `#!${process.execPath}\n` +
    String.raw`
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=process.env.HOME,args=process.argv.slice(2);
fs.appendFileSync(path.join(root,'queries.jsonl'),JSON.stringify({args,home:process.env.HOME,path:process.env.PATH,gitDir:process.env.GIT_DIR,gitWorkTree:process.env.GIT_WORK_TREE,configCount:process.env.GIT_CONFIG_COUNT,backend:!!(process.env.PORT||process.env.DATA_DIR||process.env.AUTOMAKER_API_KEY||process.env.NODE_PATH)})+'\n');
if(fs.existsSync(path.join(root,'hold-git'))){fs.writeFileSync(path.join(root,'held-pid'),String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);}
else if(fs.existsSync(path.join(root,'fail-git'))){process.stderr.write('private-git-diagnostic');process.exitCode=2;}
else{const result=spawnSync('/usr/bin/git',args,{env:process.env});process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.stderr.write('benign-fixture-git-warning\n');process.exitCode=result.status??1;}
`;
  await fs.writeFile(path.join(bin, 'git'), source, { mode: 0o700 });
  const environment = {
    NODE_ENV: 'test',
    HOME: root,
    PATH: bin,
    GIT_DIR: '/captured-foreign/.git',
    GIT_WORK_TREE: '/captured-foreign',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.bare',
    GIT_CONFIG_VALUE_0: 'true',
    ...Object.fromEntries(
      Object.entries(gitEnvironment).filter(([key]) => !['PATH', 'HOME'].includes(key))
    ),
    ALLOWED_ROOT_DIRECTORY: root,
    AUTOMAKER_API_KEY: 'resolver-' + name,
    ENABLE_REQUEST_LOGGING: 'false',
  };
  const owner = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: root,
    dataDir: path.join(root, 'data'),
    environment,
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
  });
  apps.push(owner);
  await owner.start();
  const runtime = owner.app.get(AutoModeServiceCompat),
    shared = runtime.getGlobalService().getSharedServices(),
    resolver = shared.worktreeResolver;
  const status = async () => {
    const response = await fetch(
      `http://127.0.0.1:${owner.app.getHttpServer().address().port}/api/auto-mode/status`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'resolver-' + name },
        body: JSON.stringify({ projectPath: project }),
      }
    );
    return { status: response.status, body: await response.json() };
  };
  return { root, project, worktree, bin, owner, environment, runtime, shared, resolver, status };
}
it('three real native query paths and HTTP status keep app Git authority after ambient/input mutation and drain a held private child on close', async () => {
  const one = await fixture('one'),
    two = await fixture('two');
  const foreign = path.join(one.root, 'foreign-bin');
  await fs.mkdir(foreign);
  await fs.writeFile(
    path.join(foreign, 'git'),
    `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(path.join(one.root, 'foreign-executed'))},'bad');`,
    { mode: 0o700 }
  );
  vi.stubEnv('PATH', foreign);
  vi.stubEnv('HOME', foreign);
  vi.stubEnv('GIT_DIR', path.join(two.project, '.git'));
  vi.stubEnv('GIT_WORK_TREE', two.project);
  for (const f of [one, two]) {
    f.environment.HOME = '/mutated-input';
    f.environment.PATH = foreign;
    expect(await f.resolver.getCurrentBranch(f.project)).toBe(
      'owner-' + (f === one ? 'one' : 'two')
    );
    expect(
      await f.resolver.findWorktreeForBranch(
        f.project,
        'origin/feature-' + (f === one ? 'one' : 'two')
      )
    ).toBe(f.worktree);
    expect(await f.resolver.listWorktrees(f.project)).toEqual([
      { path: f.project, branch: 'owner-' + (f === one ? 'one' : 'two'), isMain: true },
      { path: f.worktree, branch: 'feature-' + (f === one ? 'one' : 'two'), isMain: false },
    ]);
    const run = f.shared.concurrencyManager.acquire({
      featureId: 'owned-primary',
      projectPath: f.project,
      isAutoMode: false,
    });
    run.branchName = 'owner-' + (f === one ? 'one' : 'two');
    expect(await f.status()).toMatchObject({
      status: 200,
      body: { runningFeatures: ['owned-primary'], runningCount: 1 },
    });
    f.shared.concurrencyManager.release(run.featureId, { expected: run });
    const calls = (await fs.readFile(path.join(f.root, 'queries.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(
      calls.every(
        (call) =>
          call.home === f.root &&
          call.path === f.bin &&
          !call.gitDir &&
          !call.gitWorkTree &&
          !call.configCount &&
          !call.backend
      )
    ).toBe(true);
  }
  await expect(fs.access(path.join(one.root, 'foreign-executed'))).rejects.toThrow();
  await fs.writeFile(path.join(one.root, 'hold-git'), 'hold');
  const query = one.resolver.listWorktrees(one.project).then(
    (value) => ({ value, error: undefined }),
    (error) => ({ error })
  );
  await vi.waitFor(async () =>
    expect(Number(await fs.readFile(path.join(one.root, 'held-pid'), 'utf8'))).toBeGreaterThan(1)
  );
  const pid = Number(await fs.readFile(path.join(one.root, 'held-pid'), 'utf8'));
  expect(one.resolver.runtimeDiagnostics().active).toBe(1);
  await one.owner.app.close();
  expect((await query).error).toBeInstanceOf(Error);
  expect(() => process.kill(pid, 0)).toThrow();
  expect(one.resolver.runtimeDiagnostics()).toEqual({ active: 0, unconfirmed: 0 });
  await expect(one.resolver.getCurrentBranch(one.project)).rejects.toThrow('shutting down');
  expect(await two.resolver.getCurrentBranch(two.project)).toBe('owner-two');
});
it('native non-repository absence remains null/[] while a failed owned query never becomes an authoritative empty result', async () => {
  const f = await fixture('failures'),
    empty = path.join(f.root, 'not-a-repository');
  await fs.mkdir(empty);
  expect(await f.resolver.getCurrentBranch(empty)).toBeNull();
  expect(await f.resolver.listWorktrees(empty)).toEqual([]);
  await fs.writeFile(path.join(f.root, 'fail-git'), 'fail');
  await expect(f.resolver.getCurrentBranch(f.project)).rejects.toThrow(
    'Git discovery query failed'
  );
  await expect(f.resolver.listWorktrees(f.project)).rejects.toThrow('Git discovery query failed');
});
it('actual owned query deadline aborts and reaps a private child rather than returning an empty branch', async () => {
  const f = await fixture('deadline');
  await fs.writeFile(path.join(f.root, 'hold-git'), 'hold');
  const resolver = new WorktreeResolver(
    null,
    { ...f.environment, HOME: f.root, PATH: f.bin },
    { timeoutMs: 150 }
  );
  await expect(resolver.getCurrentBranch(f.project)).rejects.toMatchObject({
    errorCode: 'TIMEOUT',
  });
  const pid = Number(await fs.readFile(path.join(f.root, 'held-pid'), 'utf8'));
  expect(() => process.kill(pid, 0)).toThrow();
  await resolver.close();
  expect(resolver.runtimeDiagnostics()).toEqual({ active: 0, unconfirmed: 0 });
});
it('authoritative SSH branch failure propagates without executing local Git', async () => {
  const f = await fixture('ssh-authority');
  const remote = vi
    .spyOn(FeatureWorkspaceService.prototype, 'projectBranch')
    .mockRejectedValue(
      new ExecutionEnvironmentError('SSH_PROJECT_REQUIRED', 'SSH fixture not ready')
    );
  await expect(f.resolver.getCurrentBranch(f.project)).rejects.toMatchObject({
    code: 'SSH_PROJECT_REQUIRED',
  });
  expect(remote).toHaveBeenCalledTimes(1);
  remote.mockResolvedValueOnce('authoritative-remote');
  expect(await f.resolver.getCurrentBranch(f.project)).toBe('authoritative-remote');
  vi.spyOn(EnvironmentBindingStore.prototype, 'configuration').mockResolvedValue({
    resolved: { type: 'ssh' },
  } as never);
  await expect(f.resolver.findWorktreeForBranch(f.project, 'feature')).rejects.toMatchObject({
    code: 'SSH_PROJECT_REQUIRED',
  });
  await expect(f.resolver.listWorktrees(f.project)).rejects.toMatchObject({
    code: 'SSH_PROJECT_REQUIRED',
  });
  await expect(fs.access(path.join(f.root, 'queries.jsonl'))).rejects.toThrow();
});
