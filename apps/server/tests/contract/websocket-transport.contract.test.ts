import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { AuthService } from '../../src/core/auth/auth.service.js';
import { EVENT_BUS, type EventBus } from '../../src/core/eventing/event-bus.js';
import { WebSocketTransportService } from '../../src/modules/terminal/websocket-transport.service.js';

describe('native shared WebSocket boundary', () => {
  let directory: string, runtime: Awaited<ReturnType<typeof createNestApplication>>, url: string;
  const clients = new Set<WebSocket>();
  async function connect(query = '?apiKey=fixture', headers: Record<string, string> = {}) {
    const client = new WebSocket(url + query, { headers });
    clients.add(client);
    await new Promise<void>((done, failed) => {
      client.once('open', done);
      client.once('error', failed);
    });
    return client;
  }
  async function rejected(query: string) {
    const client = new WebSocket(url + query);
    clients.add(client);
    return new Promise<number>((done, failed) => {
      client.on('error', () => {});
      client.once('unexpected-response', (_request, response) => {
        response.resume();
        done(response.statusCode!);
        client.terminate();
      });
      client.once('open', () => {
        client.terminate();
        failed(new Error('Unexpected authenticated upgrade.'));
      });
    });
  }
  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-native-ws-'));
    runtime = await createNestApplication({
      host: '127.0.0.1',
      port: 0,
      workingDirectory: directory,
      dataDir: path.join(directory, 'data'),
      providerRegistrations: [],
      runStartupTasks: false,
      enableShutdownHooks: false,
      environment: {
        NODE_ENV: 'test',
        AUTOMAKER_API_KEY: 'fixture',
        ENABLE_REQUEST_LOGGING: 'false',
      },
    });
    await runtime.start();
    url = `ws://127.0.0.1:${(runtime.app.getHttpServer().address() as AddressInfo).port}/api/events`;
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    for (const client of clients) client.terminate();
    await runtime?.app.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('authenticates API key and cookie before connection and delivers typed events to both viewers', async () => {
    const server = runtime.app.getHttpServer();
    for (const route of ['auth', 'logout']) {
      const response = await fetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/terminal/${route}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': 'fixture' },
          body: '{}',
        }
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ success: true });
    }
    const auth = runtime.app.get(AuthService),
      session = await auth.createSession();
    const first = await connect(),
      second = await connect('', { cookie: `${auth.sessionCookieName}=${session}` });
    const receive = (client: WebSocket) =>
      new Promise<string>((done) => client.once('message', (data) => done(data.toString())));
    const messages = [receive(first), receive(second)];
    runtime.app
      .get<EventBus>(EVENT_BUS)
      .emit('feature:progress', { featureId: 'native-bus', progress: 0.5 });
    expect(await Promise.all(messages)).toEqual(
      Array(2).fill(
        JSON.stringify({
          type: 'feature:progress',
          payload: { featureId: 'native-bus', progress: 0.5 },
        })
      )
    );
    first.close();
    second.close();
    expect(await rejected('?apiKey=wrong')).toBe(401);
  });

  it('consumes one-time upgrade credentials once and rejects expired tokens', async () => {
    const auth = runtime.app.get(AuthService),
      token = auth.issueWebSocketToken();
    const client = await connect(`?wsToken=${token}`);
    client.close();
    expect(await rejected(`?wsToken=${token}`)).toBe(401);
    const expired = auth.issueWebSocketToken();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5 * 60_000 + 1);
    try {
      expect(await rejected(`?wsToken=${expired}`)).toBe(401);
    } finally {
      clock.mockRestore();
    }
  });

  it('bounds actual incoming frames before application JSON handling', async () => {
    const client = await connect();
    const closed = new Promise<number>((done) => client.once('close', done));
    client.send('x'.repeat(1024 * 1024 + 1));
    expect(await closed).toBe(1009);
  });

  it('drains a real viewer ignoring shutdown frames before HTTP server disposal', async () => {
    const client = await connect();
    const socket = (client as unknown as { _socket: { pause(): void; resume(): void } })._socket;
    socket.pause();
    const transport = runtime.app.get(WebSocketTransportService);
    try {
      await runtime.app.close();
      const servers = transport as unknown as {
        eventsServer: { clients: Set<WebSocket> };
        terminalServer: { clients: Set<WebSocket> };
      };
      expect(servers.eventsServer.clients.size).toBe(0);
      expect(servers.terminalServer.clients.size).toBe(0);
      expect(runtime.app.getHttpServer().listening).toBe(false);
    } finally {
      socket.resume();
      client.terminate();
    }
  });
});
