import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { secureFs, ensureRcFilesUpToDate, type TerminalConfig } from '@automaker/platform';
import {
  getAllTerminalThemes,
  getTerminalThemeColors,
} from '../../../src/lib/terminal-themes-data.js';
import { createTerminalHostPort } from '../../../src/core/platform/terminal-host.runtime.js';
import { TerminalRcFilesAdapter } from '../../../src/core/platform/terminal-rc-files.adapter.js';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-config-unit-'));
  directories.push(root);
  return root;
}
const config: TerminalConfig = {
  enabled: true,
  customPrompt: true,
  promptFormat: 'standard',
  showGitBranch: true,
  showGitStatus: true,
  showUserHost: true,
  showPath: true,
  pathStyle: 'full',
  pathDepth: 0,
  showTime: false,
  showExitStatus: false,
  customAliases: '',
  customEnvVars: { Z: 'z', A: 'a' },
};

it('captures host environment independently and probes only explicit absolute shell paths', () => {
  const input = { SHELL: '/bin/sh', HOME: '/private/profile', COMSPEC: 'C:\\private\\cmd.exe' };
  const first = createTerminalHostPort(input, 'linux');
  input.SHELL = '/mutated';
  vi.stubEnv('HOME', '/ambient-mutated');
  expect(first.environment.SHELL).toBe('/bin/sh');
  expect(first.environment.HOME).toBe('/private/profile');
  expect(Object.isFrozen(first.environment)).toBe(true);
  expect(first.shellExists(process.execPath)).toBe(false);
  expect(first.shellExists('sh')).toBe(false);
  const windows = createTerminalHostPort(input, 'win32');
  expect(windows.shellPaths).toContain(input.COMSPEC);
  expect(windows.wslVersion()).toBeUndefined();
});

it('writes exactly the established RC/version/signature contents with scoped IO and private unique temps', async () => {
  const root = await fixture(),
    native = path.join(root, 'native'),
    legacy = path.join(root, 'legacy');
  const scoped = secureFs.createSecureFs((candidate) => {
    const resolved = path.resolve(candidate);
    if (!resolved.startsWith(root + path.sep)) throw new Error('outside fixture');
    return resolved;
  });
  const writes = vi.spyOn(scoped, 'writeFile');
  const adapter = new TerminalRcFilesAdapter(scoped),
    colors = getTerminalThemeColors('dark'),
    themes = getAllTerminalThemes();
  try {
    await Promise.all([
      adapter.ensure(native, 'dark', config, colors, themes),
      adapter.ensure(native, 'dark', config, colors, themes),
    ]);
    await ensureRcFilesUpToDate(legacy, 'dark', config, colors, themes);
    const files = await fs.readdir(path.join(native, '.automaker/terminal'), { recursive: true });
    for (const file of files) {
      const own = path.join(native, '.automaker/terminal', file);
      if (!(await fs.stat(own)).isFile()) continue;
      expect(await fs.readFile(own), file).toEqual(
        await fs.readFile(path.join(legacy, '.automaker/terminal', file))
      );
      if (process.platform !== 'win32') expect((await fs.stat(own)).mode & 0o777).toBe(0o600);
    }
    expect(files.some((file) => file.includes('.tmp.'))).toBe(false);
    const count = writes.mock.calls.length;
    await adapter.ensure(native, 'dark', config, colors, themes);
    expect(writes.mock.calls).toHaveLength(count);
    const targets = writes.mock.calls.map(([file]) => String(file));
    expect(new Set(targets).size).toBe(targets.length);
    for (const [, , options] of writes.mock.calls)
      expect(options).toMatchObject({ mode: 0o600, flag: 'wx' });
  } finally {
    await scoped.close();
  }
});

it('does not convert IO failure into regeneration success and leaves exclusive-create collisions untouched', async () => {
  const root = await fixture(),
    scoped = secureFs.createSecureFs((value) => path.resolve(value));
  const adapter = new TerminalRcFilesAdapter(scoped),
    colors = getTerminalThemeColors('dark'),
    themes = getAllTerminalThemes();
  const failure = Object.assign(new Error('fixture IO'), { code: 'EIO' });
  const read = vi.spyOn(scoped, 'readFile').mockRejectedValueOnce(failure),
    write = vi.spyOn(scoped, 'writeFile');
  await expect(adapter.ensure(root, 'dark', config, colors, themes)).rejects.toBe(failure);
  expect(write).not.toHaveBeenCalled();
  read.mockRestore();
  const collision = Object.assign(new Error('fixture collision'), { code: 'EEXIST' });
  write.mockRejectedValueOnce(collision);
  const remove = vi.spyOn(scoped, 'rm');
  await expect(adapter.ensure(root, 'dark', config, colors, themes)).rejects.toBe(collision);
  expect(remove).not.toHaveBeenCalled();
  write.mockRestore();
  const rename = vi.spyOn(scoped, 'rename').mockRejectedValueOnce(collision);
  await expect(adapter.ensure(root, 'dark', config, colors, themes)).rejects.toBe(collision);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(await fs.readdir(path.join(root, '.automaker/terminal'))).toEqual(['themes']);
  rename.mockRestore();
  await adapter.ensure(root, 'dark', config, colors, themes);
  await scoped.close();
});
