import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { expect, it, vi } from 'vitest';
import { createTestAgentState, createTestAgentEvents } from '../helpers/agent-state.js';
import { createEventEmitter } from '../../src/lib/events.js';

it.each(['claimed', 'dequeued', 'completed'] as const)(
  'recovers queued handoff after SIGKILL at %s without replay',
  async (stage) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-queue-crash-'));
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'tests/fixtures/queue-delivery-crash.ts'],
      {
        cwd: path.resolve(import.meta.dirname, '../..'),
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DATA_DIR: directory,
          ALLOWED_ROOT_DIRECTORY: '',
          DELIVERY_CRASH_STAGE: stage,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    const closed = once(child, 'close');
    let output = '',
      timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Queue fixture did not start: ${output}`)), 8000);
        child.once('error', reject);
        child.once('close', () => reject(new Error(`Queue fixture exited early: ${output}`)));
        child.stderr.on('data', (chunk) => {
          output += chunk.toString();
        });
        child.stdout.on('data', (chunk) => {
          output += chunk.toString();
          if (
            output.split('\n').some((line) => line.startsWith('{"event":"queue-delivery-ready",'))
          )
            resolve();
        });
      });
      clearTimeout(timer);
      child.kill('SIGKILL');
      await closed;
      expect(child.signalCode).toBe('SIGKILL');
      const state = createTestAgentState(directory, createTestAgentEvents(createEventEmitter()));
      const session = await state[6].ensure('crash-session');
      const execute = vi.fn();
      await state[8].process('crash-session', execute);
      expect(execute).not.toHaveBeenCalled();
      if (stage === 'completed') {
        expect(session?.sdkSessionId).toBe('must-not-resume-unknown');
        expect(session?.messages.at(-1)?.content).toBe('Durable answer');
        expect(session?.promptQueue).toEqual([]);
      } else {
        expect(session?.sdkSessionId).toBeUndefined();
        expect(session?.promptQueue[0]).toMatchObject({
          id: 'crash-prompt',
          deliveryStatus: 'interrupted',
        });
        expect(session?.messages.at(-1)?.content).toContain('No automatic replay');
      }
      await state[2].onApplicationShutdown();
      await state[0].drain();
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed.catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  },
  15_000
);
