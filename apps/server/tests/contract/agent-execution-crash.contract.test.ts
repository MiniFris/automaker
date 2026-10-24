import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { AgentSessionRepository } from '../../src/services/agent/agent-session.repository.js';
import { MockProvider } from '../helpers/mock-provider.js';

it.each(['before-history', 'running', 'intent', 'history', 'settled', 'queued-ledger'] as const)(
  'recovers native Nest execution after SIGKILL at %s without replay',
  async (stage) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-execution-crash-'));
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'tests/fixtures/agent-execution-crash-server.ts'],
      {
        cwd: path.resolve(import.meta.dirname, '../..'),
        env: {
          ...process.env,
          NODE_ENV: 'test',
          AUTOMAKER_RUN_MAIN: '0',
          DATA_DIR: directory,
          ALLOWED_ROOT_DIRECTORY: '',
          EXECUTION_CRASH_STAGE: stage,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    const closed = once(child, 'close');
    let output = '',
      timer: ReturnType<typeof setTimeout> | undefined;
    let runtime: Awaited<ReturnType<typeof createNestApplication>> | undefined;
    try {
      const ready = await new Promise<{ sessionId: string; calls: number; closed: boolean }>(
        (resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Execution fixture did not start: ${output}`)),
            8000
          );
          child.once('error', reject);
          child.once('close', () => reject(new Error(`Execution fixture exited early: ${output}`)));
          child.stderr.on('data', (chunk) => {
            output += chunk.toString();
          });
          child.stdout.on('data', (chunk) => {
            output += chunk.toString();
            for (const line of output.split('\n'))
              if (line.startsWith('{"event":"agent-execution-ready",')) resolve(JSON.parse(line));
          });
        }
      );
      clearTimeout(timer);
      expect(ready.calls).toBe(stage === 'before-history' ? 0 : stage === 'queued-ledger' ? 2 : 1);
      expect(ready.closed).toBe(!['before-history', 'running'].includes(stage));
      child.kill('SIGKILL');
      await closed;
      expect(child.signalCode).toBe('SIGKILL');
      const provider = new MockProvider('claude');
      const execute = vi.spyOn(provider, 'executeQuery');
      runtime = await createNestApplication({
        host: '127.0.0.1',
        port: 0,
        dataDir: directory,
        runStartupTasks: false,
        enableShutdownHooks: false,
        workingDirectory: directory,
        providerRegistrations: [{ name: 'claude', create: () => provider }],
      });
      await runtime.start();
      const { port } = runtime.app.getHttpServer().address() as AddressInfo;
      const post = async (route: string) => {
        const response = await fetch(`http://127.0.0.1:${port}/api/agent/${route}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': 'automaker-test-api-key' },
          body: JSON.stringify({ sessionId: ready.sessionId }),
        });
        const result = await response.json();
        expect(response.status, JSON.stringify(result)).toBe(200);
        return result;
      };
      const started = await post('start');
      const unknown = ['before-history', 'running'].includes(stage);
      expect(started.messages).toHaveLength(stage === 'queued-ledger' ? 4 : 2);
      if (stage === 'queued-ledger')
        expect(started.messages[2]).toMatchObject({
          content: 'Queued once',
          executionStatus: 'completed',
          deliveryStatus: 'completed',
        });
      expect(started.messages[0]).toMatchObject({
        content: 'Execute once',
        runId: expect.any(String),
        executionStatus: unknown ? 'interrupted' : 'completed',
      });
      expect(started.messages[1].content).toBe(
        unknown
          ? 'Interrupted: An agent execution did not commit a terminal result. Its target effects may be unknown. Inspect history and target state before explicitly submitting another request. No automatic replay was performed.'
          : 'Durable fixture answer'
      );
      const repository = runtime.app.get(AgentSessionRepository);
      expect((await repository.loadMetadata())[ready.sessionId].sdkSessionId).toBe(
        unknown ? undefined : 'fixture-sdk'
      );
      expect((await post('history')).messages).toEqual(started.messages);
      expect((await post('queue/list')).queue).toEqual([]);
      expect(execute).not.toHaveBeenCalled();
      const journal = JSON.parse(
        await readFile(path.join(directory, 'agent-executions', `${ready.sessionId}.json`), 'utf8')
      );
      expect(journal).toMatchObject({
        phase: 'settled',
        status: unknown ? 'interrupted' : 'completed',
      });
      expect(journal).not.toHaveProperty('messages');
      await post('clear');
      expect((await post('start')).messages).toEqual([]);
      expect(execute).not.toHaveBeenCalled();
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed.catch(() => undefined);
      if (runtime) await runtime.app.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  20_000
);
