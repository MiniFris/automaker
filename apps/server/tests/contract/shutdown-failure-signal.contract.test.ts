import { fork } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

it('exits nonzero on SIGTERM cleanup failure only after later owners have been attempted', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-failed-signal-'));
  const marker = path.join(directory, 'providers.closed');
  const child = fork(path.resolve(import.meta.dirname, '../fixtures/failed-shutdown-server.ts'), {
    cwd: path.resolve(import.meta.dirname, '../..'),
    silent: true,
    execArgv: ['--import', 'tsx'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      AUTOMAKER_RUN_MAIN: '0',
      DATA_DIR: directory,
      SHUTDOWN_MARKER: marker,
    },
  });
  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-1024 * 1024);
  });
  child.stdout?.on('data', () => {});
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  try {
    await Promise.race([
      new Promise<void>((resolve) => child.once('message', () => resolve())),
      exited.then(() => {
        throw new Error(`Shutdown fixture exited before readiness: ${stderr}`);
      }),
    ]);
    child.kill('SIGTERM');
    expect(await exited).toBe(1);
    expect(await readFile(marker, 'utf8')).toBe('closed');
    expect(stderr).not.toContain('private-signal-fixture');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
