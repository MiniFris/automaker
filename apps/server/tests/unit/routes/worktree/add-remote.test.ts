import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNativeLocalWorktree } from '../../../helpers/native-local-worktree.js';
import { ProjectGitService } from '@/services/execution-environment/project-git.js';
let fixture: Awaited<ReturnType<typeof createNativeLocalWorktree>>;
beforeEach(async () => {
  fixture = await createNativeLocalWorktree();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fixture?.close();
});
const invalid = [
  { remoteName: 'upstream', remoteUrl: 'https://example.invalid/repo' },
  { worktreePath: 'PROJECT', remoteUrl: 'https://example.invalid/repo' },
  { worktreePath: 'PROJECT', remoteName: 'upstream' },
  ...['', '-bad', '.bad', 'bad name', 'x'.repeat(251)].map((remoteName) => ({
    worktreePath: 'PROJECT',
    remoteName,
    remoteUrl: 'https://example.invalid/repo',
  })),
  ...['', 'not-a-url', 'https://example.invalid/' + 'x'.repeat(2049)].map((remoteUrl) => ({
    worktreePath: 'PROJECT',
    remoteName: 'upstream',
    remoteUrl,
  })),
];
it.each(invalid)('rejects invalid remote input %# before mutating actual config', async (body) => {
  const response = await fixture.post('add-remote', {
    ...body,
    ...('worktreePath' in body ? { worktreePath: fixture.project } : {}),
  });
  expect(response.status).toBe(400);
  expect(response.body.success).toBe(false);
  expect(await fixture.git(['remote'])).toBe('');
});
it.each([
  'https://example.invalid/repo',
  'http://example.invalid/repo',
  'git@example.invalid:org/repo.git',
  'git://example.invalid/repo',
  'ssh://git@example.invalid/repo',
])('accepts supported URL %s without contacting a remote', async (remoteUrl) => {
  const response = await fixture.post('add-remote', {
    worktreePath: fixture.project,
    remoteName: 'upstream',
    remoteUrl,
  });
  expect(response.status).toBe(200);
  expect(response.body.result).toMatchObject({ remoteName: 'upstream', remoteUrl, fetched: false });
  expect(await fixture.git(['remote', 'get-url', 'upstream'])).toBe(remoteUrl);
});
it('accepts valid remote names and returns REMOTE_EXISTS without replacement', async () => {
  for (const remoteName of ['upstream2', 'my_remote.v1', 'origin-test']) {
    expect(
      (
        await fixture.post('add-remote', {
          worktreePath: fixture.project,
          remoteName,
          remoteUrl: 'https://example.invalid/original',
        })
      ).status
    ).toBe(200);
    const duplicate = await fixture.post('add-remote', {
      worktreePath: fixture.project,
      remoteName,
      remoteUrl: 'https://example.invalid/replacement',
    });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.code).toBe('REMOTE_EXISTS');
    expect(await fixture.git(['remote', 'get-url', remoteName])).toBe(
      'https://example.invalid/original'
    );
  }
});
it('uses the selected cwd and reports successful fetch from the explicit offline transport', async () => {
  await fixture.gitBehavior({ fetchExit: 0 });
  const result = await fixture.post('add-remote', {
    worktreePath: fixture.project,
    remoteName: 'upstream',
    remoteUrl: 'https://example.invalid/repo',
  });
  expect(result.status).toBe(200);
  expect(result.body.result.fetched).toBe(true);
  const calls = (await fs.readFile(path.join(fixture.root, 'git-calls.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const add = calls.find((call) => call.command === 'remote' && call.args[0] === 'add');
  expect(add.argv[add.argv.indexOf('-C') + 1]).toBe(fixture.project);
  expect(calls.some((call) => call.command === 'fetch' && call.args[0] === 'upstream')).toBe(true);
});
it('retains a successfully added remote when fetch fails', async () => {
  const response = await fixture.post('add-remote', {
    worktreePath: fixture.project,
    remoteName: 'upstream',
    remoteUrl: 'https://example.invalid/repo',
  });
  expect(response.status).toBe(200);
  expect(response.body.result.fetched).toBe(false);
  expect(response.body.result.message).toContain('fetch failed');
  expect(await fixture.git(['remote'])).toBe('upstream');
});
it('reports remote-add failure without exposing subprocess output or changing config', async () => {
  await fixture.gitBehavior({ addFailure: true });
  const response = await fixture.post('add-remote', {
    worktreePath: fixture.project,
    remoteName: 'upstream',
    remoteUrl: 'https://example.invalid/repo',
  });
  expect(response.status).toBe(500);
  expect(response.body.success).toBe(false);
  expect(JSON.stringify(response.body)).not.toContain('private remote-add failure');
  expect(await fixture.git(['remote'])).toBe('');
});
it('allows atomic remote-add to decide existence when the preliminary listing fails', async () => {
  await fixture.gitBehavior({ remoteCheckFailures: 1 });
  const response = await fixture.post('add-remote', {
    worktreePath: fixture.project,
    remoteName: 'upstream',
    remoteUrl: 'https://example.invalid/repo',
  });
  expect(response.status).toBe(200);
  expect(await fixture.git(['remote'])).toBe('upstream');
});
it('safely reports a non-Error port failure without a host command', async () => {
  const target = fixture.runtime.app.get(ProjectGitService);
  vi.spyOn(target, 'run').mockRejectedValue('private non-error failure');
  const response = await fixture.post('add-remote', {
    worktreePath: fixture.project,
    remoteName: 'upstream',
    remoteUrl: 'https://example.invalid/repo',
  });
  expect(response.status).toBe(500);
  expect(response.body.error).toBe('Internal server error.');
  expect(await fixture.git(['remote'])).toBe('');
});
