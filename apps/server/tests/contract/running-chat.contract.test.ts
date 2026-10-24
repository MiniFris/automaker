import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { MockProvider } from '../helpers/mock-provider.js';
import type { ExecuteOptions } from '../../src/providers/types.js';

it('lists native chat leases through cancellation cleanup without exposing prompts or stale persisted jobs', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-running-chat-'));
  let release!: () => void;
  const cleanup = new Promise<void>((resolve) => {
    release = resolve;
  });
  let aborted = false,
    started = false;
  const provider = new MockProvider('claude');
  provider.executeQuery = async function* (options: ExecuteOptions) {
    started = true;
    const stop = new Promise<void>((resolve) =>
      options.abortController!.signal.addEventListener(
        'abort',
        () => {
          aborted = true;
          resolve();
        },
        { once: true }
      )
    );
    try {
      yield {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Partial reply' }] },
      };
      await stop;
    } finally {
      await cleanup;
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
  try {
    await runtime.start();
    const { port } = runtime.app.getHttpServer().address() as AddressInfo;
    const request = async (route: string, body?: object) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/${route}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', 'x-api-key': 'automaker-test-api-key' },
        body: body ? JSON.stringify(body) : undefined,
      });
      expect(response.status).toBe(200);
      return response.json();
    };
    const created = await request('sessions', {
      name: 'Named chat',
      projectPath: directory,
      workingDirectory: directory,
      model: 'sonnet',
    });
    const sessionId = created.session.id;
    expect((await request('running-agents')).runningAgents).toEqual([]);
    await request('agent/send', { sessionId, message: 'Never expose this private prompt' });
    await vi.waitFor(async () =>
      expect((await request('running-agents')).runningAgents).toMatchObject([
        { kind: 'chat', sessionId, title: 'Named chat' },
      ])
    );
    expect(JSON.stringify(await request('running-agents'))).not.toContain('Never expose');
    await vi.waitFor(() => expect(started).toBe(true));
    const stopping = request('agent/stop', { sessionId });
    await vi.waitFor(() => expect(aborted).toBe(true));
    expect((await request('running-agents')).totalCount).toBe(1);
    release();
    expect((await stopping).success).toBe(true);
    expect((await request('running-agents')).runningAgents).toEqual([]);
    await request('agent/start', { sessionId });
    expect((await request('running-agents')).totalCount).toBe(0);
  } finally {
    release();
    await runtime.app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
