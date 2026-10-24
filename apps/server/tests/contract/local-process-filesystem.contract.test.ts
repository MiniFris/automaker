import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { spawn } from 'child_process';
import { createNestApplication } from '../../src/main.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/index.js';
import type * as Filesystem from '../../src/lib/secure-fs.js';
import { DevServerService } from '../../src/services/dev-server-service.js';
import { TestRunnerService } from '../../src/services/test-runner-service.js';
vi.mock('child_process', async () => ({
  ...(await vi.importActual('child_process')),
  spawn: vi.fn(() => {
    throw new Error('Unexpected process spawn');
  }),
}));

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-local-process-fs-'));
  await mkdir(path.join(directory, 'project'));
  const runtime = await createNestApplication({
    workingDirectory: directory,
    dataDir: path.join(directory, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      NODE_ENV: 'test',
      ALLOWED_ROOT_DIRECTORY: directory,
      ENABLE_REQUEST_LOGGING: 'false',
    },
  });
  return {
    directory,
    runtime,
    dev: runtime.app.get(DevServerService),
    tests: runtime.app.get(TestRunnerService),
    filesystem: runtime.app.get<typeof Filesystem>(SECURE_FILESYSTEM),
  };
}

it('isolates two native application roots and rejects EIO before any process start', async () => {
  const a = await fixture();
  const b = await fixture();
  try {
    const first = vi.spyOn(a.filesystem, 'stat');
    const second = vi.spyOn(b.filesystem, 'stat');
    expect(await a.dev.startDevServer('project', 'project')).toMatchObject({
      success: false,
      error: 'No package.json found in: project',
    });
    expect(await a.tests.startTests('project', { command: '' })).toMatchObject({
      success: false,
      error: 'No test command provided',
    });
    expect(first).toHaveBeenCalledWith(path.join(a.directory, 'project'));
    await expect(
      b.dev.startDevServer(a.directory, path.join(a.directory, 'project'), 'never')
    ).rejects.toMatchObject({ errorCode: 'FORBIDDEN' });
    await expect(
      b.tests.startTests(path.join(a.directory, 'project'), { command: 'never' })
    ).rejects.toMatchObject({ errorCode: 'FORBIDDEN' });
    expect(second).not.toHaveBeenCalled();
    const error = Object.assign(new Error('fixture EIO'), { code: 'EIO' });
    first.mockRejectedValue(error);
    await expect(a.dev.startDevServer('project', 'project', 'never')).rejects.toBe(error);
    await expect(a.tests.startTests('project', { command: 'never' })).rejects.toBe(error);
    expect(spawn).not.toHaveBeenCalled();
  } finally {
    await a.runtime.app.close();
    await b.runtime.app.close();
    await rm(a.directory, { recursive: true, force: true });
    await rm(b.directory, { recursive: true, force: true });
  }
});

it('drains held native preflight through app.close before filesystem close and blocks its late spawn', async () => {
  const f = await fixture();
  const original = f.filesystem.stat.bind(f.filesystem);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = vi.spyOn(f.filesystem, 'stat').mockImplementation(async (...args) => {
    await gate;
    return original(...args);
  });
  const allocation = vi.spyOn(
    f.dev as unknown as { findAvailablePort: () => Promise<number> },
    'findAvailablePort'
  );
  const start = f.dev.startDevServer('project', 'project', 'never');
  try {
    await vi.waitFor(() => expect(held).toHaveBeenCalled());
    let closed = false;
    const closing = f.runtime.app.close().then(() => {
      closed = true;
    });
    await vi.waitFor(() => expect((f.dev as unknown as { closing: boolean }).closing).toBe(true));
    expect(closed).toBe(false);
    expect(await f.dev.startDevServer('project', 'project', 'never')).toMatchObject({
      success: false,
      error: 'Dev server is shutting down',
    });
    release();
    expect(await start).toMatchObject({ success: false, error: 'Dev server is shutting down' });
    await closing;
    expect(allocation).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  } finally {
    release();
    await start.catch(() => {});
    await f.runtime.app.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

it('waits for a held atomic native state save before closing FS, keeping its filename/format private', async () => {
  const f = await fixture();
  const original = f.filesystem.writeFile.bind(f.filesystem);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writing = vi.spyOn(f.filesystem, 'writeFile').mockImplementation(async (...args) => {
    await gate;
    return original(...args);
  });
  const save = (f.dev as unknown as { saveState: () => Promise<void> }).saveState();
  try {
    await vi.waitFor(() => expect(writing).toHaveBeenCalled());
    let closed = false;
    const closing = f.runtime.app.close().then(() => {
      closed = true;
    });
    await vi.waitFor(() => expect((f.dev as unknown as { closing: boolean }).closing).toBe(true));
    expect(closed).toBe(false);
    release();
    await save;
    await closing;
    const file = path.join(f.directory, 'data/dev-servers.json');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual([]);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    await expect(
      (f.dev as unknown as { saveState: () => Promise<void> }).saveState()
    ).rejects.toThrow('Local dev server state is closed.');
  } finally {
    release();
    await save.catch(() => {});
    await f.runtime.app.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

it('propagates native load errors and retains state-write failure through cleanup', async () => {
  const f = await fixture();
  const error = Object.assign(new Error('fixture EIO'), { code: 'EIO' });
  try {
    const access = vi.spyOn(f.filesystem, 'access').mockRejectedValue(error);
    await expect(f.dev.initialize('/untrusted-override', { emit: vi.fn() } as never)).rejects.toBe(
      error
    );
    expect(access).toHaveBeenCalledWith(path.join(f.directory, 'data/dev-servers.json'), 0);
    access.mockRestore();
    vi.spyOn(f.filesystem, 'writeFile').mockRejectedValue(error);
    await expect(
      (f.dev as unknown as { saveState: () => Promise<void> }).saveState()
    ).rejects.toThrow('Local dev server state could not be persisted.');
    await expect(f.runtime.app.close()).rejects.toMatchObject({
      code: 'APPLICATION_CLEANUP_FAILED',
    });
  } finally {
    await f.runtime.app.close().catch(() => {});
    await rm(f.directory, { recursive: true, force: true });
  }
});

it('allows a complete successful state snapshot to recover an earlier write failure before shutdown', async () => {
  const f = await fixture();
  const save = (f.dev as unknown as { saveState: () => Promise<void> }).saveState.bind(f.dev);
  try {
    const write = vi
      .spyOn(f.filesystem, 'writeFile')
      .mockRejectedValueOnce(Object.assign(new Error('fixture EIO'), { code: 'EIO' }));
    await expect(save()).rejects.toThrow('Local dev server state could not be persisted.');
    write.mockRestore();
    await save();
    expect(
      JSON.parse(await readFile(path.join(f.directory, 'data/dev-servers.json'), 'utf8'))
    ).toEqual([]);
    await f.runtime.app.close();
  } finally {
    await f.runtime.app.close().catch(() => {});
    await rm(f.directory, { recursive: true, force: true });
  }
});

it('drains a held native test preflight before filesystem close and rejects its late start', async () => {
  const f = await fixture();
  const original = f.filesystem.stat.bind(f.filesystem);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = vi.spyOn(f.filesystem, 'stat').mockImplementation(async (...args) => {
    await gate;
    return original(...args);
  });
  const start = f.tests.startTests('project', { command: 'never' });
  try {
    await vi.waitFor(() => expect(held).toHaveBeenCalled());
    let closed = false;
    const closing = f.runtime.app.close().then(() => {
      closed = true;
    });
    await vi.waitFor(() => expect((f.tests as unknown as { closing: boolean }).closing).toBe(true));
    expect(closed).toBe(false);
    expect(await f.tests.startTests('project', { command: 'never' })).toMatchObject({
      success: false,
      error: 'Test runner is shutting down',
    });
    release();
    expect(await start).toMatchObject({ success: false, error: 'Test runner is shutting down' });
    await closing;
    expect(spawn).not.toHaveBeenCalled();
  } finally {
    release();
    await start.catch(() => {});
    await f.runtime.app.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});
