import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { githubReadFixture } from '../helpers/github-read-fixture.js';
import { createNestApplication } from '../../src/main.js';

const execute = promisify(execFile);
describe.skipIf(process.platform !== 'linux')('native GitHub repository boundary', () => {
  let fixture: Awaited<ReturnType<typeof githubReadFixture>>;
  let outer: string, allowed: string, data: string;
  const owners: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  async function repository(directory: string) {
    await execute('git', ['-c', 'init.templateDir=', 'init', '--quiet', directory]);
    await execute('git', [
      '-C',
      directory,
      'remote',
      'add',
      'origin',
      'https://github.com/owned/repo.v2.git',
    ]);
  }
  async function start(root = allowed) {
    const owner = await createNestApplication({
      host: '127.0.0.1',
      port: 0,
      workingDirectory: fixture.root,
      dataDir: data,
      providerRegistrations: [],
      runStartupTasks: false,
      enableShutdownHooks: false,
      environment: {
        ...fixture.environment,
        NODE_ENV: 'test',
        AUTOMAKER_API_KEY: 'fixture',
        ENABLE_REQUEST_LOGGING: 'false',
        ALLOWED_ROOT_DIRECTORY: root,
      },
    });
    owners.push(owner);
    await owner.start();
    const port = (owner.app.getHttpServer().address() as { port: number }).port;
    return async (projectPath: string, route = 'check-remote', fields: object = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/github/${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'fixture' },
        body: JSON.stringify({ projectPath, ...fields }),
      });
      return { status: response.status, body: await response.json() };
    };
  }
  beforeEach(async () => {
    fixture = await githubReadFixture();
    outer = path.join(fixture.root, 'outer');
    allowed = path.join(outer, 'allowed');
    data = path.join(fixture.root, 'data');
    await mkdir(allowed, { recursive: true });
    await mkdir(data);
    await repository(outer);
  });
  afterEach(async () => {
    try {
      for (const owner of owners.splice(0)) await owner.app.close();
    } finally {
      await fixture.cleanup();
    }
  });

  it('does not inherit a parent repository outside the configured allowed root', async () => {
    const post = await start();
    expect(await post(allowed)).toMatchObject({
      status: 200,
      body: { success: true, hasGitHubRemote: false, owner: null, repo: null },
    });
    await expect(fixture.calls()).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects an external gitfile before starting a GitHub CLI process', async () => {
    await writeFile(path.join(allowed, '.git'), `gitdir: ${path.join(outer, '.git')}\n`);
    const post = await start();
    for (const [route, fields] of [
      ['check-remote', {}],
      ['issues', {}],
      ['prs', {}],
      ['issue-comments', { issueNumber: 12 }],
      ['pr-review-comments', { prNumber: 12 }],
      ['resolve-pr-comment', { threadId: 'PRRT_owned', resolve: true }],
    ] as const) {
      const response = await post(allowed, route, fields);
      expect(response).toMatchObject({ status: 403, body: { errorCode: 'FORBIDDEN' } });
      expect(JSON.stringify(response.body)).not.toContain(fixture.root);
    }
    await expect(fixture.calls()).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps owners isolated and permits a repository plus nested directories inside its root', async () => {
    await repository(allowed);
    const nested = path.join(allowed, '..literal', 'child');
    await mkdir(nested, { recursive: true });
    const restricted = await start(data);
    const permitted = await start(allowed);
    expect(await restricted(nested)).toMatchObject({
      status: 403,
      body: { errorCode: 'FORBIDDEN' },
    });
    expect(await permitted(nested)).toMatchObject({
      status: 200,
      body: { success: true, hasGitHubRemote: true, owner: 'owned', repo: 'repo.v2' },
    });
    expect(await permitted(path.relative(fixture.root, allowed))).toMatchObject({
      status: 200,
      body: { hasGitHubRemote: true },
    });
    const calls = await fixture.calls();
    expect(calls).toHaveLength(2);
    expect(calls[0].cwd).toBe(nested);
    expect(await readFile(path.join(allowed, '.git/config'), 'utf8')).toContain(
      'github.com/owned/repo.v2.git'
    );
  });

  async function commitEmpty(directory: string) {
    await execute('git', [
      '-C',
      directory,
      '-c',
      'user.name=Owned Fixture',
      '-c',
      'user.email=fixture@example.test',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '--quiet',
      '--allow-empty',
      '-m',
      'owned fixture',
    ]);
  }
  async function linkedTree(source: string, target: string) {
    await commitEmpty(source);
    await execute('git', [
      '-C',
      source,
      '-c',
      'core.hooksPath=/dev/null',
      'worktree',
      'add',
      '--quiet',
      '--detach',
      target,
    ]);
  }

  it('permits a real linked worktree and review mutation when all administration is authorized', async () => {
    const source = path.join(allowed, 'main');
    const linked = path.join(allowed, 'linked');
    await repository(source);
    await linkedTree(source, linked);
    const post = await start();
    expect(await post(linked)).toMatchObject({ status: 200, body: { hasGitHubRemote: true } });
    expect(
      await post(linked, 'resolve-pr-comment', { threadId: 'PRRT_owned', resolve: true })
    ).toMatchObject({
      status: 200,
      body: { success: true, isResolved: true },
    });
    const calls = await fixture.calls();
    expect(calls.filter((call) => call.input.includes('mutation ResolveThread'))).toHaveLength(1);
  });

  it('rejects a real linked worktree whose shared repository is outside its allowed root', async () => {
    const linked = path.join(allowed, 'linked');
    await linkedTree(outer, linked);
    const post = await start();
    expect(await post(linked)).toMatchObject({ status: 403, body: { errorCode: 'FORBIDDEN' } });
    await expect(fixture.calls()).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a commondir escape even if the worktree gitfile points inside the allowed root', async () => {
    const admin = path.join(allowed, 'admin');
    await mkdir(admin);
    await writeFile(path.join(admin, 'HEAD'), 'ref: refs/heads/main\n');
    await writeFile(path.join(admin, 'commondir'), `${path.join(outer, '.git')}\n`);
    await writeFile(path.join(allowed, '.git'), 'gitdir: admin\n');
    const post = await start();
    expect(await post(allowed)).toMatchObject({ status: 403, body: { errorCode: 'FORBIDDEN' } });
    await expect(fixture.calls()).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves the data-directory exception for repository discovery', async () => {
    await repository(data);
    expect(await (await start())(data)).toMatchObject({
      status: 200,
      body: { hasGitHubRemote: true, owner: 'owned', repo: 'repo.v2' },
    });
  });

  it('discovers a real bare repository without selecting the containing working tree', async () => {
    const bare = path.join(allowed, 'bare.git');
    await execute('git', ['-c', 'init.templateDir=', 'init', '--quiet', '--bare', bare]);
    await execute('git', [
      '--git-dir',
      bare,
      'remote',
      'add',
      'origin',
      'https://github.com/owned/repo.v2.git',
    ]);
    expect(await (await start())(bare)).toMatchObject({
      status: 200,
      body: { hasGitHubRemote: true },
    });
  });

  it('reports malformed metadata as unavailable, never as proof of no remote', async () => {
    await writeFile(path.join(allowed, '.git'), 'not a gitfile');
    const response = await (await start())(allowed);
    expect(response).toMatchObject({ status: 503, body: { errorCode: 'UNAVAILABLE' } });
    expect(JSON.stringify(response.body)).not.toContain(fixture.root);
    await expect(fixture.calls()).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
