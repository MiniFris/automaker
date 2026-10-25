import { createServer, createConnection, type Server } from 'node:net';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { DevServerService, type DevServerRuntime } from '../../src/services/dev-server-service.js';
import { TestRunnerService } from '../../src/services/test-runner-service.js';
import {
  parseLinuxProcessStat,
  linuxProcessSession,
} from '../../src/core/platform/linux-process-group.js';

async function listen() {
  const server = createServer((socket) => socket.end('private-listener'));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, port: (server.address() as { port: number }).port };
}
const closeServer = (server: Server) =>
  new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
async function ping(port: number) {
  return new Promise<string>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let content = '';
    socket.setTimeout(2000, () => socket.destroy(new Error('Private listener timed out')));
    socket.on('data', (chunk) => {
      content += chunk;
    });
    socket.once('end', () => resolve(content));
    socket.once('error', reject);
  });
}
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-native-child-'));
  await mkdir(path.join(directory, 'project'));
  const runtime = await createNestApplication({
    workingDirectory: directory,
    dataDir: path.join(directory, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      NODE_ENV: 'test',
      HOME: directory,
      ALLOWED_ROOT_DIRECTORY: directory,
      ENABLE_REQUEST_LOGGING: 'false',
    },
  });
  return {
    directory,
    project: path.join(directory, 'project'),
    runtime,
    dev: runtime.app.get(DevServerService),
    tests: runtime.app.get(TestRunnerService),
  };
}
function ports(dev: DevServerService, port: number) {
  (dev as unknown as { runtime: DevServerRuntime }).runtime.ports = { first: port, last: port };
}
async function generation(pid: number) {
  const value = await readFile(`/proc/${pid}/stat`, 'utf8');
  return {
    pid,
    start: value
      .slice(value.lastIndexOf(')') + 1)
      .trim()
      .split(/\s+/)[19],
    group: parseLinuxProcessStat(value).group,
    session: linuxProcessSession(value),
  };
}
async function quiet(pid: number) {
  try {
    return ['Z', 'X', 'x'].includes(
      parseLinuxProcessStat(await readFile(`/proc/${pid}/stat`, 'utf8')).state
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
}
async function fallbackCleanup(identities: Awaited<ReturnType<typeof generation>>[]) {
  // Every identity was captured from this fixture's own root/explicit child.
  for (const captured of identities) {
    try {
      const current = await generation(captured.pid);
      if (
        current.start === captured.start &&
        current.group === captured.group &&
        current.session === captured.session
      )
        process.kill(captured.pid, 'SIGKILL');
    } catch (error) {
      if (!['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  }
}
async function identitiesFromFile(file: string): Promise<Awaited<ReturnType<typeof generation>>[]> {
  try {
    return JSON.parse(await readFile(file, 'utf8')).identities ?? [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
const script = path.resolve(import.meta.dirname, '../fixtures/local-process-owned.mjs');
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

it.skipIf(process.platform !== 'linux')(
  'native dev skips an owned busy listener, confirms its actual group and never adopts a copied record',
  async () => {
    const a = await fixture();
    const b = await fixture();
    const busy = await listen();
    const allocated = await listen();
    const port = allocated.port;
    await closeServer(allocated.server);
    const identities: Awaited<ReturnType<typeof generation>>[] = [];
    try {
      ports(a.dev, busy.port);
      expect(await a.dev.startDevServer(a.project, a.project, 'never')).toMatchObject({
        success: false,
      });
      expect(await ping(busy.port)).toBe('private-listener');
      ports(a.dev, port);
      const file = path.join(a.directory, 'pids.json');
      const started = await a.dev.startDevServer(
        a.project,
        a.project,
        `"${process.execPath}" "${script}" "${file}" server`
      );
      expect(started.success).toBe(true);
      await vi.waitFor(async () =>
        expect(JSON.parse(await readFile(file, 'utf8')).root).toBe(
          a.dev.getServerInfo(a.project)?.process?.pid
        )
      );
      const pids = JSON.parse(await readFile(file, 'utf8')) as { root: number; child: number };
      identities.push(await generation(pids.root), await generation(pids.child));
      expect(
        identities.every(
          (identity) => identity.group === pids.root && identity.session === pids.root
        )
      ).toBe(true);
      const info = a.dev.getServerInfo(a.project)!;
      await writeFile(
        path.join(b.directory, 'data/dev-servers.json'),
        JSON.stringify([
          {
            worktreePath: a.project,
            allocatedPort: port,
            port,
            url: info.url,
            startedAt: info.startedAt.toISOString(),
            urlDetected: true,
          },
        ])
      );
      await b.dev.initialize(b.directory, { emit: vi.fn() } as never);
      await expect(b.dev.stopDevServer(a.project)).rejects.toMatchObject({
        code: 'LOCAL_PROCESS_CLEANUP_FAILED',
      });
      await expect(b.dev.startDevServer(a.project, a.project, 'never')).rejects.toMatchObject({
        code: 'LOCAL_PROCESS_CLEANUP_FAILED',
      });
      expect(await ping(port)).toBe('owned-dev');
      expect((await a.dev.stopDevServer(a.project)).success).toBe(true);
      for (const pid of [pids.root, pids.child]) expect(await quiet(pid)).toBe(true);
      expect(a.dev.getServerInfo(a.project)).toBeUndefined();
      expect(a.dev.getAllocatedPorts()).toEqual([]);
      expect(await ping(busy.port)).toBe('private-listener');
      await expect(b.runtime.app.close()).rejects.toMatchObject({
        code: 'APPLICATION_CLEANUP_FAILED',
      });
    } finally {
      await fallbackCleanup(
        identities.length
          ? identities
          : await identitiesFromFile(path.join(a.directory, 'pids.json'))
      );
      await a.runtime.app.close().catch(() => {});
      await b.runtime.app.close().catch(() => {});
      await closeServer(busy.server);
      await rm(a.directory, { recursive: true, force: true });
      await rm(b.directory, { recursive: true, force: true });
    }
  }
);

it.skipIf(process.platform !== 'linux')(
  'native tests confirm their actual TERM-resistant group before cancellation completes',
  async () => {
    const f = await fixture();
    const other = await fixture();
    const identities: Awaited<ReturnType<typeof generation>>[] = [];
    try {
      const file = path.join(f.directory, 'pids.json');
      const started = await f.tests.startTests(f.project, {
        command: `exec ${quote(process.execPath)} ${quote(script)} ${quote(file)} job`,
      });
      expect(started.success).toBe(true);
      const id = started.result!.sessionId;
      await vi.waitFor(async () =>
        expect(JSON.parse(await readFile(file, 'utf8')).root).toBe(
          f.tests.getSession(id)?.process?.pid
        )
      );
      const pids = JSON.parse(await readFile(file, 'utf8')) as { root: number; child: number };
      identities.push(await generation(pids.root), await generation(pids.child));
      expect((await other.tests.stopTests(id)).success).toBe(false);
      expect(await quiet(pids.root)).toBe(false);
      expect((await f.tests.stopTests(id)).success).toBe(true);
      expect(f.tests.getSession(id)).toMatchObject({ status: 'cancelled' });
      for (const pid of [pids.root, pids.child]) expect(await quiet(pid)).toBe(true);
      const shutdownFile = path.join(f.directory, 'shutdown-pids.json');
      const shutdownJob = await f.tests.startTests(f.project, {
        command: `exec ${quote(process.execPath)} ${quote(script)} ${quote(shutdownFile)} job`,
      });
      expect(shutdownJob.success).toBe(true);
      await vi.waitFor(async () =>
        expect(JSON.parse(await readFile(shutdownFile, 'utf8')).root).toBe(
          f.tests.getSession(shutdownJob.result!.sessionId)?.process?.pid
        )
      );
      const shutdownPids = JSON.parse(await readFile(shutdownFile, 'utf8')) as {
        root: number;
        child: number;
      };
      identities.push(await generation(shutdownPids.root), await generation(shutdownPids.child));
      await f.runtime.app.close();
      for (const pid of [shutdownPids.root, shutdownPids.child])
        expect(await quiet(pid)).toBe(true);
    } finally {
      await fallbackCleanup([
        ...identities,
        ...(await identitiesFromFile(path.join(f.directory, 'pids.json'))),
        ...(await identitiesFromFile(path.join(f.directory, 'shutdown-pids.json'))),
      ]);
      await f.runtime.app.close();
      await other.runtime.app.close();
      await rm(f.directory, { recursive: true, force: true });
      await rm(other.directory, { recursive: true, force: true });
    }
  }
);
