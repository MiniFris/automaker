import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as pty from 'node-pty';
import { afterEach, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { TerminalService } from '../../src/services/terminal-service.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/index.js';
import { secureFs } from '@automaker/platform';

type ScopedFs = ReturnType<typeof secureFs.createSecureFs>;
const applications: Awaited<ReturnType<typeof createNestApplication>>[] = [],
  roots: string[] = [];
const releases: Array<() => void> = [];
afterEach(async () => {
  releases.splice(0).forEach((release) => release());
  const results = await Promise.allSettled(
    applications.splice(0).map((owner) => owner.app.close())
  );
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
});
async function fixture(name: string, shell = '/bin/sh') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `terminal-host-${name}-`));
  roots.push(root);
  const owner = await createNestApplication({
    workingDirectory: root,
    dataDir: path.join(root, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      NODE_ENV: 'test',
      HOME: root,
      SHELL: shell,
      PATH: '/usr/bin:/bin',
      LANG: 'C',
      LC_ALL: 'C',
      OWNED_HOST: name,
      AUTOMAKER_API_KEY: 'fixture-secret',
      PORT: '0',
      DATA_DIR: path.join(root, 'data'),
      NODE_PATH: 'private-node-path',
      ALLOWED_ROOT_DIRECTORY: root,
      ENABLE_REQUEST_LOGGING: 'false',
    },
  });
  applications.push(owner);
  const settings = owner.app.get(SettingsService);
  await settings.updateGlobalSettings({
    terminalConfig: { ...(await settings.getGlobalSettings()).terminalConfig!, enabled: false },
  });
  return {
    ...owner,
    root,
    settings,
    terminal: owner.app.get(TerminalService),
    filesystem: owner.app.get<ScopedFs>(SECURE_FILESYSTEM),
  };
}
async function enable(f: Awaited<ReturnType<typeof fixture>>) {
  await f.settings.updateGlobalSettings({
    terminalConfig: {
      ...(await f.settings.getGlobalSettings()).terminalConfig!,
      enabled: true,
      customPrompt: false,
    },
  });
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  return { promise, release };
}

it.skipIf(process.platform !== 'linux')(
  'keeps two actual PTYs on their captured host environments after ambient mutation',
  async () => {
    const first = await fixture('first', '/bin/sh'),
      second = await fixture('second', '/bin/bash');
    vi.stubEnv('HOME', '/ambient-profile');
    vi.stubEnv('SHELL', '/not/a/shell');
    vi.stubEnv('LANG', 'ambient-locale');
    vi.stubEnv('OWNED_HOST', 'ambient');
    expect(first.terminal.detectShell().shell).toBe('/bin/sh');
    expect(second.terminal.detectShell().shell).toBe('/bin/bash');
    for (const [f, expected] of [
      [first, 'first'],
      [second, 'second'],
    ] as const) {
      // Explicit sh avoids login-shell profile policy changing the inherited environment.
      const session = await f.terminal.createSession({
        shell: '/bin/sh',
        env: { ENV: '', BASH_ENV: '' },
      });
      expect(session).not.toBeNull();
      f.terminal.write(
        session!.id,
        `printf 'OWNED_CHECK:%s:%s:%s:%s:%s:%s:%s\\n' "$OWNED_HOST" "$HOME" "$LANG" "$LC_ALL" "$AUTOMAKER_API_KEY" "$DATA_DIR" "$NODE_PATH"\n`
      );
      await vi.waitFor(() =>
        expect(f.terminal.getScrollback(session!.id)).toContain(
          `OWNED_CHECK:${expected}:${f.root}:C:C:::`
        )
      );
      await f.terminal.stopSession(session!.id);
    }
  }
);

it.skipIf(process.platform !== 'linux')(
  'uses canonical cwd for RC generation and rejects a symlink escape before PTY allocation',
  async () => {
    const f = await fixture('canonical');
    await enable(f);
    const project = path.join(f.root, 'project'),
      alias = path.join(f.root, 'alias');
    await fs.mkdir(project);
    await fs.symlink(project, alias);
    const reads = vi.spyOn(f.settings, 'getProjectSettings'),
      writes = vi.spyOn(f.filesystem, 'writeFile');
    const session = await f.terminal.createSession({
      cwd: alias,
      shell: '/bin/sh',
      env: { ENV: '' },
    });
    expect(session?.cwd).toBe(project);
    expect(reads).toHaveBeenCalledWith(project);
    expect(
      writes.mock.calls.some(([file]) =>
        String(file).startsWith(path.join(project, '.automaker/terminal'))
      )
    ).toBe(true);
    expect(writes.mock.calls.some(([file]) => String(file).startsWith(alias + path.sep))).toBe(
      false
    );
    await f.terminal.stopSession(session!.id);
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-outside-'));
    roots.push(outside);
    const other = path.join(f.root, 'other');
    await fs.mkdir(other);
    await fs.symlink(outside, path.join(other, '.automaker'));
    const spawn = vi.spyOn(pty, 'spawn');
    await expect(f.terminal.createSession({ cwd: other, shell: '/bin/sh' })).rejects.toBeDefined();
    expect(spawn).not.toHaveBeenCalled();
    expect(await fs.readdir(outside)).toEqual([]);
  }
);

it('drains held native RC creation before shutdown and never allocates a late PTY', async () => {
  const f = await fixture('held');
  await enable(f);
  const hold = gate(),
    entered = gate(),
    real = f.filesystem.writeFile.bind(f.filesystem);
  vi.spyOn(f.filesystem, 'writeFile').mockImplementation(async (...args) => {
    if (String(args[0]).includes('common.sh.tmp.')) {
      entered.release();
      await hold.promise;
    }
    return real(...args);
  });
  const spawn = vi.spyOn(pty, 'spawn');
  const creation = f.terminal.createSession({ cwd: f.root, shell: '/bin/sh' });
  await entered.promise;
  let done = false;
  const cleanup = vi.spyOn(f.terminal, 'cleanup');
  const close = f.app.close().then(() => {
    done = true;
  });
  await vi.waitFor(() => expect(cleanup).toHaveBeenCalled());
  await new Promise((resolve) => setImmediate(resolve));
  expect(done).toBe(false);
  expect(await f.terminal.createSession()).toBeNull();
  hold.release();
  expect(await creation).toBeNull();
  await close;
  expect(spawn).not.toHaveBeenCalled();
  expect(f.terminal.getSessionCount()).toBe(0);
});

it('propagates native RC IO failures before spawn and tracks accepted theme refresh through cleanup', async () => {
  const f = await fixture('io');
  await enable(f);
  const failure = Object.assign(new Error('fixture IO'), { code: 'EIO' }),
    real = f.filesystem.readFile.bind(f.filesystem);
  const read = vi.spyOn(f.filesystem, 'readFile').mockImplementation(async (...args) => {
    if (String(args[0]).endsWith('version.txt')) throw failure;
    return real(...args);
  });
  const spawn = vi.spyOn(pty, 'spawn');
  await expect(f.terminal.createSession({ cwd: f.root })).rejects.toBe(failure);
  expect(spawn).not.toHaveBeenCalled();
  read.mockRestore();
  const hold = gate(),
    entered = gate(),
    realWrite = f.filesystem.writeFile.bind(f.filesystem);
  vi.spyOn(f.filesystem, 'writeFile').mockImplementation(async (...args) => {
    if (String(args[0]).includes('common.sh.tmp.')) {
      entered.release();
      await hold.promise;
    }
    return realWrite(...args);
  });
  const update = f.terminal.onThemeChange(f.root, 'dark');
  await entered.promise;
  let closed = false;
  const close = f.terminal.cleanup().then(() => {
    closed = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(closed).toBe(false);
  hold.release();
  await update;
  await close;
  const count = (f.filesystem.writeFile as ReturnType<typeof vi.fn>).mock.calls.length;
  await f.terminal.onThemeChange(f.root, 'light');
  expect((f.filesystem.writeFile as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(count);
});
