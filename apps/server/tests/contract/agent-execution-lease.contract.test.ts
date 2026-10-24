import { APPLICATION_EVENTS } from '../../src/core/eventing/application-events.js';
import type { EventEmitter } from '../../src/lib/events.js';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { AgentService } from '../../src/services/agent-service.js';
import { MockProvider } from '../helpers/mock-provider.js';
import type { ExecuteOptions } from '../../src/providers/types.js';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

it('rejects duplicate HTTP admission without erroring the original stream, and acknowledges stop only after cleanup', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-agent-http-lease-'));
  const started = gate(),
    aborted = gate(),
    cleanup = gate();
  let immediate = false,
    disposed = false;
  const provider = new MockProvider('claude');
  provider.executeQuery = async function* (options: ExecuteOptions) {
    if (immediate) {
      yield {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Fresh reply' }] },
      };
      yield { type: 'result', subtype: 'success' };
      return;
    }
    const stopping = new Promise<void>((resolve) =>
      options.abortController!.signal.addEventListener('abort', () => resolve(), { once: true })
    );
    try {
      yield {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Partial reply' }] },
      };
      started.release();
      await stopping;
      aborted.release();
      await cleanup.promise;
      yield {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'LATE CHUNK' }] },
      };
    } finally {
      disposed = true;
    }
  };
  const runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    dataDir: directory,
    runStartupTasks: false,
    enableShutdownHooks: false,
    workingDirectory: directory,
    providerRegistrations: [{ name: 'claude', create: () => provider }],
  });
  const events: Array<{ type: string }> = [];
  runtime.app.get<EventEmitter>(APPLICATION_EVENTS).subscribe((type, payload) => {
    if (type === 'agent:stream') events.push(payload as (typeof events)[number]);
  });
  try {
    await runtime.start();
    const sessionId = (
      await runtime.app.get(AgentService).createSession('Fixture', directory, directory, 'sonnet')
    ).id;
    const { port } = runtime.app.getHttpServer().address() as AddressInfo;
    const request = (route: string, body: object, method = 'POST') =>
      fetch(`http://127.0.0.1:${port}/api/${route}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-api-key': 'automaker-test-api-key' },
        body: JSON.stringify(body),
      });
    expect((await request('agent/send', { sessionId, message: 'First' })).status).toBe(200);
    await started.promise;
    expect((await request('agent/send', { sessionId, message: 'Duplicate' })).status).toBe(409);
    expect((await request('agent/model', { sessionId, model: 'claude-opus' })).status).toBe(409);
    expect((await request(`sessions/${sessionId}`, { model: 'claude-opus' }, 'PUT')).status).toBe(
      409
    );
    expect(events.some((event) => event.type === 'error')).toBe(false);
    let stopFinished = false;
    const stopping = request('agent/stop', { sessionId }).then((response) => {
      stopFinished = true;
      return response;
    });
    await aborted.promise;
    expect(stopFinished).toBe(false);
    expect(disposed).toBe(false);
    expect((await request('agent/send', { sessionId, message: 'Too early' })).status).toBe(409);
    expect(
      (await request('agent/queue/add', { sessionId, message: 'Too early queued work' })).status
    ).toBe(409);
    expect((await request('agent/start', { sessionId })).status).toBe(409);
    cleanup.release();
    expect((await stopping).status).toBe(200);
    expect(disposed).toBe(true);
    const partial = await (await request('agent/history', { sessionId })).json();
    expect(partial.isRunning).toBe(false);
    expect(partial.messages).toHaveLength(2);
    expect(JSON.stringify(partial.messages)).not.toContain('LATE CHUNK');
    expect(events.some((event) => event.type === 'complete')).toBe(false);
    immediate = true;
    expect((await request('agent/send', { sessionId, message: 'Fresh' })).status).toBe(200);
    await vi.waitFor(async () => {
      const history = await (await request('agent/history', { sessionId })).json();
      expect(history.isRunning).toBe(false);
      expect(history.messages).toHaveLength(4);
    });
    expect(events.filter((event) => event.type === 'complete')).toHaveLength(1);
  } finally {
    cleanup.release();
    await runtime.app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
