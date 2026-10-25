import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'child_process';
import * as fs from 'fs';
import { afterEach, expect, it, vi } from 'vitest';
import { CursorProvider } from '../../../src/providers/cursor-provider.js';

vi.mock('child_process', async (original) => ({
  ...(await original<typeof import('child_process')>()),
  execSync: vi.fn(),
}));
vi.mock('fs', async (original) => ({
  ...(await original<typeof import('fs')>()),
  readFileSync: vi.fn(),
}));
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function root() {
  const value = await mkdtemp(path.join(os.tmpdir(), 'automaker-cursor-hints-'));
  roots.push(value);
  return value;
}

it('reports key/file hints without reading credentials or launching any CLI command, including WSL auth probes', async () => {
  const directory = await root();
  await writeFile(path.join(directory, 'credentials.json'), 'private-secret-invalid-json');
  const provider = new CursorProvider({}, async () => ({
    CURSOR_CONFIG_DIR: directory,
    CURSOR_API_KEY: 'private-opaque-key',
  }));
  Object.assign(provider, { useWsl: true, wslCliPath: '/fixture/cursor-agent' });
  expect(await provider.checkAuth()).toEqual({
    authenticated: false,
    authenticationChecked: false,
    scope: 'host',
    method: 'api_key',
    hasEnvApiKey: true,
    hasCredentialsFile: true,
  });
  expect(execSync).not.toHaveBeenCalled();
  expect(fs.readFileSync).not.toHaveBeenCalled();
});
it('does not inherit host credentials when an application supplies its own empty profile', async () => {
  const directory = await root();
  const provider = new CursorProvider({}, async () => ({ HOME: directory }));
  expect(await provider.checkAuth()).toEqual({
    authenticated: false,
    authenticationChecked: false,
    scope: 'host',
    method: 'none',
    hasEnvApiKey: false,
    hasCredentialsFile: false,
  });
  expect(execSync).not.toHaveBeenCalled();
});
it('does not treat a directory as a credential file', async () => {
  const directory = await root();
  await mkdir(path.join(directory, 'credentials.json'));
  const provider = new CursorProvider({}, async () => ({ CURSOR_CONFIG_DIR: directory }));
  expect((await provider.checkAuth()).hasCredentialsFile).toBe(false);
});
it('returns only a static metadata inspection error', async () => {
  const provider = new CursorProvider({}, async () => ({ CURSOR_CONFIG_DIR: '/offline' }));
  const stat = vi
    .spyOn(fs.promises, 'stat')
    .mockRejectedValue(new Error('private-command-or-path'));
  expect(await provider.checkAuth()).toMatchObject({
    authenticated: false,
    authenticationChecked: false,
    error: 'Local configuration could not be inspected.',
  });
  expect(stat).toHaveBeenCalledOnce();
});
it('does not execute a command when environment resolution fails', async () => {
  const provider = new CursorProvider({}, async () => {
    throw new Error('unavailable');
  });
  await expect(provider.checkAuth()).rejects.toThrow('unavailable');
  expect(execSync).not.toHaveBeenCalled();
});
it('passes the application environment to a separate version probe without converting it to authentication', async () => {
  const directory = await root();
  const provider = new CursorProvider({}, async () => ({ HOME: directory, FIXTURE: 'owned' }));
  Object.assign(provider, { cliPath: '/fixture/cursor-agent' });
  vi.mocked(execSync).mockReturnValue('offline-version\n');
  expect(await provider.getVersion()).toBe('offline-version');
  expect(execSync).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ env: { HOME: directory, FIXTURE: 'owned' } })
  );
  expect((await provider.checkAuth()).authenticated).toBe(false);
  expect(execSync).toHaveBeenCalledOnce();
});
