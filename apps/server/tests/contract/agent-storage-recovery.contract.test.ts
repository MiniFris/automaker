import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { AgentService } from '../../src/services/agent-service.js';
import { AgentSessionRegistry } from '../../src/services/agent/agent-session-registry.js';
import { AgentSessionRepository } from '../../src/services/agent/agent-session.repository.js';
import { AgentSessionStorageError } from '../../src/services/agent/agent-session-storage.error.js';

it('returns safe 503 errors instead of empty HTTP state and recovers only validated committed messages', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-agent-http-storage-'));
  const runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    dataDir: directory,
    runStartupTasks: false,
    enableShutdownHooks: false,
  });
  try {
    const agents = runtime.app.get(AgentService);
    await agents.initialize();
    const session = await agents.createSession('Fixture', directory, directory, 'sonnet');
    await runtime.start();
    const { port } = runtime.app.getHttpServer().address() as AddressInfo;
    const base = `http://127.0.0.1:${port}/api`;
    const headers = { 'Content-Type': 'application/json', 'x-api-key': 'automaker-test-api-key' };
    const metadataFile = path.join(directory, 'sessions-metadata.json');
    const savedMetadata = await readFile(metadataFile, 'utf8');
    await writeFile(metadataFile, '{"private-session-prompt":');
    const listing = await fetch(`${base}/sessions`, { headers });
    expect(listing.status).toBe(503);
    const body = await listing.json();
    expect(body).toMatchObject({ success: false, errorCode: 'UNAVAILABLE' });
    expect(JSON.stringify(body)).not.toContain('private-session-prompt');
    expect(await readFile(metadataFile, 'utf8')).toBe('{"private-session-prompt":');
    await writeFile(metadataFile, savedMetadata);

    const file = path.join(directory, 'agent-sessions', `${session.id}.json`);
    await writeFile(file, '{}');
    const start = () =>
      fetch(`${base}/agent/start`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sessionId: session.id }),
      });
    expect((await start()).status).toBe(503);
    expect(runtime.app.get(AgentSessionRegistry).size).toBe(0);
    const committed = [
      {
        id: 'persisted-message',
        role: 'user',
        content: 'Committed history',
        timestamp: new Date().toISOString(),
      },
    ];
    await writeFile(`${file}.bak1`, JSON.stringify(committed));
    const recovered = await start();
    expect(recovered.status).toBe(200);
    expect((await recovered.json()).messages).toEqual(committed);
    expect(await readFile(file, 'utf8')).toBe('{}');
    const saveQueue = vi
      .spyOn(runtime.app.get(AgentSessionRepository), 'saveQueue')
      .mockRejectedValueOnce(new AgentSessionStorageError('write'));
    try {
      const queue = await fetch(`${base}/agent/queue/add`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sessionId: session.id, message: 'Unconfirmed queue mutation' }),
      });
      expect(queue.status).toBe(503);
      expect(await queue.json()).toMatchObject({ success: false, errorCode: 'UNAVAILABLE' });
      expect((await agents.getQueue(session.id)).queue).toEqual([]);
    } finally {
      saveQueue.mockRestore();
    }
    const clear = await fetch(`${base}/agent/clear`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sessionId: session.id }),
    });
    expect(clear.status).toBe(200);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual([]);
  } finally {
    await runtime.app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
