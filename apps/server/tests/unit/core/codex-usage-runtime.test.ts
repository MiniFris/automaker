import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { NodeCodexUsageRuntime } from '../../../src/core/platform/codex-usage.runtime.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});
async function root() {
  const value = await mkdtemp(path.join(os.tmpdir(), 'automaker-codex-discovery-'));
  directories.push(value);
  return value;
}

it('resolves relative PATH and CODEX_HOME from application cwd, not the host cwd', async () => {
  const directory = await root();
  await mkdir(path.join(directory, 'bin'));
  const executable = path.join(
    directory,
    'bin',
    process.platform === 'win32' ? 'codex.exe' : 'codex'
  );
  await writeFile(executable, 'offline-fixture', { mode: 0o700 });
  const environment = {
    HOME: directory,
    PATH: 'bin',
    CODEX_HOME: 'profile',
    OPENAI_API_KEY: 'fixture',
  };
  const runtime = new NodeCodexUsageRuntime(async () => environment, directory);
  const snapshot = await runtime.snapshot();
  expect(snapshot.cliPath).toBe(executable);
  expect(snapshot.authFilePath).toBe(path.join(directory, 'profile', 'auth.json'));
  environment.OPENAI_API_KEY = 'changed';
  expect(snapshot.environment.OPENAI_API_KEY).toBe('fixture');
});
it.skipIf(process.platform === 'win32')(
  'retains NVM/fnm discovery scoped to the application home',
  async () => {
    const directory = await root();
    const bin = path.join(directory, '.nvm', 'versions', 'node', 'v22.0.0', 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, 'codex'), 'fixture', { mode: 0o700 });
    const runtime = new NodeCodexUsageRuntime(
      async () => ({ HOME: directory, PATH: '' }),
      directory
    );
    expect((await runtime.snapshot()).cliPath).toBe(path.join(bin, 'codex'));
  }
);
it('does not fall back to ambient credentials when the reader fails', async () => {
  const runtime = new NodeCodexUsageRuntime(
    async () => {
      throw new Error('unavailable');
    },
    await root()
  );
  await expect(runtime.snapshot()).rejects.toThrow('unavailable');
});
it('bounds auth file reads and closes the owned file handle on failure', async () => {
  const directory = await root();
  const file = path.join(directory, 'auth.json');
  await writeFile(file, Buffer.alloc(1048577));
  const runtime = new NodeCodexUsageRuntime(async () => ({}), directory);
  await expect(runtime.readAuth(directory)).rejects.toThrow();
  await expect(runtime.readAuth(file)).rejects.toThrow('exceeds its limit');
  await writeFile(file, '{"tokens":{}}');
  expect(await runtime.readAuth(file)).toBe('{"tokens":{}}');
});
