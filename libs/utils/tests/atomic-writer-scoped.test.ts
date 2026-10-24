import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { secureFs } from '@automaker/platform';
import { atomicWriteJson, updateJsonAtomically } from '../src/atomic-writer.js';

describe('application-owned atomic writer', () => {
  let root: string;
  const owners: Array<ReturnType<typeof secureFs.createSecureFs>> = [];
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'scoped-atomic-'));
  });
  afterEach(async () => {
    await Promise.allSettled(owners.splice(0).map((owner) => owner.close()));
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });
  function owner(directory: string) {
    const filesystem = secureFs.createSecureFs((candidate) => {
      const absolute = path.resolve(candidate);
      if (absolute !== directory && !absolute.startsWith(directory + path.sep))
        throw new Error('Fixture path rejected.');
      return absolute;
    });
    owners.push(filesystem);
    return filesystem;
  }

  it('uses the injected boundary for directories, backup rotation, temp writes and rename', async () => {
    const filesystem = owner(root);
    const methods = [
      'lstat',
      'mkdir',
      'access',
      'unlink',
      'copyFile',
      'writeFile',
      'rename',
    ] as const;
    const calls = Object.fromEntries(
      methods.map((method) => [method, vi.spyOn(filesystem, method)])
    );
    const target = path.join(root, 'nested', 'credentials.json');
    for (const revision of [1, 2, 3])
      await atomicWriteJson(target, { revision }, { filesystem, mode: 0o600, backupCount: 2 });
    expect(JSON.parse(await fs.readFile(target, 'utf8'))).toEqual({ revision: 3 });
    expect(JSON.parse(await fs.readFile(target + '.bak1', 'utf8'))).toEqual({ revision: 2 });
    expect(JSON.parse(await fs.readFile(target + '.bak2', 'utf8'))).toEqual({ revision: 1 });
    for (const method of methods) expect(calls[method]).toHaveBeenCalled();
    if (process.platform !== 'win32') expect((await fs.stat(target)).mode & 0o777).toBe(0o600);
  });

  it('rejects a forbidden target and keeps another owner usable after one closes', async () => {
    const firstDirectory = path.join(root, 'first');
    const secondDirectory = path.join(root, 'second');
    const first = owner(firstDirectory),
      second = owner(secondDirectory);
    await expect(
      atomicWriteJson(path.join(secondDirectory, 'forbidden.json'), {}, { filesystem: first })
    ).rejects.toThrow('Fixture path rejected');
    await expect(fs.access(path.join(secondDirectory, 'forbidden.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await first.close();
    await expect(
      atomicWriteJson(path.join(firstDirectory, 'closed.json'), {}, { filesystem: first })
    ).rejects.toMatchObject({ code: 'FILESYSTEM_CLOSED' });
    await atomicWriteJson(
      path.join(secondDirectory, 'settings.json'),
      { alive: true },
      { filesystem: second }
    );
    expect(
      JSON.parse(await fs.readFile(path.join(secondDirectory, 'settings.json'), 'utf8'))
    ).toEqual({ alive: true });
  });

  it('cleans up its temp file and preserves the committed target if rename fails', async () => {
    const filesystem = owner(root);
    const target = path.join(root, 'settings.json');
    await fs.writeFile(target, JSON.stringify({ committed: true }));
    vi.spyOn(filesystem, 'rename').mockRejectedValueOnce(new Error('Fixture rename failed.'));
    await expect(atomicWriteJson(target, { committed: false }, { filesystem })).rejects.toThrow(
      'Fixture rename failed'
    );
    expect(JSON.parse(await fs.readFile(target, 'utf8'))).toEqual({ committed: true });
    expect(await fs.readdir(root)).toEqual(['settings.json']);
  });

  it('rejects a denied injected read before invoking a JSON updater', async () => {
    const target = path.join(root, 'private.json');
    await fs.writeFile(target, JSON.stringify({ private: true }));
    const filesystem = owner(path.join(root, 'other'));
    const updater = vi.fn((value) => value);
    await expect(updateJsonAtomically(target, {}, updater, { filesystem })).rejects.toThrow(
      'Fixture path rejected'
    );
    expect(updater).not.toHaveBeenCalled();
    expect(JSON.parse(await fs.readFile(target, 'utf8'))).toEqual({ private: true });
  });
});
