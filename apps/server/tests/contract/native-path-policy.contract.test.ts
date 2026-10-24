import { mkdir, mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/index.js';
import type * as Filesystem from '../../src/lib/secure-fs.js';

describe('application-owned local path policy', () => {
  let temporary: string, firstRoot: string, secondRoot: string;
  const owners: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  async function start(root: string | undefined, name: string) {
    const owner = await createNestApplication({
      host: '127.0.0.1',
      port: 0,
      workingDirectory: temporary,
      dataDir: path.join(temporary, `${name}-data`),
      providerRegistrations: [],
      runStartupTasks: false,
      enableShutdownHooks: false,
      environment: {
        NODE_ENV: 'test',
        AUTOMAKER_API_KEY: 'fixture',
        ENABLE_REQUEST_LOGGING: 'false',
        ALLOWED_ROOT_DIRECTORY: root,
      },
    });
    owners.push(owner);
    await owner.start();
    const port = (owner.app.getHttpServer().address() as { port: number }).port;
    return {
      ...owner,
      filesystem: owner.app.get<typeof Filesystem>(SECURE_FILESYSTEM),
      post: async (route: string, body: object) => {
        const response = await fetch(`http://127.0.0.1:${port}/api/fs/${route}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': 'fixture' },
          body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
      },
    };
  }
  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'automaker-native-policy-'));
    firstRoot = path.join(temporary, 'first');
    secondRoot = path.join(temporary, 'second');
    for (const root of [firstRoot, secondRoot]) {
      await mkdir(root);
      await writeFile(path.join(root, 'owned.txt'), path.basename(root));
    }
  });
  afterEach(async () => {
    const results = await Promise.allSettled(owners.splice(0).map((owner) => owner.app.close()));
    await rm(temporary, { recursive: true, force: true });
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  });

  it('isolates HTTP and direct filesystem access for simultaneous applications', async () => {
    const first = await start(firstRoot, 'first');
    const second = await start(secondRoot, 'second');
    const foreign = path.join(secondRoot, 'owned.txt');
    expect(await first.post('read', { filePath: foreign })).toMatchObject({
      status: 403,
      body: { errorCode: 'FORBIDDEN' },
    });
    expect(await second.post('read', { filePath: foreign })).toMatchObject({
      status: 200,
      body: { content: 'second' },
    });
    expect(first.filesystem).not.toBe(second.filesystem);
    await expect(first.filesystem.readFile(foreign, 'utf8')).rejects.toMatchObject({
      errorCode: 'FORBIDDEN',
    });
    await expect(second.filesystem.readFile(foreign, 'utf8')).resolves.toBe('second');
  });

  it('uses configured browse defaults, relative paths and a scoped DATA_DIR exception', async () => {
    const first = await start(firstRoot, 'first');
    expect(await first.post('browse', {})).toMatchObject({
      status: 200,
      body: { currentPath: firstRoot, parentPath: null },
    });
    expect(await first.post('read', { filePath: 'first/owned.txt' })).toMatchObject({
      status: 200,
      body: { content: 'first' },
    });
    const target = path.join(temporary, 'first-data', 'owned.txt');
    await first.filesystem.mkdir(path.dirname(target), { recursive: true });
    await first.filesystem.writeFile(target, 'private');
    await expect(readFile(target, 'utf8')).resolves.toBe('private');
    await expect(
      first.filesystem.writeFile(path.join(secondRoot, 'new', 'denied.txt'), 'never')
    ).rejects.toMatchObject({ errorCode: 'FORBIDDEN' });
  });

  it.skipIf(process.platform === 'win32')(
    'rejects symlink escapes and keeps unrestricted owners independent of restricted ones',
    async () => {
      await symlink(secondRoot, path.join(firstRoot, 'escape'));
      const restricted = await start(firstRoot, 'restricted');
      const unrestricted = await start(undefined, 'unrestricted');
      expect(
        await restricted.post('read', { filePath: path.join(firstRoot, 'escape', 'owned.txt') })
      ).toMatchObject({ status: 403 });
      expect(
        await unrestricted.post('read', { filePath: path.join(secondRoot, 'owned.txt') })
      ).toMatchObject({ status: 200 });
      expect(
        await restricted.post('read', { filePath: path.join(secondRoot, 'owned.txt') })
      ).toMatchObject({ status: 403 });
    }
  );
});
