import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { createTestAgentState, createTestAgentEvents } from '../helpers/agent-state.js';
import { createEventEmitter } from '../../src/lib/events.js';
import { createNestApplication } from '../../src/main.js';
import { AgentSessionRepository } from '../../src/services/agent/agent-session.repository.js';
import { AgentSessionStorageError } from '../../src/services/agent/agent-session-storage.error.js';

it.each(['marked', 'artifacts', 'metadata'] as const)(
  'retries deletion after SIGKILL at %s without resurrecting or invoking a provider',
  async (stage) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-deletion-crash-'));
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'tests/fixtures/session-deletion-crash.ts'],
      {
        cwd: path.resolve(import.meta.dirname, '../..'),
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DATA_DIR: directory,
          ALLOWED_ROOT_DIRECTORY: '',
          DELETION_CRASH_STAGE: stage,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    const closed = once(child, 'close');
    let output = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Deletion fixture did not start: ${output}`)),
          8000
        );
        child.once('error', reject);
        child.once('close', () => reject(new Error(`Deletion fixture exited early: ${output}`)));
        child.stderr.on('data', (chunk) => {
          output += chunk.toString();
        });
        child.stdout.on('data', (chunk) => {
          output += chunk.toString();
          if (
            output.split('\n').some((line) => line.startsWith('{"event":"session-deletion-ready",'))
          )
            resolve();
        });
      });
      clearTimeout(timer);
      child.kill('SIGKILL');
      await closed;
      expect(child.signalCode).toBe('SIGKILL');
      const state = createTestAgentState(directory, createTestAgentEvents(createEventEmitter()));
      expect(await state[6].ensure('crash-session')).toBeNull();
      expect(await state[0].loadMetadata()).not.toHaveProperty('crash-session');
      await expect(state[0].saveMessages('crash-session', [])).rejects.toThrow('deleted');
      const execute = vi.fn();
      await state[8].process('crash-session', execute);
      expect(execute).not.toHaveBeenCalled();
      expect(await state[9].remove('crash-session')).toBe(true);
      expect(await state[9].remove('crash-session')).toBe(false);
      expect(await state[0].loadMessages('retained-session')).toHaveLength(1);
      for (const relative of [
        'agent-sessions/crash-session.json',
        'agent-sessions/crash-session-queue.json',
        'agent-queue-deliveries/crash-session.json',
        'agent-executions/crash-session.json',
      ])
        await expect(stat(path.join(directory, relative))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      expect(
        JSON.parse(
          await readFile(path.join(directory, 'agent-session-deletions/crash-session.json'), 'utf8')
        ).phase
      ).toBe('deleted');
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

it('serves retryable DELETE through native Nest HTTP and rejects reuse of a deleted ID', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-deletion-http-'));
  const runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    dataDir: directory,
    runStartupTasks: false,
    enableShutdownHooks: false,
  });
  try {
    await runtime.start();
    const { port } = runtime.app.getHttpServer().address() as AddressInfo;
    const request = async (route: string, method: string, status: number, body?: object) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/${route}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-api-key': 'automaker-test-api-key' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = await response.json();
      expect(response.status, JSON.stringify(payload)).toBe(status);
      return payload;
    };
    const first = await request('sessions', 'POST', 200, {
      name: 'Delete fixture',
      workingDirectory: directory,
    });
    const second = await request('sessions', 'POST', 200, {
      name: 'Retained fixture',
      workingDirectory: directory,
    });
    const id = first.session.id as string;
    const repository = runtime.app.get(AgentSessionRepository);
    const fault = vi
      .spyOn(repository, 'purgeMetadataSnapshots')
      .mockRejectedValueOnce(new AgentSessionStorageError('write'));
    const failed = await request(`sessions/${id}`, 'DELETE', 503);
    expect(JSON.stringify(failed)).not.toContain(directory);
    await request(`sessions/${id}`, 'GET', 404);
    const listed = await request('sessions', 'GET', 200);
    expect(listed.sessions.map((entry: { id: string }) => entry.id)).toEqual([second.session.id]);
    await request('agent/start', 'POST', 409, { sessionId: id });
    fault.mockRestore();
    await request(`sessions/${id}`, 'DELETE', 200);
    await request(`sessions/${id}`, 'DELETE', 404);
    await request(`sessions/${id}`, 'PUT', 404, { name: 'Must not resurrect' });
    await request(`sessions/${id}/archive`, 'POST', 404, {});
    await request(`sessions/${id}/unarchive`, 'POST', 404, {});
    await request('agent/start', 'POST', 409, { sessionId: id });
    await request(`sessions/${second.session.id}`, 'GET', 200);
  } finally {
    vi.restoreAllMocks();
    await runtime.app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
