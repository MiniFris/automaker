import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { createNestApplication } from '../../src/main.js';
import { TerminalService } from '../../src/services/terminal-service.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { terminalCleanupError } from '../../src/services/terminal-session-lifecycle.js';
import { parseLinuxProcessStat } from '../../src/core/platform/linux-process-group.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/index.js';

async function fixture(options: { separateHome?: boolean; omitHome?: boolean } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-terminal-stop-'));
  const allowedRoot = options.separateHome ? path.join(directory, 'project') : directory;
  const home = options.separateHome ? path.join(directory, 'home') : directory;
  await mkdir(allowedRoot, { recursive: true });
  await mkdir(home, { recursive: true });
  const runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: directory,
    dataDir: path.join(directory, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      NODE_ENV: 'test',
      AUTOMAKER_API_KEY: 'fixture',
      ...(!options.omitHome && { HOME: home }),
      ALLOWED_ROOT_DIRECTORY: allowedRoot,
      ENABLE_REQUEST_LOGGING: 'false',
    },
  });
  await runtime.start();
  const base = `http://127.0.0.1:${(runtime.app.getHttpServer().address() as AddressInfo).port}`;
  const terminal = runtime.app.get(TerminalService);
  const request = (id: string, method = 'DELETE') =>
    fetch(`${base}/api/terminal/sessions/${encodeURIComponent(id)}`, {
      method,
      headers: { 'x-api-key': 'fixture' },
    });
  return { runtime, directory, base, terminal, request, allowedRoot, home };
}

it.skipIf(process.platform !== 'linux')(
  'DELETE confirms an actual owned TERM-resistant PTY process group is quiescent',
  async () => {
    const f = await fixture();
    let group: number | undefined;
    try {
      const settings = f.runtime.app.get(SettingsService);
      await settings.updateGlobalSettings({
        terminalConfig: { ...(await settings.getGlobalSettings()).terminalConfig!, enabled: false },
      });
      expect(
        (f.terminal as unknown as { preflight: { filesystem: unknown } }).preflight.filesystem
      ).toBe(f.runtime.app.get(SECURE_FILESYSTEM));
      const session = await f.terminal.createSession({
        cwd: f.directory,
        shell: '/bin/sh',
        env: { HOME: f.directory, ENV: '', BASH_ENV: '' },
      });
      expect(session).not.toBeNull();
      group = (session!.pty as unknown as { pid: number }).pid;
      expect(parseLinuxProcessStat(await readFile(`/proc/${group}/stat`, 'utf8')).group).toBe(
        group
      );
      const file = path.join(f.directory, 'pids.json');
      const script = path.resolve(import.meta.dirname, '../fixtures/terminal-drain.mjs');
      const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
      f.terminal.write(
        session!.id,
        `exec ${quote(process.execPath)} ${quote(script)} ${quote(file)}\n`
      );
      await vi.waitFor(async () =>
        expect(JSON.parse(await readFile(file, 'utf8')).root).toBe(group)
      );
      const pids = JSON.parse(await readFile(file, 'utf8')) as { root: number; child: number };
      const response = await f.request(session!.id);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true });
      expect(f.terminal.getSession(session!.id)).toBeUndefined();
      for (const pid of [pids.root, pids.child]) {
        try {
          expect(['Z', 'X', 'x']).toContain(
            parseLinuxProcessStat(await readFile(`/proc/${pid}/stat`, 'utf8')).state
          );
        } catch (error) {
          expect(error).toMatchObject({ code: 'ENOENT' });
        }
      }
      expect((await f.request(session!.id)).status).toBe(404);
    } finally {
      if (group && group > 1) {
        try {
          process.kill(-group, 'SIGKILL');
        } catch {
          // The verified original group may already have disappeared after cleanup.
        }
      }
      await f.runtime.app.close();
      await rm(f.directory, { recursive: true, force: true });
    }
  }
);

it('holds DELETE until cleanup settles, reports unknown failure and blocks identity recreation/input', async () => {
  const f = await fixture();
  const state = f.terminal as unknown as {
    sessions: Map<string, unknown>;
    lifecycles: Map<string, unknown>;
  };
  let release!: () => void;
  const closing = new Promise<void>((resolve) => {
    release = resolve;
  });
  const session = {
    id: 'held',
    cwd: f.directory,
    shell: '/bin/sh',
    createdAt: new Date(),
    pty: { write: vi.fn() },
  };
  const owner = { closing: true, requestClose: vi.fn(() => true), close: vi.fn(() => closing) };
  state.sessions.set(session.id, session);
  state.lifecycles.set(session.id, owner);
  try {
    let settled = false;
    const request = f.request(session.id).then((response) => {
      settled = true;
      return response;
    });
    await vi.waitFor(() => expect(owner.requestClose).toHaveBeenCalled());
    expect(settled).toBe(false);
    expect(f.terminal.getSession(session.id)).toBe(session);
    expect((await f.request(session.id, 'GET')).status).toBe(503);
    expect(f.terminal.write(session.id, 'never execute')).toBe(false);
    release();
    const response = await request;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(f.terminal.getSession(session.id)).toBeUndefined();
    owner.close.mockImplementation(() => Promise.reject(terminalCleanupError()));
    state.sessions.set(session.id, session);
    state.lifecycles.set(session.id, owner);
    const failed = await f.request(session.id);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({
      success: false,
      errorCode: 'UNAVAILABLE',
      code: 'TERMINAL_CLEANUP_FAILED',
      error: terminalCleanupError().message,
    });
    expect(f.terminal.getSession(session.id)).toBe(session);
    expect((await f.request(session.id, 'GET')).status).toBe(503);
    const socket = new WebSocket(
      `${f.base.replace('http:', 'ws:')}/api/terminal/ws?apiKey=fixture&sessionId=held`
    );
    const messages: unknown[] = [];
    socket.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    const code = await new Promise<number>((resolve, reject) => {
      socket.once('close', resolve);
      socket.once('error', reject);
    });
    expect(code).toBe(4005);
    expect(messages).toEqual([]);
    expect(session.pty.write).not.toHaveBeenCalled();
    state.lifecycles.delete(session.id);
    expect((await f.request(session.id)).status).toBe(503);
    expect(f.terminal.getSession(session.id)).toBe(session);
  } finally {
    release();
    state.sessions.clear();
    state.lifecycles.clear();
    await f.runtime.app.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

it.skipIf(process.platform !== 'linux')(
  'native no-cwd creation validates its fallback and never uses unauthorized or absent snapshot HOME',
  async () => {
    for (const omitHome of [false, true]) {
      const f = await fixture({ separateHome: true, omitHome });
      try {
        const settings = f.runtime.app.get(SettingsService);
        await settings.updateGlobalSettings({
          terminalConfig: {
            ...(await settings.getGlobalSettings()).terminalConfig!,
            enabled: false,
          },
        });
        const session = await f.terminal.createSession({
          shell: '/bin/sh',
          env: { HOME: f.home, ENV: '', BASH_ENV: '' },
        });
        expect(session!.cwd).toBe(f.allowedRoot);
        expect(session!.cwd).not.toBe(f.home);
        expect(await f.terminal.stopSession(session!.id)).toBe(true);
      } finally {
        await f.runtime.app.close();
        await rm(f.directory, { recursive: true, force: true });
      }
    }
  }
);
