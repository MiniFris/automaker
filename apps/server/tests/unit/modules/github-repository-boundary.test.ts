import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuntimePathsService, parseRuntimeConfig } from '../../../src/core/config/index.js';
import { GithubRepositoryBoundary } from '../../../src/modules/github/github-repository-boundary.js';
import { SecurityService } from '../../../src/core/security/security.service.js';

describe('application-owned GitHub repository boundary', () => {
  let root: string, allowed: string, data: string, outside: string;
  const boundary = (directory: string | undefined = allowed) =>
    new GithubRepositoryBoundary(
      new SecurityService(
        new RuntimePathsService(
          parseRuntimeConfig(
            {
              DATA_DIR: data,
              ALLOWED_ROOT_DIRECTORY: directory,
            },
            root
          ),
          root
        )
      )
    );
  const directory = (candidate: string) => mkdir(candidate, { recursive: true });
  const gitDirectory = async (candidate: string) => {
    await directory(candidate);
    await writeFile(path.join(candidate, 'HEAD'), 'ref: refs/heads/main\n');
  };
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'automaker-github-boundary-'));
    allowed = path.join(root, 'allowed');
    data = path.join(root, 'data');
    outside = path.join(root, 'outside');
    await Promise.all([allowed, data, outside].map(directory));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('retains explicit unrestricted behavior without requiring the candidate to exist', () => {
    const unrestricted = new GithubRepositoryBoundary(
      new SecurityService(
        new RuntimePathsService(parseRuntimeConfig({ DATA_DIR: data }, root), root)
      )
    );
    expect(unrestricted.resolve(path.join(outside, 'not-created'))).toBeUndefined();
  });
  it('discovers in-root ancestors including directory names starting with two dots', async () => {
    await gitDirectory(path.join(allowed, '.git'));
    const nested = path.join(allowed, '..literal', 'nested');
    await directory(nested);
    expect(boundary().resolve(nested)).toEqual({
      cwd: nested,
      gitDirectory: path.join(allowed, '.git'),
      commonDirectory: path.join(allowed, '.git'),
      workTree: allowed,
    });
  });
  it('resolves relative project paths against the application working directory, not process cwd', async () => {
    await gitDirectory(path.join(allowed, '.git'));
    expect(boundary().resolve('allowed')).toMatchObject({ cwd: allowed, workTree: allowed });
  });
  it('does not search outside the root or accept a sibling lexical prefix', async () => {
    await gitDirectory(path.join(root, '.git'));
    const sibling = path.join(root, 'allowed-sibling');
    await directory(sibling);
    expect(boundary().resolve(allowed)).toBeNull();
    expect(() => boundary().resolve(sibling)).toThrow(
      expect.objectContaining({ errorCode: 'FORBIDDEN' })
    );
  });
  it('preserves the DATA_DIR exception and allows authorized shared administration there', async () => {
    const admin = path.join(data, 'admin');
    await gitDirectory(admin);
    await writeFile(path.join(allowed, '.git'), `gitdir: ${admin}\n`);
    expect(boundary().resolve(allowed)).toMatchObject({
      gitDirectory: admin,
      commonDirectory: admin,
      workTree: allowed,
    });
    await gitDirectory(path.join(data, '.git'));
    expect(boundary().resolve(data)).toMatchObject({ workTree: data });
  });
  it('does not accidentally narrow an overlapping data directory boundary', async () => {
    await gitDirectory(path.join(allowed, '.git'));
    data = path.join(allowed, 'data');
    await directory(data);
    expect(boundary().resolve(data)).toMatchObject({ workTree: allowed });
  });
  it('supports relative gitfiles and relative common directories inside the policy', async () => {
    const admin = path.join(allowed, 'metadata', 'worktrees', 'owned');
    await gitDirectory(admin);
    await writeFile(path.join(allowed, '.git'), 'gitdir: metadata/worktrees/owned\n');
    await writeFile(path.join(admin, 'commondir'), '../..\n');
    expect(boundary().resolve(allowed)).toMatchObject({
      gitDirectory: admin,
      commonDirectory: path.join(allowed, 'metadata'),
      workTree: allowed,
    });
  });
  it('rejects an external gitfile target without exposing that path', async () => {
    await gitDirectory(outside);
    await writeFile(path.join(allowed, '.git'), `gitdir: ${outside}\n`);
    let failure: unknown;
    try {
      boundary().resolve(allowed);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ errorCode: 'FORBIDDEN', statusCode: 403 });
    expect(String(failure)).not.toContain(root);
  });
  it('rejects an external common directory', async () => {
    const admin = path.join(allowed, '.git');
    await gitDirectory(admin);
    await writeFile(path.join(admin, 'commondir'), `${outside}\n`);
    expect(() => boundary().resolve(allowed)).toThrow(
      expect.objectContaining({ errorCode: 'FORBIDDEN' })
    );
  });
  it('fails closed for a missing candidate or dangling metadata without raw filesystem diagnostics', async () => {
    for (const candidate of [path.join(allowed, 'missing'), allowed]) {
      await writeFile(path.join(allowed, '.git'), 'gitdir: missing-metadata\n');
      let failure: unknown;
      try {
        boundary().resolve(candidate);
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({ errorCode: 'UNAVAILABLE', statusCode: 503 });
      expect(String(failure)).not.toContain(root);
    }
  });
  it.each([
    '',
    'gitdir:',
    'gitdir: ',
    'unexpected-header',
    'gitdir: bad\0path',
    'gitdir: first\nsecond',
    'x'.repeat(8193),
  ])('rejects malformed or oversized pointer case %#', async (value) => {
    await writeFile(path.join(allowed, '.git'), value);
    expect(() => boundary().resolve(allowed)).toThrow(
      expect.objectContaining({ errorCode: 'UNAVAILABLE' })
    );
  });
  it('recognizes bare repositories rather than silently selecting a containing repository', async () => {
    await gitDirectory(path.join(allowed, '.git'));
    const bare = path.join(allowed, 'bare');
    await gitDirectory(bare);
    await Promise.all(['objects', 'refs'].map((name) => directory(path.join(bare, name))));
    expect(boundary().resolve(bare)).toEqual({
      cwd: bare,
      gitDirectory: bare,
      commonDirectory: bare,
      workTree: undefined,
    });
  });
  it('keeps a not-yet-created configured root restrictive', async () => {
    const missingRoot = path.join(root, 'future', 'projects');
    const owner = boundary(missingRoot);
    expect(() => owner.resolve(outside)).toThrow(
      expect.objectContaining({ errorCode: 'FORBIDDEN' })
    );
    await gitDirectory(path.join(missingRoot, '.git'));
    expect(owner.resolve(missingRoot)).toMatchObject({ workTree: missingRoot });
  });
  it('caps ancestor discovery instead of silently treating exhaustion as no repository', async () => {
    const nested = path.join(allowed, ...Array.from({ length: 257 }, () => 'a'));
    await directory(nested);
    expect(() => boundary().resolve(nested)).toThrow(
      expect.objectContaining({ errorCode: 'UNAVAILABLE' })
    );
  });

  describe.skipIf(process.platform === 'win32')('canonical symlink and special-file policy', () => {
    it('rejects a candidate or .git symlink pointing outside the policy', async () => {
      await symlink(outside, path.join(allowed, 'escape'));
      expect(() => boundary().resolve(path.join(allowed, 'escape'))).toThrow(
        expect.objectContaining({ errorCode: 'FORBIDDEN' })
      );
      await gitDirectory(outside);
      await symlink(outside, path.join(allowed, '.git'));
      expect(() => boundary().resolve(allowed)).toThrow(
        expect.objectContaining({ errorCode: 'FORBIDDEN' })
      );
    });
    it('rejects an external common pointer symlink before reading it', async () => {
      const admin = path.join(allowed, '.git');
      await gitDirectory(admin);
      await writeFile(path.join(outside, 'pointer'), `${admin}\n`);
      await symlink(path.join(outside, 'pointer'), path.join(admin, 'commondir'));
      expect(() => boundary().resolve(allowed)).toThrow(
        expect.objectContaining({ errorCode: 'FORBIDDEN' })
      );
    });
    it('canonicalizes configured aliases once and does not follow later alias retargeting', async () => {
      await gitDirectory(path.join(allowed, '.git'));
      const alias = path.join(root, 'root-alias');
      await symlink(allowed, alias);
      const owner = boundary(alias);
      expect(owner.resolve(alias)).toMatchObject({ cwd: allowed, workTree: allowed });
      await rm(alias);
      await symlink(outside, alias);
      expect(() => owner.resolve(alias)).toThrow(
        expect.objectContaining({ errorCode: 'FORBIDDEN' })
      );
    });
    it('allows an in-root metadata symlink and pins its canonical directory', async () => {
      const admin = path.join(allowed, 'admin');
      await gitDirectory(admin);
      await symlink(admin, path.join(allowed, '.git'));
      expect(boundary().resolve(allowed)).toMatchObject({
        gitDirectory: admin,
        commonDirectory: admin,
      });
    });
    it('rejects special pointer files without waiting for a writer', async () => {
      await promisify(execFile)('mkfifo', [path.join(allowed, '.git')]);
      expect(() => boundary().resolve(allowed)).toThrow(
        expect.objectContaining({ errorCode: 'UNAVAILABLE' })
      );
    });
  });
});
