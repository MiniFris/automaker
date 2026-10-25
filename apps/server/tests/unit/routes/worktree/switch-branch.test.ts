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
it.each([undefined, '-flag', '--option', 'branch name with spaces'])(
  'rejects an invalid native branch %s before changing checkout',
  async (branchName) => {
    const response = await fixture.post('switch-branch', {
      worktreePath: fixture.project,
      ...(branchName === undefined ? {} : { branchName }),
    });
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(await fixture.git(['branch', '--show-current'])).toBe('main');
  }
);
it('switches with only untracked files without creating a stash or changing their bytes', async () => {
  await fixture.git(['branch', 'feature/test']);
  await fs.writeFile(path.join(fixture.project, 'untracked.txt'), 'untracked bytes');
  const target = await fixture.inspect();
  const response = await fixture.post('switch-branch', {
    worktreePath: fixture.project,
    branchName: 'feature/test',
    environmentTargetId: target.targetId,
  });
  expect(response.status).toBe(200);
  expect(response.body.result).toMatchObject({
    previousBranch: 'main',
    currentBranch: 'feature/test',
    stashedChanges: false,
    hasConflicts: false,
  });
  expect(await fixture.git(['stash', 'list'])).toBe('');
  expect(await fs.readFile(path.join(fixture.project, 'untracked.txt'), 'utf8')).toBe(
    'untracked bytes'
  );
});
it('stashes tracked modifications, restores them after switching and leaves no temporary stash', async () => {
  await fixture.git(['branch', 'feature/test']);
  await fs.writeFile(path.join(fixture.project, 'source.txt'), 'tracked modification\n');
  const target = await fixture.inspect();
  const response = await fixture.post('switch-branch', {
    worktreePath: fixture.project,
    branchName: 'feature/test',
    environmentTargetId: target.targetId,
  });
  expect(response.status).toBe(200);
  expect(response.body.result).toMatchObject({
    currentBranch: 'feature/test',
    stashedChanges: true,
    hasConflicts: false,
  });
  expect(await fs.readFile(path.join(fixture.project, 'source.txt'), 'utf8')).toBe(
    'tracked modification\n'
  );
  expect(await fixture.git(['stash', 'list'])).toBe('');
});
