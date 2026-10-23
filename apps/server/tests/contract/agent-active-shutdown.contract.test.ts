import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { expect, it } from 'vitest';

it.each(['SIGTERM', 'SIGINT'] as const)(
  'persists interruption and finishes an active provider before process exit on %s',
  async (signal) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-active-agent-signal-'));
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'tests/fixtures/active-agent-shutdown-server.ts'],
      {
        cwd: path.resolve(import.meta.dirname, '../..'),
        env: {
          ...process.env,
          NODE_ENV: 'test',
          AUTOMAKER_RUN_MAIN: '0',
          DATA_DIR: directory,
          ALLOWED_ROOT_DIRECTORY: '',
          AUTOMAKER_HIDE_API_KEY: 'true',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    const closed = once(child, 'close');
    let output = '',
      readyTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const { sessionId } = await new Promise<{ sessionId: string }>((resolve, reject) => {
        readyTimer = setTimeout(
          () => reject(new Error(`Active fixture did not start: ${output}`)),
          8000
        );
        child.once('error', reject);
        child.once('close', () => reject(new Error(`Active fixture exited early: ${output}`)));
        child.stderr.on('data', (chunk) => {
          output += chunk.toString();
        });
        child.stdout.on('data', (chunk) => {
          output += chunk.toString();
          for (const line of output.split('\n'))
            if (line.startsWith('{"event":"active-agent-ready",')) resolve(JSON.parse(line));
        });
      });
      clearTimeout(readyTimer);
      child.kill(signal);
      const forced = setTimeout(() => child.kill('SIGKILL'), 5000);
      try {
        await closed;
      } finally {
        clearTimeout(forced);
      }
      expect(child.exitCode, output).toBe(0);
      expect(
        JSON.parse(await readFile(path.join(directory, 'provider-cleanup.json'), 'utf8'))
      ).toEqual({ aborted: true, interruptionPersistedBeforeCleanup: true });
      const messages = JSON.parse(
        await readFile(path.join(directory, 'agent-sessions', `${sessionId}.json`), 'utf8')
      ) as Array<{ content: string }>;
      expect(messages.some((message) => message.content.includes('Partial fixture reply'))).toBe(
        true
      );
      expect(messages.some((message) => message.content.startsWith('Interrupted:'))).toBe(true);
    } finally {
      clearTimeout(readyTimer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed.catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  },
  15_000
);
