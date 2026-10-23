import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';
import { AgentSessionRegistry } from '../../src/services/agent/agent-session-registry.js';
import { MockProvider } from '../helpers/mock-provider.js';

it('preserves native agent response/event IDs, history and follow-up after restarting the state owners', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-agent-native-state-'));
  const project = path.join(directory, 'project');
  await mkdir(project);
  const runtimes: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const events: Array<{ sessionId: string; type: string; messageId?: string }> = [];
  const start = async () => {
    const providerRegistry = new ProviderRegistry(
      [{ name: 'claude', create: () => new MockProvider('claude') }],
      { isDisconnected: () => false } as never
    );
    const runtime = await createNestApplication({
      host: '127.0.0.1',
      port: 0,
      dataDir: directory,
      runStartupTasks: false,
      enableShutdownHooks: false,
      services: { providerRegistry },
    });
    runtimes.push(runtime);
    runtime.legacy.events.subscribe((type, payload) => {
      if (type === 'agent:stream') events.push(payload as (typeof events)[number]);
    });
    await runtime.start();
    const { port } = runtime.app.getHttpServer().address() as AddressInfo;
    const post = async (route: string, body: object, expectedStatus = 200) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': 'automaker-test-api-key' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      expect(response.status, JSON.stringify(payload)).toBe(expectedStatus);
      return payload;
    };
    return { runtime, post };
  };
  try {
    const first = await start();
    for (const sessionId of ['../outside', '/absolute', '__proto__', 'constructor', 'one-queue']) {
      await first.post('agent/start', { sessionId }, 400);
      await first.post('agent/send', { sessionId, message: 'Must not execute' }, 400);
    }
    const created = await first.post('sessions', {
      name: 'State fixture',
      projectPath: project,
      workingDirectory: project,
      model: 'sonnet',
    });
    const sessionId = created.session.id as string;
    expect((await first.post('agent/start', { sessionId })).sessionId).toBe(sessionId);
    expect((await first.post('agent/send', { sessionId, message: 'First question' })).success).toBe(
      true
    );
    let initialIds: string[] = [];
    await vi.waitFor(async () => {
      const history = await first.post('agent/history', { sessionId });
      expect(history.isRunning).toBe(false);
      expect(history.messages).toHaveLength(2);
      expect(history.messages[1].content).toBe('Mock agent output for testing.');
      initialIds = history.messages.map((message: { id: string }) => message.id);
    });
    expect(events.map((event) => event.type)).toEqual(['started', 'message', 'stream', 'complete']);
    expect(events[2].messageId).toBe(initialIds[1]);
    expect(events[3].messageId).toBe(initialIds[1]);
    expect(
      (await first.post('agent/queue/add', { sessionId, message: 'Queued without images' })).success
    ).toBe(true);
    expect((await first.post('agent/queue/list', { sessionId })).queue).toHaveLength(1);
    await first.post('agent/queue/clear', { sessionId });
    const beforeFollowUp = events.length;
    await first.runtime.app.close();
    expect(first.runtime.app.get(AgentSessionRegistry).size).toBe(0);

    const restarted = await start();
    const history = await restarted.post('agent/history', { sessionId });
    expect(history.messages.map((message: { id: string }) => message.id)).toEqual(initialIds);
    expect(
      (await restarted.post('agent/send', { sessionId, message: 'Follow-up question' })).success
    ).toBe(true);
    await vi.waitFor(async () => {
      const followUp = await restarted.post('agent/history', { sessionId });
      expect(followUp.isRunning).toBe(false);
      expect(followUp.messages).toHaveLength(4);
      expect(followUp.messages.slice(0, 2).map((message: { id: string }) => message.id)).toEqual(
        initialIds
      );
    });
    expect(events.slice(beforeFollowUp).map((event) => event.type)).toEqual([
      'started',
      'message',
      'stream',
      'complete',
    ]);
    expect(events.every((event) => event.sessionId === sessionId)).toBe(true);
  } finally {
    for (const runtime of runtimes) await runtime.app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
