import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { unzipSync, strFromU8 } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/index.js';
import { secureFs } from '@automaker/platform';
type ScopedSecureFilesystem = ReturnType<typeof secureFs.createSecureFs>;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('native download filesystem and lifecycle', () => {
  let root: string;
  const applications: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const releases: Array<() => void> = [];
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'owned-download-'));
  });
  afterEach(async () => {
    releases.splice(0).forEach((release) => release());
    await Promise.allSettled(applications.splice(0).map(({ app }) => app.close()));
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });
  async function owner() {
    const project = path.join(root, 'project'),
      data = path.join(project, 'data');
    await fs.mkdir(data, { recursive: true });
    const runtime = await createNestApplication({
      host: '127.0.0.1',
      port: 0,
      workingDirectory: root,
      dataDir: data,
      runStartupTasks: false,
      providerRegistrations: [],
      enableShutdownHooks: false,
      environment: {
        NODE_ENV: 'test',
        AUTOMAKER_API_KEY: 'fixture',
        ENABLE_REQUEST_LOGGING: 'false',
        ALLOWED_ROOT_DIRECTORY: project,
      },
    });
    applications.push(runtime);
    await runtime.start();
    const address = runtime.app.getHttpServer().address();
    const url = `http://127.0.0.1:${address.port}/api/fs/download`;
    const request = (filePath: string) =>
      fetch(url, {
        method: 'POST',
        headers: { 'x-api-key': 'fixture', 'content-type': 'application/json' },
        body: JSON.stringify({ filePath }),
        signal: AbortSignal.timeout(5000),
      });
    return {
      ...runtime,
      project,
      data,
      url,
      request,
      filesystem: runtime.app.get<ScopedSecureFilesystem>(SECURE_FILESYSTEM),
    };
  }
  function archive(bytes: ArrayBuffer) {
    return unzipSync(new Uint8Array(bytes));
  }

  it('downloads regular and empty files and builds a real ZIP without external programs or symlink targets', async () => {
    const runtime = await owner();
    await fs.writeFile(path.join(runtime.project, 'hello.txt'), 'owned-file');
    await fs.writeFile(path.join(runtime.project, 'empty'), '');
    await fs.writeFile(path.join(runtime.project, 'old'), 'old');
    await fs.utimes(path.join(runtime.project, 'old'), new Date(0), new Date(0));
    await fs.writeFile(path.join(runtime.project, 'future'), 'future');
    await fs.utimes(
      path.join(runtime.project, 'future'),
      new Date(2101, 0, 1),
      new Date(2101, 0, 1)
    );
    await fs.mkdir(path.join(runtime.project, 'empty-directory'));
    const outside = path.join(root, 'outside');
    await fs.writeFile(outside, 'outside-secret-sentinel');
    await fs.symlink(outside, path.join(runtime.project, 'external'));
    const storage = path.join(runtime.data, '.automaker-downloads');
    await fs.mkdir(path.join(storage, 'stale'), { recursive: true });
    await fs.writeFile(path.join(storage, 'stale', 'archive.zip'), 'private-other-download');
    const file = await runtime.request(path.join(runtime.project, 'hello.txt'));
    expect(file.status).toBe(200);
    expect(file.headers.get('content-length')).toBe('10');
    expect(await file.text()).toBe('owned-file');
    const empty = await runtime.request(path.join(runtime.project, 'empty'));
    expect(empty.status).toBe(200);
    expect((await empty.arrayBuffer()).byteLength).toBe(0);
    runtime.filesystem.configureThrottling({ maxConcurrency: 1 });
    const response = await runtime.request(runtime.project);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/zip');
    const zipped = archive(await response.arrayBuffer());
    expect(strFromU8(zipped['project/hello.txt'])).toBe('owned-file');
    expect(strFromU8(zipped['project/old'])).toBe('old');
    expect(strFromU8(zipped['project/future'])).toBe('future');
    expect(zipped['project/empty-directory/']).toBeDefined();
    expect(
      Object.keys(zipped).some(
        (name) => name.includes('.automaker-downloads') || name.endsWith('/external')
      )
    ).toBe(false);
    await vi.waitFor(async () => expect(await fs.readdir(storage)).toEqual(['stale']));
    expect((await runtime.request(outside)).status).toBe(403);
  });

  it('excludes every active private archive when DATA_DIR is inside concurrent download sources', async () => {
    const runtime = await owner();
    await fs.writeFile(path.join(runtime.project, 'file'), 'concurrent');
    const entered = deferred(),
      release = deferred();
    releases.push(release.resolve);
    const scope = runtime.filesystem.withFileStreams.bind(runtime.filesystem);
    let writes = 0;
    vi.spyOn(runtime.filesystem, 'withFileStreams').mockImplementation((operation) =>
      scope((streams) =>
        operation({
          ...streams,
          writeStream: async (...args) => {
            await streams.writeStream(...args);
            if (++writes === 1) {
              entered.resolve();
              await release.promise;
            }
          },
        })
      )
    );
    const first = runtime.request(runtime.project);
    await entered.promise;
    const second = await runtime.request(runtime.project);
    expect(second.status).toBe(200);
    const secondZip = archive(await second.arrayBuffer());
    expect(Object.keys(secondZip).some((name) => name.includes('.automaker-downloads'))).toBe(
      false
    );
    release.resolve();
    const firstZip = archive(await (await first).arrayBuffer());
    expect(strFromU8(firstZip['project/file'])).toBe('concurrent');
  });

  it('closes an actual file stream on client disconnect and then shuts down cleanly', async () => {
    const runtime = await owner();
    const target = path.join(runtime.project, 'large');
    await fs.writeFile(target, '');
    await fs.truncate(target, 32 * 1024 * 1024);
    await new Promise<void>((resolve, reject) => {
      const request = http.request(
        runtime.url,
        { method: 'POST', headers: { 'x-api-key': 'fixture', 'content-type': 'application/json' } },
        (response) => {
          response.once('data', () => {
            response.destroy();
            resolve();
          });
          response.once('error', () => undefined);
        }
      );
      request.once('error', reject);
      request.end(JSON.stringify({ filePath: target }));
    });
    await vi.waitFor(() => expect(runtime.filesystem.getActiveOperations()).toBe(0));
    await runtime.app.close();
  });

  it('keeps failed private cleanup visible to application shutdown', async () => {
    const runtime = await owner();
    await fs.writeFile(path.join(runtime.project, 'file'), 'owned');
    const remove = runtime.filesystem.rm.bind(runtime.filesystem);
    const cleanup = vi.spyOn(runtime.filesystem, 'rm').mockImplementation(async (...args) => {
      if (String(args[0]).includes('.automaker-downloads'))
        throw new Error('Fixture cleanup failure.');
      return remove(...args);
    });
    const response = await runtime.request(runtime.project);
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalled());
    await expect(runtime.app.close()).rejects.toThrow(
      'Application cleanup could not be confirmed.'
    );
  });
});
