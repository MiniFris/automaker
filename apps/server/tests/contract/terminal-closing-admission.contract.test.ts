import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { TerminalService } from '../../src/services/terminal-service.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';

it('rejects native REST/WS attachment to an uncertain identity without connecting or executing input', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-terminal-admission-'));
  const runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: directory,
    dataDir: directory,
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      NODE_ENV: 'test',
      AUTOMAKER_API_KEY: 'fixture',
      ENABLE_REQUEST_LOGGING: 'false',
    },
  });
  const terminal = runtime.app.get(TerminalService);
  const sessions = (terminal as unknown as { sessions: Map<string, unknown> }).sessions;
  const pty = { write: vi.fn() };
  sessions.set('uncertain', { id: 'uncertain', shell: '/bin/sh', cwd: directory, pty });
  const closing = vi.spyOn(terminal, 'isSessionClosing').mockReturnValue(true);
  try {
    await runtime.start();
    const { port } = runtime.app.getHttpServer().address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/terminal/sessions/uncertain`, {
      headers: { 'x-api-key': 'fixture' },
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ success: false, errorCode: 'UNAVAILABLE' });
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/api/terminal/ws?apiKey=fixture&sessionId=uncertain`
    );
    const messages: unknown[] = [];
    socket.on('message', (data) => messages.push(data));
    const code = await new Promise<number>((resolve, reject) => {
      socket.once('close', resolve);
      socket.once('error', reject);
    });
    expect(code).toBe(4005);
    expect(messages).toEqual([]);
    expect(pty.write).not.toHaveBeenCalled();
  } finally {
    closing.mockRestore();
    sessions.delete('uncertain');
    await runtime.app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('does not report successful app.close after a terminal failure and still closes later provider owners', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-terminal-failed-close-'));
  const runtime = await createNestApplication({
    workingDirectory: directory,
    dataDir: directory,
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
  });
  const terminal = vi
    .spyOn(runtime.app.get(TerminalService), 'cleanup')
    .mockRejectedValue(new Error('private-terminal-detail'));
  const provider = vi.spyOn(runtime.app.get(ProviderRegistry), 'onApplicationShutdown');
  try {
    await expect(runtime.app.close()).rejects.toMatchObject({ code: 'APPLICATION_CLEANUP_FAILED' });
    expect(provider).toHaveBeenCalledOnce();
    await expect(runtime.app.close()).rejects.not.toThrow('private-terminal-detail');
  } finally {
    terminal.mockRestore();
    provider.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
});
