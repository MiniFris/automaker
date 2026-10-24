import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { secureFs } from '@automaker/platform';
import { RuntimePathsService, parseRuntimeConfig } from '../../../src/core/config/index.js';
import { SecurityService } from '../../../src/core/security/security.service.js';
import { LocalProjectFileAdapter } from '../../../src/modules/files/local-project-file.adapter.js';
import {
  ForbiddenDomainError,
  mapInfrastructureError,
} from '../../../src/core/errors/domain-errors.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe('native local policy and scoped filesystem', () => {
  let root: string, allowed: string, outside: string, data: string;
  const policy = (boundary: string | undefined = allowed) =>
    new SecurityService(
      new RuntimePathsService(
        parseRuntimeConfig({ ALLOWED_ROOT_DIRECTORY: boundary, DATA_DIR: data }, root),
        root
      )
    );
  const filesystem = (security = policy()) =>
    secureFs.createSecureFs((candidate, options) =>
      security.validateLocalPath(candidate, 'fixture access', options?.followFinalSymlink)
    );
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'automaker-native-path-'));
    allowed = path.join(root, 'allowed');
    outside = path.join(root, 'outside');
    data = path.join(root, 'data');
    await Promise.all([allowed, outside, data].map((directory) => fs.mkdir(directory)));
    await fs.writeFile(path.join(allowed, 'owned.txt'), 'owned');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('uses immutable owner roots, relative working directories and a data exception', () => {
    const first = policy(),
      second = policy(outside);
    expect(first.validateLocalPath('allowed/owned.txt')).toBe(path.join(allowed, 'owned.txt'));
    expect(first.validateLocalPath(path.join(data, 'future', 'private.json'))).toBe(
      path.join(data, 'future', 'private.json')
    );
    expect(() => first.validateLocalPath(outside)).toThrow(
      expect.objectContaining({ errorCode: 'FORBIDDEN' })
    );
    expect(second.validateLocalPath(outside)).toBe(outside);
    expect(() => second.validateLocalPath(allowed)).toThrow(
      expect.objectContaining({ errorCode: 'FORBIDDEN' })
    );
    const unrestricted = new SecurityService(
      new RuntimePathsService(parseRuntimeConfig({ DATA_DIR: data }, root), root)
    );
    expect(unrestricted.validateLocalPath(outside)).toBe(outside);
    expect(() => first.validateLocalPath(outside)).toThrow('Path not allowed');
  });
  it('does not reject two-dot-prefixed filenames or accept sibling prefixes and other drives', () => {
    const security = policy();
    expect(security.validateLocalPath(path.join(allowed, '..literal'))).toBe(
      path.join(allowed, '..literal')
    );
    expect(security.isWithin('/repo/..literal', '/repo', 'posix')).toBe(true);
    expect(security.isWithin('/repo-other', '/repo', 'posix')).toBe(false);
    expect(security.isWithin('C:\\repo\\..literal', 'C:\\repo', 'win32')).toBe(true);
    expect(security.isWithin('D:\\repo', 'C:\\repo', 'win32')).toBe(false);
    expect(security.isWithin('\\\\host\\other', '\\\\host\\share', 'win32')).toBe(false);
  });
  it('does not leak private candidate paths through a policy error', () => {
    let failure: unknown;
    try {
      policy().validateLocalPath(path.join(outside, 'private-token-value'));
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ errorCode: 'FORBIDDEN', statusCode: 403 });
    expect(String(failure)).not.toContain(root);
    expect(String(failure)).not.toContain('private-token-value');
    expect(mapInfrastructureError(failure)).toBe(failure);
  });
  it('validates both operands before copy/rename and does not mutate either unauthorized target', async () => {
    const scoped = filesystem(),
      source = path.join(allowed, 'owned.txt'),
      target = path.join(outside, 'secret.txt');
    await fs.writeFile(target, 'unchanged');
    for (const operation of [scoped.copyFile, scoped.rename]) {
      await expect(operation(source, target)).rejects.toMatchObject({ errorCode: 'FORBIDDEN' });
      await expect(operation(target, source)).rejects.toMatchObject({ errorCode: 'FORBIDDEN' });
    }
    expect(await fs.readFile(source, 'utf8')).toBe('owned');
    expect(await fs.readFile(target, 'utf8')).toBe('unchanged');
  });
  it('owns independent throttle settings and queues', async () => {
    const first = filesystem(),
      second = filesystem();
    first.configureThrottling({ maxConcurrency: 1 });
    second.configureThrottling({ maxConcurrency: 7 });
    expect(first.getThrottlingConfig().maxConcurrency).toBe(1);
    expect(second.getThrottlingConfig().maxConcurrency).toBe(7);
    expect(secureFs.getThrottlingConfig().maxConcurrency).toBe(100);
    expect(first.getPendingOperations()).toBe(0);
    expect(second.getActiveOperations()).toBe(0);
    const config = first.getThrottlingConfig();
    (config as { maxConcurrency: number }).maxConcurrency = 19;
    expect(first.getThrottlingConfig().maxConcurrency).toBe(1);
  });
  it('revalidates on a retry instead of writing after the policy was revoked', async () => {
    let revoked = false;
    const scoped = secureFs.createSecureFs((candidate) => {
      if (revoked) throw new ForbiddenDomainError('Revoked fixture policy.');
      return candidate;
    });
    scoped.configureThrottling({ maxRetries: 1, baseDelay: 1, maxDelay: 1 });
    const write = vi.spyOn(fs, 'writeFile').mockImplementationOnce(async () => {
      revoked = true;
      throw Object.assign(new Error('fixture exhaustion'), { code: 'EMFILE' });
    });
    await expect(scoped.writeFile(path.join(allowed, 'new.txt'), 'never')).rejects.toMatchObject({
      errorCode: 'FORBIDDEN',
    });
    expect(write).toHaveBeenCalledOnce();
  });
  it('keeps atomic-write destinations intact when a copy or move source is missing', async () => {
    const security = policy(),
      adapter = new LocalProjectFileAdapter(filesystem(security), security);
    const target = path.join(allowed, 'owned.txt');
    await expect(adapter.copy(path.join(allowed, 'missing'), target, true)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(adapter.move(path.join(allowed, 'missing'), target, true)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await fs.readFile(target, 'utf8')).toBe('owned');
  });

  describe.skipIf(process.platform === 'win32')('canonical path and entry semantics', () => {
    it('rejects escaped or dangling symlinks, including nonexistent children', async () => {
      await fs.symlink(outside, path.join(allowed, 'escape'));
      await fs.symlink(path.join(outside, 'not-created'), path.join(allowed, 'dangling'));
      for (const candidate of ['escape', 'escape/new', 'dangling', 'dangling/new'])
        expect(() => policy().validateLocalPath(path.join(allowed, candidate))).toThrow(
          expect.objectContaining({ errorCode: 'FORBIDDEN' })
        );
    });
    it('pins a configured root alias once instead of accepting its later retargeting', async () => {
      const alias = path.join(root, 'alias');
      await fs.symlink(allowed, alias);
      const security = policy(alias);
      expect(security.validateLocalPath(path.join(alias, 'owned.txt'))).toBe(
        path.join(allowed, 'owned.txt')
      );
      await fs.unlink(alias);
      await fs.symlink(outside, alias);
      expect(() => security.validateLocalPath(alias)).toThrow(
        expect.objectContaining({ errorCode: 'FORBIDDEN' })
      );
    });
    it('unlinks and renames symlink entries without deleting or moving their targets', async () => {
      const scoped = filesystem(),
        target = path.join(allowed, 'owned.txt');
      const alias = path.join(allowed, 'alias'),
        renamed = path.join(allowed, 'renamed');
      await fs.symlink(target, alias);
      expect((await scoped.lstat(alias)).isSymbolicLink()).toBe(true);
      await scoped.rename(alias, renamed);
      expect((await fs.lstat(renamed)).isSymbolicLink()).toBe(true);
      await scoped.rm(renamed);
      await fs.symlink(target, alias);
      scoped.unlinkSync(alias);
      await fs.symlink(target, alias);
      scoped.rmSync(alias);
      const security = policy(),
        adapter = new LocalProjectFileAdapter(filesystem(security), security);
      await fs.symlink(target, alias);
      await fs.symlink(path.join(allowed, 'missing-target'), renamed);
      await adapter.move(alias, renamed, true);
      expect((await fs.lstat(renamed)).isSymbolicLink()).toBe(true);
      expect(await fs.readFile(target, 'utf8')).toBe('owned');
    });
    it('replaces a symlink entry atomically without overwriting its target', async () => {
      const security = policy(),
        adapter = new LocalProjectFileAdapter(filesystem(security), security);
      const alias = path.join(allowed, 'alias'),
        target = path.join(allowed, 'owned.txt');
      await fs.symlink(target, alias);
      await adapter.write(alias, 'replacement');
      expect((await fs.lstat(alias)).isSymbolicLink()).toBe(false);
      expect(await fs.readFile(alias, 'utf8')).toBe('replacement');
      expect(await fs.readFile(target, 'utf8')).toBe('owned');
    });
    it('checks queued filesystem access again after a parent directory was replaced by a symlink', async () => {
      const scoped = filesystem();
      scoped.configureThrottling({ maxConcurrency: 1 });
      const entered = deferred(),
        release = deferred();
      const read = fs.readFile.bind(fs);
      vi.spyOn(fs, 'readFile').mockImplementationOnce(
        async (...args: Parameters<typeof fs.readFile>) => {
          entered.resolve();
          await release.promise;
          return read(...args);
        }
      );
      const blocked = scoped.readFile(path.join(allowed, 'owned.txt'), 'utf8');
      await entered.promise;
      const parent = path.join(allowed, 'queued');
      await fs.mkdir(parent);
      const pending = scoped.writeFile(path.join(parent, 'new.txt'), 'never');
      const denied = expect(pending).rejects.toMatchObject({ errorCode: 'FORBIDDEN' });
      try {
        await fs.rename(parent, path.join(allowed, 'held'));
        await fs.symlink(outside, parent);
      } finally {
        release.resolve();
      }
      await blocked;
      await denied;
      await expect(fs.stat(path.join(outside, 'new.txt'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(scoped.getPendingOperations()).toBe(0);
    });
  });
});
