import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { expect, it } from 'vitest';
import { createSecureFs } from '../src/secure-fs.js';

it('publishes a private staged file atomically and preserves an existing destination', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-link-'));
  const filesystem = createSecureFs((candidate) => {
    const relative = path.relative(root, path.resolve(candidate));
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw new Error('Denied fixture path');
    return path.resolve(candidate);
  });
  try {
    const staged = path.join(root, 'stage'),
      destination = path.join(root, 'destination');
    await filesystem.writeFile(staged, 'staged', { flag: 'wx', mode: 0o600 });
    await filesystem.link(staged, destination);
    expect(await fs.readFile(destination, 'utf8')).toBe('staged');
    expect((await fs.stat(destination)).ino).toBe((await fs.stat(staged)).ino);
    await expect(filesystem.link(staged, destination)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await fs.readFile(destination, 'utf8')).toBe('staged');
    await expect(
      filesystem.link(path.join(root, '..', 'outside'), path.join(root, 'blocked'))
    ).rejects.toThrow('Denied fixture path');
  } finally {
    await filesystem.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
