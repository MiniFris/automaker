import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createNativeLocalWorktree } from '../../../helpers/native-local-worktree.js';
let fixture: Awaited<ReturnType<typeof createNativeLocalWorktree>>;
beforeEach(async () => {
  fixture = await createNativeLocalWorktree();
});
afterEach(async () => {
  await fixture?.close();
});
const list = async () => {
  const response = await fixture.post('list', {
    projectPath: fixture.project,
    includeDetails: true,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body;
};
const record = (directory: string, branch?: string) =>
  `worktree ${directory}\0HEAD abcdef\0${branch ? 'branch refs/heads/' + branch : 'detached'}\0\0`;
async function detach(directory: string, state?: string, branch = 'feature/recovered') {
  await fixture.git(['checkout', '--detach', 'HEAD'], directory);
  if (state) {
    const gitdir = await fixture.git(['rev-parse', '--git-dir'], directory);
    await fs.mkdir(path.join(gitdir, state), { recursive: true });
    await fs.writeFile(path.join(gitdir, state, 'head-name'), 'refs/heads/' + branch + '\n');
  }
}
async function metadata(branch: string, value: unknown) {
  const file = path.join(
    fixture.project,
    '.automaker',
    'worktrees',
    branch.replaceAll('/', '-'),
    'worktree.json'
  );
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value));
  return file;
}
it('includes normal worktrees and identifies the actual main/current checkout', async () => {
  const child = await fixture.addWorktree('feature/normal');
  const value = await list();
  expect(value.worktrees.map((entry: any) => entry.branch)).toEqual(['main', 'feature/normal']);
  expect(value.worktrees.find((entry: any) => entry.path === fixture.project)).toMatchObject({
    isMain: true,
    isCurrent: true,
  });
  expect(value.worktrees.find((entry: any) => entry.path === child)).toMatchObject({
    isMain: false,
    isCurrent: false,
  });
});
it.each(['rebase-merge', 'rebase-apply'])(
  'recovers detached branches from %s and strips refs/heads without marking current',
  async (state) => {
    const child = await fixture.addWorktree('feature/recovered');
    await detach(child, state);
    const value = await list();
    expect(value.worktrees.find((entry: any) => entry.path === child)).toMatchObject({
      branch: 'feature/recovered',
      isCurrent: false,
      isMain: false,
    });
  }
);
it('keeps a branch during merge state, which does not detach HEAD', async () => {
  const child = await fixture.addWorktree('feature/merge');
  const gitdir = await fixture.git(['rev-parse', '--git-dir'], child);
  await fs.writeFile(
    path.join(gitdir, 'MERGE_HEAD'),
    (await fixture.git(['rev-parse', 'HEAD'])) + '\n'
  );
  expect((await list()).worktrees.find((entry: any) => entry.path === child).branch).toBe(
    'feature/merge'
  );
});
it('retains a registered detached worktree when branch recovery has no answer', async () => {
  const child = await fixture.addWorktree('feature/detached');
  await detach(child);
  expect((await list()).worktrees.find((entry: any) => entry.path === child)).toMatchObject({
    branch: '(detached)',
    isCurrent: false,
  });
});
it('does not report a recovered detached branch as current even when it equals main', async () => {
  const child = await fixture.addWorktree('feature/other');
  await detach(child, 'rebase-merge', 'main');
  expect((await list()).worktrees.find((entry: any) => entry.path === child)).toMatchObject({
    branch: 'main',
    isCurrent: false,
  });
});
it('omits vanished detached paths without inventing removals or pruning Git state', async () => {
  const child = await fixture.addWorktree('feature/missing');
  await detach(child);
  await fs.rm(child, { recursive: true, force: true });
  const value = await list();
  expect(value.worktrees).toHaveLength(1);
  expect(value.removedWorktrees).toEqual([]);
  expect(await fixture.git(['worktree', 'list', '--porcelain'])).toContain(child);
});
it('handles mixed regular and detached entries while retaining main after a detached first record', async () => {
  const detached = await fixture.addWorktree('feature/detached');
  await detach(detached);
  const normal = await fixture.addWorktree('feature/normal');
  await fixture.gitBehavior({
    porcelain:
      record(detached) + record(fixture.project, 'main') + record(normal, 'feature/normal'),
  });
  const value = await list();
  expect(value.worktrees).toHaveLength(3);
  expect(value.worktrees.find((entry: any) => entry.path === fixture.project)).toMatchObject({
    branch: 'main',
    isMain: true,
    isCurrent: true,
  });
  expect(value.worktrees.filter((entry: any) => entry.isMain)).toHaveLength(1);
});
it('discovers a valid same-repository worktree missing from the listing', async () => {
  const child = await fixture.addWorktree('feature/discovered');
  await fixture.gitBehavior({ porcelain: record(fixture.project, 'main') });
  expect((await list()).worktrees.find((entry: any) => entry.path === child)).toMatchObject({
    branch: 'feature/discovered',
    isMain: false,
  });
});
it('recovers a discovered detached rebase and skips discovered unknown/non-Git directories', async () => {
  const child = await fixture.addWorktree('feature/discovered');
  await detach(child, 'rebase-apply', 'feature/discovered');
  const unknown = await fixture.addWorktree('feature/unknown');
  await detach(unknown);
  await fs.mkdir(path.join(fixture.project, '.worktrees', 'not-a-repo'));
  await fixture.gitBehavior({ porcelain: record(fixture.project, 'main') });
  const value = await list();
  expect(value.worktrees.find((entry: any) => entry.path === child).branch).toBe(
    'feature/discovered'
  );
  expect(value.worktrees.some((entry: any) => entry.path === unknown)).toBe(false);
  expect(value.worktrees.some((entry: any) => entry.path.endsWith('not-a-repo'))).toBe(false);
});
it('preserves a manually tracked PR when branch lookup finds a different one', async () => {
  const child = await fixture.addWorktree('feature-a');
  await fixture.git(['remote', 'add', 'origin', 'https://github.com/org/repo.git']);
  const manual = {
    number: 99,
    title: 'Manual override PR',
    url: 'https://github.com/org/repo/pull/99',
    state: 'OPEN',
    createdAt: '2026-01-01',
  };
  const file = await metadata('feature-a', {
    branch: 'feature-a',
    createdAt: 'legacy timestamp',
    pr: manual,
    extension: { kept: true },
  });
  await fixture.github({
    list: [
      {
        number: 42,
        title: 'Branch PR',
        url: 'https://github.com/org/repo/pull/42',
        state: 'OPEN',
        headRefName: 'feature-a',
        createdAt: '2026-01-02',
      },
    ],
  });
  expect((await list()).worktrees.find((entry: any) => entry.path === child).pr).toEqual(manual);
  expect(JSON.parse(await fs.readFile(file, 'utf8')).pr).toEqual(manual);
});
it('refreshes matching PR fields atomically while retaining other metadata', async () => {
  const child = await fixture.addWorktree('feature-a');
  await fixture.git(['remote', 'add', 'origin', 'https://github.com/org/repo.git']);
  const file = await metadata('feature-a', {
    branch: 'feature-a',
    createdAt: 'legacy timestamp',
    pr: { number: 99, title: 'Old' },
    extension: { kept: true },
  });
  const fresh = {
    number: 99,
    title: 'Fresh title',
    url: 'https://github.com/org/repo/pull/99',
    state: 'MERGED',
    headRefName: 'feature-a',
    createdAt: '2026-01-02',
  };
  await fixture.github({ list: [fresh] });
  expect((await list()).worktrees.find((entry: any) => entry.path === child).pr).toMatchObject({
    number: 99,
    title: 'Fresh title',
    state: 'MERGED',
  });
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  expect(saved).toMatchObject({
    createdAt: 'legacy timestamp',
    extension: { kept: true },
    pr: { number: 99, title: 'Fresh title' },
  });
  expect((await fs.readdir(path.dirname(file))).filter((name) => name.endsWith('.tmp'))).toEqual(
    []
  );
});
it('does not replace corrupt metadata when a mutation cannot establish its prior state', async () => {
  const file = await metadata('main', {});
  await fs.writeFile(file, '{ corrupt metadata');
  const response = await fixture.post('update-pr-number', {
    worktreePath: fixture.project,
    prNumber: 7,
  });
  expect(response.status).toBe(400);
  expect(response.body.code).toBe('GIT_METADATA_INVALID');
  expect(await fs.readFile(file, 'utf8')).toBe('{ corrupt metadata');
  expect((await list()).worktrees.some((entry: any) => entry.branch === 'main')).toBe(true);
});
it('rejects metadata symlinks without changing their target', async () => {
  const file = await metadata('main', {}),
    outside = path.join(fixture.root, 'outside.json');
  await fs.writeFile(outside, 'outside-owned-by-another-resource');
  await fs.rm(file);
  await fs.symlink(outside, file);
  const response = await fixture.post('update-pr-number', {
    worktreePath: fixture.project,
    prNumber: 7,
  });
  expect(response.status).toBe(400);
  expect(response.body.code).toBe('GIT_METADATA_INVALID');
  expect(await fs.readFile(outside, 'utf8')).toBe('outside-owned-by-another-resource');
});
