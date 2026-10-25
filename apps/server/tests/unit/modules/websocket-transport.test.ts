import { EventEmitter } from 'node:events';
import { createServer, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import { WebSocketTransportService } from '../../../src/modules/terminal/websocket-transport.service.js';
import { ApplicationEventBusAdapter } from '../../../src/core/eventing/application-event-bus.adapter.js';
import { createEventEmitter } from '../../../src/lib/events.js';
import { PreviewPolicy, parseRuntimeConfig } from '../../../src/core/config/index.js';

class Client extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  bufferedAmount = 0;
  send = vi.fn((_value: string, callback?: (error?: Error) => void) => callback?.());
  close = vi.fn((_code?: number, _reason?: string) => {
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  });
  terminate = vi.fn(() => {
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  });
  ping = vi.fn();
}
const request = (url = '/api/events') =>
  ({ url, headers: {}, rawHeaders: [] }) as unknown as IncomingMessage;
const inspect = (value: WebSocketTransportService) =>
  value as unknown as {
    eventsServer: WebSocketServer;
    terminalServer: WebSocketServer;
    upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
    checkHeartbeats(): void;
    terminalConnections: Map<string, Set<WebSocket>>;
  };

describe('native WebSocket lifecycle and bounded transport', () => {
  let service: WebSocketTransportService;
  let bus: ApplicationEventBusAdapter;
  let adapter: { isClosing: boolean; getHttpServer: () => ReturnType<typeof createServer> };
  let auth: { authenticateUpgrade: ReturnType<typeof vi.fn> };
  let terminal: {
    getSession: ReturnType<typeof vi.fn>;
    isSessionClosing: ReturnType<typeof vi.fn>;
    getScrollbackAndClearPending: ReturnType<typeof vi.fn>;
    onData: ReturnType<typeof vi.fn>;
    onExit: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    adapter = { isClosing: false, getHttpServer: () => createServer() };
    bus = new ApplicationEventBusAdapter(createEventEmitter());
    auth = { authenticateUpgrade: vi.fn(() => true) };
    terminal = {
      getSession: vi.fn(() => ({
        id: 'owned',
        shell: '/bin/sh',
        cwd: '/owned',
        initialCommandClaimed: false,
      })),
      isSessionClosing: vi.fn(() => false),
      getScrollbackAndClearPending: vi.fn(() => ''),
      onData: vi.fn(() => vi.fn()),
      onExit: vi.fn(() => vi.fn()),
      write: vi.fn(),
      resize: vi.fn(),
    };
    service = new WebSocketTransportService(
      { httpAdapter: adapter } as never,
      auth as never,
      { enabled: true, passwordRequired: false } as never,
      bus,
      terminal as never,
      new PreviewPolicy(parseRuntimeConfig({}).preview)
    );
  });
  afterEach(async () => {
    vi.useRealTimers();
    await service.onApplicationShutdown().catch(() => {});
    bus.dispose();
  });

  it('subscribes through the typed bus, preserves envelope ordering and isolates a slow viewer', () => {
    const slow = new Client(),
      healthy = new Client();
    inspect(service).eventsServer.emit('connection', slow, request());
    inspect(service).eventsServer.emit('connection', healthy, request());
    slow.bufferedAmount = 1024 * 1024 - 1;
    bus.emit('feature:progress', { featureId: 'first' });
    bus.emit('feature:progress', { featureId: 'second' });
    expect(slow.close).toHaveBeenCalledWith(4008, expect.any(String));
    expect(slow.send).not.toHaveBeenCalled();
    expect(healthy.send.mock.calls.map(([value]) => JSON.parse(value))).toEqual([
      { type: 'feature:progress', payload: { featureId: 'first' } },
      { type: 'feature:progress', payload: { featureId: 'second' } },
    ]);
    healthy.emit('close');
    bus.emit('feature:progress', { featureId: 'after-close' });
    expect(healthy.send).toHaveBeenCalledTimes(2);
  });

  it('includes the next encoded packet in its byte budget rather than enqueuing a huge single message', () => {
    const client = new Client();
    inspect(service).eventsServer.emit('connection', client, request());
    bus.emit('feature:progress', { featureId: 'oversize', message: 'x'.repeat(1024 * 1024) });
    expect(client.close).toHaveBeenCalledWith(4008, expect.any(String));
    expect(client.send).not.toHaveBeenCalled();
    expect(inspect(service).eventsServer.options.maxPayload).toBe(1024 * 1024);
    expect(inspect(service).terminalServer.options.maxPayload).toBe(1024 * 1024);
  });

  it('terminates a broken sender without preventing its healthy sibling from receiving events', () => {
    const broken = new Client(),
      healthy = new Client();
    broken.send.mockImplementationOnce((_value, callback) =>
      callback?.(new Error('owned fixture failure'))
    );
    inspect(service).eventsServer.emit('connection', broken, request());
    inspect(service).eventsServer.emit('connection', healthy, request());
    bus.emit('feature:progress', { featureId: 'still-delivered' });
    expect(broken.terminate).toHaveBeenCalledOnce();
    expect(healthy.send).toHaveBeenCalledOnce();
  });

  it('pings a live viewer, accepts pong and terminates only a missing-heartbeat peer', () => {
    const client = new Client(),
      server = inspect(service).eventsServer;
    inspect(service).eventsServer.emit('connection', client, request());
    server.clients.add(client as unknown as WebSocket);
    client.once('close', () => server.clients.delete(client as unknown as WebSocket));
    inspect(service).checkHeartbeats();
    expect(client.ping).toHaveBeenCalledOnce();
    client.emit('pong');
    inspect(service).checkHeartbeats();
    expect(client.terminate).not.toHaveBeenCalled();
    inspect(service).checkHeartbeats();
    expect(client.terminate).toHaveBeenCalledOnce();
  });

  it('rejects oversized or malformed upgrades before handing off to a WS handler', () => {
    const output = { end: vi.fn() };
    inspect(service).upgrade(
      request('/api/events?' + 'x'.repeat(4096)),
      output as never,
      Buffer.alloc(0)
    );
    expect(output.end).toHaveBeenLastCalledWith(expect.stringContaining('431'));
    expect(auth.authenticateUpgrade).not.toHaveBeenCalled();
    inspect(service).upgrade(
      { ...request(), rawHeaders: ['x-owned', 'x'.repeat(16 * 1024)] } as never,
      output as never,
      Buffer.alloc(0)
    );
    expect(output.end).toHaveBeenLastCalledWith(expect.stringContaining('431'));
    expect(auth.authenticateUpgrade).not.toHaveBeenCalled();
    auth.authenticateUpgrade.mockImplementationOnce(() => {
      throw new Error('private hostile URL');
    });
    inspect(service).upgrade(request(), output as never, Buffer.alloc(0));
    expect(output.end).toHaveBeenLastCalledWith(expect.stringContaining('400'));
    expect(output.end.mock.calls.flat().join('')).not.toContain('private');
  });

  it('uses HTTP prepareClose admission to reject upgrades and terminal input immediately', () => {
    const client = new Client();
    inspect(service).terminalServer.emit(
      'connection',
      client,
      request('/api/terminal/ws?sessionId=owned')
    );
    client.emit('message', Buffer.from(JSON.stringify({ type: 'input', data: 'before' })));
    expect(terminal.write).toHaveBeenLastCalledWith('owned', 'before');
    adapter.isClosing = true;
    client.emit('message', Buffer.from(JSON.stringify({ type: 'input', data: 'never' })));
    expect(terminal.write).toHaveBeenCalledOnce();
    const output = { end: vi.fn() };
    inspect(service).upgrade(request(), output as never, Buffer.alloc(0));
    expect(output.end).toHaveBeenCalledWith(expect.stringContaining('503'));
  });

  it('terminates a viewer ignoring close handshakes and shares bounded idempotent shutdown', async () => {
    vi.useFakeTimers();
    const client = new Client();
    client.close.mockImplementation(() => {});
    const server = inspect(service).eventsServer;
    server.clients.add(client as unknown as WebSocket);
    client.once('close', () => {
      server.clients.delete(client as unknown as WebSocket);
      server.emit('close');
    });
    const closing = service.onModuleDestroy();
    expect(service.onModuleDestroy()).toBe(closing);
    await vi.advanceTimersByTimeAsync(1000);
    await closing;
    expect(client.close).toHaveBeenCalledWith(1012, 'Service restarting');
    expect(client.terminate).toHaveBeenCalledOnce();
    expect(inspect(service).terminalConnections.size).toBe(0);
  });
});
