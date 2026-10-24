import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/index.js';
import { FilesCommandService } from '../../src/modules/files/files-command.service.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';
import { secureFs } from '@automaker/platform';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe('native filesystem lifecycle', () => {
  let root: string;
  const owners: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const releases: Array<() => void> = [];
  async function owner(name: string, listen = false) {
    const runtime = await createNestApplication({
      host: '127.0.0.1',
      port: 0,
      workingDirectory: root,
      dataDir: path.join(root, name),
      providerRegistrations: [],
      runStartupTasks: false,
      enableShutdownHooks: false,
      environment: {
        NODE_ENV: 'test',
        AUTOMAKER_API_KEY: 'fixture',
        ENABLE_REQUEST_LOGGING: 'false',
      },
    });
    owners.push(runtime);
    if (listen) await runtime.start();
    return {
      ...runtime,
      files: runtime.app.get<ReturnType<typeof secureFs.createSecureFs>>(SECURE_FILESYSTEM),
    };
  }
  function heldRead(target: string) {
    const entered = deferred(),
      release = deferred();
    releases.push(release.resolve);
    const read = fs.readFile.bind(fs);
    vi.spyOn(fs, 'readFile').mockImplementation(async (...args: Parameters<typeof fs.readFile>) => {
      if (String(args[0]) === target) {
        entered.resolve();
        await release.promise;
      }
      return read(...args);
    });
    return { entered, release };
  }
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'automaker-fs-lifecycle-'));
    await fs.writeFile(path.join(root, 'held.txt'), 'owned');
  });
  afterEach(async () => {
    releases.splice(0).forEach((release) => release());
    await Promise.allSettled(owners.splice(0).map((runtime) => runtime.app.close()));
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('waits for owned IO, closes only its own admission and keeps the other application usable', async () => {
    const first = await owner('first'),
      second = await owner('second');
    const target = path.join(root, 'held.txt');
    const held = heldRead(target);
    const pending = first.files.readFile(target, 'utf8');
    await held.entered.promise;
    let ended = false;
    const close = first.app.close().then(() => {
      ended = true;
    });
    await vi.waitFor(() =>
      expect(() => first.files.existsSync(target)).toThrow(
        expect.objectContaining({ code: 'FILESYSTEM_CLOSED' })
      )
    );
    expect(ended).toBe(false);
    expect(first.files.getActiveOperations()).toBe(1);
    held.release.resolve();
    expect(await pending).toBe('owned');
    await close;
    expect(await second.files.readFile(target, 'utf8')).toBe('owned');
    await expect(first.files.readFile(target)).rejects.toMatchObject({ code: 'FILESYSTEM_CLOSED' });
  });

  it('finishes an accepted atomic file command before closing its filesystem dependency', async () => {
    const runtime = await owner('writer');
    const commands = runtime.app.get(FilesCommandService);
    const destination = path.join(root, 'accepted.txt');
    const pending = commands.write(destination, 'confirmed');
    await Promise.all([pending, runtime.app.close()]);
    expect(await fs.readFile(destination, 'utf8')).toBe('confirmed');
    await expect(commands.write(destination, 'replacement')).rejects.toMatchObject({
      errorCode: 'UNAVAILABLE',
    });
  });

  it('does not fake FS cancellation when forced HTTP close releases a held request; later owners are still disposed', async () => {
    const runtime = await owner('http', true);
    const target = path.join(root, 'held.txt');
    const held = heldRead(target);
    const { port } = runtime.app.getHttpServer().address() as { port: number };
    const response = fetch(`http://127.0.0.1:${port}/api/fs/read`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'fixture' },
      body: JSON.stringify({ filePath: target }),
    });
    const observed = response.then(
      () => 'unexpected response',
      () => 'transport closed'
    );
    await held.entered.promise;
    const dispose = vi.spyOn(runtime.app.get(ProviderRegistry), 'onApplicationShutdown');
    const fallback = setTimeout(held.release.resolve, 16_000);
    const started = performance.now();
    try {
      await expect(runtime.app.close()).rejects.toMatchObject({
        code: 'APPLICATION_CLEANUP_FAILED',
      });
      expect(performance.now() - started).toBeLessThan(14_000);
      expect(await observed).toBe('transport closed');
      expect(dispose).toHaveBeenCalledOnce();
      expect(runtime.files.getActiveOperations()).toBe(1);
      held.release.resolve();
      await vi.waitFor(() => expect(runtime.files.getActiveOperations()).toBe(0));
      await expect(runtime.app.close()).rejects.toMatchObject({
        code: 'APPLICATION_CLEANUP_FAILED',
      });
    } finally {
      clearTimeout(fallback);
      held.release.resolve();
      await observed;
    }
  }, 20_000);
});
