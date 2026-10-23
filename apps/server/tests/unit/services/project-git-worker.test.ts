import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { LocalExecutionEnvironment } from '@/services/execution-environment/local.js';
import { PROJECT_GIT_WORKER } from '@/services/execution-environment/project-git-worker.js';
import { nodeCommand } from '@/services/execution-environment/ssh-transport.js';

describe.skipIf(process.platform !== 'linux')('fixed target-side Git worker with real Git', () => {
  let root: string, environment: LocalExecutionEnvironment;
  const active = () => new AbortController().signal;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-git-worker-'));
    environment = await LocalExecutionEnvironment.create(root);
    await fs.writeFile(path.join(root, '.gitignore'), '.worktrees/\n.automaker/\n');
    await fs.writeFile(path.join(root, 'source.txt'), 'base\n');
    expect(
      (
        await environment.exec(
          'git init -qb main && git add . && git -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm base',
          active()
        )
      ).exitCode
    ).toBe(0);
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  const run = async (action: string, body: object = {}, cwd = root) => {
    const result = await environment.exec(
      nodeCommand(PROJECT_GIT_WORKER, [
        JSON.stringify({ root, cwd, controllerRoot: root, action, body }),
      ]),
      active()
    );
    return JSON.parse(result.output);
  };
  it('returns correctly delimited status/diffs for spaces, quotes, newlines and literal pathspec names', async () => {
    for (const name of ['space name.txt', "quote'file.txt", 'line\nfile.txt', ':(glob)*'])
      await fs.writeFile(path.join(root, name), 'content\n');
    await fs.writeFile(path.join(root, 'source.txt'), 'changed\n');
    const status = await run('enhanced-status');
    expect(status.success).toBe(true);
    expect(status.files.map((file: { path: string }) => file.path)).toEqual(
      expect.arrayContaining([
        'space name.txt',
        "quote'file.txt",
        'line\nfile.txt',
        ':(glob)*',
        'source.txt',
      ])
    );
    const staged = await run('stage-files', { operation: 'stage', files: [':(glob)*'] });
    expect(staged.success).toBe(true);
    const selected = await run('check-changes');
    expect(selected.result.staged).toEqual([':(glob)*']);
    const diff = await run('diffs');
    expect(diff.diff).toContain('+changed');
    expect(diff.diff).toContain('+content');
  });
  it('stages, unstages and commits selected paths with a literal multiline message', async () => {
    await fs.writeFile(path.join(root, 'source.txt'), 'changed\n');
    await fs.writeFile(path.join(root, 'unselected.txt'), 'leave untracked');
    expect(
      (await run('stage-files', { operation: 'stage', files: ['source.txt'] })).result.filesCount
    ).toBe(1);
    expect(
      (await run('stage-files', { operation: 'unstage', files: ['source.txt'] })).success
    ).toBe(true);
    const message = 'Literal $(touch leaked)\n\nBody';
    expect((await run('commit', { message, files: ['source.txt'] })).result.committed).toBe(true);
    await expect(fs.stat(path.join(root, 'leaked'))).rejects.toThrow();
    const log = await run('commit-log');
    expect(log.result.commits[0]).toMatchObject({
      subject: 'Literal $(touch leaked)',
      body: 'Body\n',
      files: ['source.txt'],
    });
    expect((await run('check-changes')).result.untracked).toEqual(['unselected.txt']);
  });
  it.each(['../outside', '/tmp/absolute', '.git/config', 'nested/../../escape'])(
    'rejects unsafe file paths %s',
    async (file) => {
      expect(await run('stage-files', { operation: 'stage', files: [file] })).toMatchObject({
        success: false,
        code: 'GIT_FILE_INVALID',
      });
    }
  );
  it('refuses following a file symlink out of the worktree', async () => {
    await fs.symlink('/etc', path.join(root, 'outside'));
    expect(await run('file-diff', { filePath: 'outside/passwd' })).toMatchObject({
      success: false,
      code: 'GIT_FILE_INVALID',
    });
  });
  it('creates a separate worktree from a fixed local base without fetch or init script, and can query it by branch', async () => {
    const created = await run('create', { branchName: 'feature/ui', baseBranch: 'main' });
    expect(created.success).toBe(true);
    expect(created.initScriptSkipped).toBe(true);
    const list = await run('list');
    expect(list.worktrees).toHaveLength(2);
    expect((await run('info', { workspaceBranch: 'feature/ui' })).worktreePath).toBe(
      created.worktree.path
    );
    expect((await run('create', { branchName: 'feature/ui' })).worktree.isNew).toBe(false);
    expect((await run('status', { workspaceBranch: 'missing' })).code).toBe(
      'GIT_WORKSPACE_REQUIRED'
    );
  });
  it('lists cached remote refs without running fetch or credential helpers', async () => {
    await environment.exec(
      "git remote add origin https://example.invalid/repo && git config credential.helper '!touch credential-leak'",
      active()
    );
    const branches = await run('list-branches', { includeRemote: true });
    expect(branches.success).toBe(true);
    expect(branches.remoteRefsCached).toBe(true);
    expect((await run('list-remotes')).result.remotes[0].name).toBe('origin');
    await expect(fs.stat(path.join(root, 'credential-leak'))).rejects.toThrow();
  });
  it('round-trips selected changes through the fixed stash API', async () => {
    await fs.writeFile(path.join(root, 'source.txt'), 'stashed\n');
    expect(
      (await run('stash-push', { message: 'target stash', files: ['source.txt'] })).result
    ).toMatchObject({ stashed: true, branch: 'main', message: 'target stash' });
    expect(await fs.readFile(path.join(root, 'source.txt'), 'utf8')).toBe('base\n');
    expect((await run('stash-list')).result).toMatchObject({
      total: 1,
      stashes: [expect.objectContaining({ index: 0, message: 'On main: target stash' })],
    });
    expect((await run('stash-apply', { stashIndex: 0 })).result).toMatchObject({
      applied: true,
      hasConflicts: false,
    });
    expect(await fs.readFile(path.join(root, 'source.txt'), 'utf8')).toBe('stashed\n');
    expect((await run('stash-drop', { stashIndex: 0 })).result.dropped).toBe(true);
    expect((await run('stash-list')).result.total).toBe(0);
  });
  it('validates remote configuration inside the target worker', async () => {
    expect(
      await run('add-remote', { remoteName: '--upload-pack', remoteUrl: 'https://example.invalid' })
    ).toMatchObject({ success: false, code: 'GIT_REMOTE_INVALID' });
    const added = await run('add-remote', {
      remoteName: 'upstream',
      remoteUrl: 'https://127.0.0.1:1/repository.git',
    });
    expect(added).toMatchObject({
      success: true,
      result: { remoteName: 'upstream', fetched: false },
    });
  });
  it('creates and switches branches from cached refs without fetching', async () => {
    const created = await run('checkout-branch', {
      branchName: 'feature/branch-api',
      baseBranch: 'main',
    });
    expect(created.result).toMatchObject({
      previousBranch: 'main',
      newBranch: 'feature/branch-api',
    });
    const switched = await run('switch-branch', { branchName: 'main' });
    expect(switched.result).toMatchObject({
      previousBranch: 'feature/branch-api',
      currentBranch: 'main',
    });
  });
  it('discards selected paths before an explicit full cleanup', async () => {
    await fs.writeFile(path.join(root, 'source.txt'), 'changed\n');
    await fs.writeFile(path.join(root, 'untracked.txt'), 'untracked\n');
    expect((await run('discard-changes', { files: ['source.txt'] })).result).toMatchObject({
      discarded: true,
      filesDiscarded: 1,
      filesRemaining: 1,
    });
    expect(await fs.readFile(path.join(root, 'source.txt'), 'utf8')).toBe('base\n');
    expect((await run('discard-changes')).result).toMatchObject({
      discarded: true,
      filesRemaining: 0,
    });
    await expect(fs.stat(path.join(root, 'untracked.txt'))).rejects.toThrow();
  });
  it('runs explicit network operations against the selected target remote', async () => {
    const bare = path.join(root, 'remote.git');
    await fs.appendFile(path.join(root, '.git', 'info', 'exclude'), '\nremote.git/\n');
    expect((await environment.exec(`git init --bare -q ${bare}`, active())).exitCode).toBe(0);
    expect((await environment.exec(`git remote add origin ${bare}`, active())).exitCode).toBe(0);

    expect((await run('push', { remote: 'origin' })).result).toMatchObject({
      branch: 'main',
      pushed: true,
    });
    expect((await run('pull', { remote: 'origin' })).result).toMatchObject({
      branch: 'main',
      pulled: true,
      hasConflicts: false,
    });
    expect((await run('sync', { remote: 'origin' })).result).toMatchObject({
      branch: 'main',
      pulled: true,
      pushed: true,
    });
    expect((await run('checkout-branch', { branchName: 'rebase-me' })).success).toBe(true);
    expect((await run('rebase', { ontoBranch: 'main' })).result).toMatchObject({
      branch: 'rebase-me',
      ontoBranch: 'main',
    });
  });
  it('does not invoke external diff commands or fsmonitor hooks', async () => {
    await environment.exec(
      "git config diff.external 'touch diff-leak' && git config core.fsmonitor 'touch monitor-leak'",
      active()
    );
    await fs.writeFile(path.join(root, 'source.txt'), 'changed');
    expect((await run('diffs')).success).toBe(true);
    for (const name of ['diff-leak', 'monitor-leak'])
      await expect(fs.stat(path.join(root, name))).rejects.toThrow();
  });
});
