import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { createLogger } from '@automaker/utils';
import { AuthService } from '../../core/auth/auth.service.js';
import { createCorrelationId } from '../../core/observability/request-context.js';
import { EVENT_BUS, type EventBus } from '../../core/eventing/event-bus.js';
import { PreviewPolicy } from '../../core/config/preview-policy.js';
import { claimTerminalStartup, TerminalService } from '../../services/terminal-service.js';
import { TerminalAccessService } from './terminal-access.service.js';

const logger = createLogger('WebSocketTransport');
const MAX_BUFFERED_BYTES = 1024 * 1024;
const MAX_HANDSHAKE_URL_BYTES = 4096;
const MAX_HANDSHAKE_HEADER_BYTES = 16 * 1024;
const RESIZE_MIN_INTERVAL_MS = 100;

@Injectable()
export class WebSocketTransportService
  implements OnApplicationBootstrap, OnModuleDestroy, OnApplicationShutdown
{
  private readonly eventsServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_BUFFERED_BYTES,
  });
  private readonly terminalServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_BUFFERED_BYTES,
  });
  private readonly terminalConnections = new Map<string, Set<WebSocket>>();
  private readonly lastResizeDimensions = new Map<string, { cols: number; rows: number }>();
  private readonly lastResizeTime = new Map<string, number>();
  private readonly alive = new WeakMap<WebSocket, boolean>();
  private readonly heartbeat = setInterval(() => this.checkHeartbeats(), 30_000);
  private readonly unsubscribeTerminalExit: () => void;
  private server?: Server;
  private closing = false;
  private shutdown?: Promise<void>;

  constructor(
    @Inject(HttpAdapterHost) private readonly httpAdapterHost: HttpAdapterHost,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(TerminalAccessService) private readonly terminalAccess: TerminalAccessService,
    @Inject(EVENT_BUS) private readonly events: EventBus,
    @Inject(TerminalService) private readonly terminal: TerminalService,
    @Inject(PreviewPolicy) private readonly preview: PreviewPolicy
  ) {
    this.heartbeat.unref();
    this.unsubscribeTerminalExit = this.terminal.onExit((sessionId) => {
      this.lastResizeDimensions.delete(sessionId);
      this.lastResizeTime.delete(sessionId);
      this.terminalConnections.delete(sessionId);
    });
    this.eventsServer.on('connection', (socket, request) => this.connectEvents(socket, request));
    this.terminalServer.on('connection', (socket, request) =>
      this.connectTerminal(socket, request)
    );
  }

  onApplicationBootstrap(): void {
    this.server = this.httpAdapterHost.httpAdapter.getHttpServer() as Server;
    this.server.on('upgrade', this.upgrade);
  }

  onModuleDestroy(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.closing = true;
    clearInterval(this.heartbeat);
    this.unsubscribeTerminalExit();
    for (const socket of [...this.eventsServer.clients, ...this.terminalServer.clients]) {
      if (socket.readyState === WebSocket.OPEN) socket.close(1012, 'Service restarting');
      else socket.terminate();
    }
    this.shutdown = Promise.allSettled([
      this.closeServer(this.eventsServer),
      this.closeServer(this.terminalServer),
    ]).then((results) => {
      if (results.some((result) => result.status === 'rejected')) throw new WebSocketCleanupError();
      this.terminalConnections.clear();
      this.lastResizeDimensions.clear();
      this.lastResizeTime.clear();
    });
    return this.shutdown;
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.onModuleDestroy();
    } finally {
      this.server?.off('upgrade', this.upgrade);
    }
  }

  private isClosing(): boolean {
    return (
      this.closing ||
      (this.httpAdapterHost.httpAdapter as { isClosing?: boolean }).isClosing === true
    );
  }

  private readonly upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (this.isClosing()) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    if (
      Buffer.byteLength(request.url ?? '') > MAX_HANDSHAKE_URL_BYTES ||
      request.rawHeaders.reduce((total, header) => total + Buffer.byteLength(header) + 2, 0) >
        MAX_HANDSHAKE_HEADER_BYTES
    ) {
      socket.end('HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n');
      return;
    }
    let pathname: string;
    let authenticated: boolean;
    try {
      pathname = new URL(request.url || '', 'http://localhost').pathname;
      if (this.preview.isApiRequest(request)) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      authenticated = this.auth.authenticateUpgrade(request);
    } catch {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    if (!authenticated) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }

    const target =
      pathname === '/api/events'
        ? this.eventsServer
        : pathname === '/api/terminal/ws'
          ? this.terminalServer
          : undefined;
    if (!target) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    target.handleUpgrade(request, socket, head, (webSocket) => {
      target.emit('connection', webSocket, request);
    });
  };

  private connectEvents(socket: WebSocket, request: IncomingMessage): void {
    const connectionId = createCorrelationId(
      typeof request.headers['x-request-id'] === 'string'
        ? request.headers['x-request-id']
        : undefined
    );
    this.trackHeartbeat(socket);
    logger.info('Events client connected', { connectionId });
    const unsubscribe = this.events.subscribeAll((type, payload) => {
      this.send(socket, { type, payload }, 'events');
    });
    const cleanup = () => unsubscribe();
    socket.once('close', cleanup);
    socket.once('error', cleanup);
  }

  private connectTerminal(socket: WebSocket, request: IncomingMessage): void {
    this.trackHeartbeat(socket);
    const connectionId = createCorrelationId(
      typeof request.headers['x-request-id'] === 'string'
        ? request.headers['x-request-id']
        : undefined
    );
    logger.info('Terminal client connected', { connectionId });
    const url = new URL(request.url || '', 'http://localhost');
    const sessionId = url.searchParams.get('sessionId');
    const terminalToken = url.searchParams.get('token') ?? undefined;
    if (!this.terminalAccess.enabled) {
      socket.close(4003, 'Terminal access is disabled');
      return;
    }
    if (this.terminalAccess.passwordRequired && !this.terminalAccess.validate(terminalToken)) {
      socket.close(4001, 'Authentication required');
      return;
    }
    if (!sessionId) {
      socket.close(4002, 'Session ID required');
      return;
    }
    const session = this.terminal.getSession(sessionId);
    if (session && this.terminal.isSessionClosing(sessionId)) {
      socket.close(4005, 'Terminal cleanup pending or unconfirmed');
      return;
    }
    if (!session) {
      socket.close(
        4004,
        'Session not found. The terminal session may have expired or been closed. Please create a new terminal.'
      );
      return;
    }

    const connections = this.terminalConnections.get(sessionId) ?? new Set<WebSocket>();
    connections.add(socket);
    this.terminalConnections.set(sessionId, connections);
    this.send(
      socket,
      {
        type: 'connected',
        sessionId,
        shell: session.shell,
        cwd: session.cwd,
        executionEnvironment: session.executionEnvironment ?? {
          type: 'local',
          runtimeCwd: session.cwd,
          legacy: true,
        },
        allowInitialCommand: claimTerminalStartup(session),
      },
      'terminal'
    );
    const scrollback = this.terminal.getScrollbackAndClearPending(sessionId);
    if (scrollback) this.send(socket, { type: 'scrollback', data: scrollback }, 'terminal');

    const unsubscribeData = this.terminal.onData((id, data) => {
      if (id !== sessionId || socket.readyState !== WebSocket.OPEN) return;
      this.send(socket, { type: 'data', data }, 'terminal');
    });
    const unsubscribeExit = this.terminal.onExit((id, exitCode) => {
      if (id === sessionId && socket.readyState === WebSocket.OPEN) {
        this.send(socket, { type: 'exit', exitCode }, 'terminal');
        socket.close(1000, 'Session ended');
      }
    });
    const cleanup = () => {
      unsubscribeData();
      unsubscribeExit();
      connections.delete(socket);
      if (!connections.size) this.terminalConnections.delete(sessionId);
    };
    socket.once('close', cleanup);
    socket.once('error', cleanup);
    socket.on('message', (message) => this.handleTerminalMessage(socket, sessionId, message));
  }

  private handleTerminalMessage(
    socket: WebSocket,
    sessionId: string,
    raw: WebSocket.RawData
  ): void {
    if (this.isClosing()) return;
    const size = Array.isArray(raw)
      ? raw.reduce((total, part) => total + part.byteLength, 0)
      : raw.byteLength;
    if (size > MAX_BUFFERED_BYTES) {
      this.send(socket, { type: 'error', message: 'Input too large' }, 'terminal');
      return;
    }
    try {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (message.type === 'input') {
        if (typeof message.data !== 'string') {
          this.send(socket, { type: 'error', message: 'Invalid input type' }, 'terminal');
        } else if (message.data.length > MAX_BUFFERED_BYTES) {
          this.send(socket, { type: 'error', message: 'Input too large' }, 'terminal');
        } else {
          this.terminal.write(sessionId, message.data);
        }
      } else if (message.type === 'resize') {
        this.resizeTerminal(sessionId, message.cols, message.rows);
      } else if (message.type === 'ping') {
        this.send(socket, { type: 'pong' }, 'terminal');
      }
    } catch {
      logger.warn('Rejected malformed terminal message');
    }
  }

  private resizeTerminal(sessionId: string, cols: unknown, rows: unknown): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows)) return;
    const width = cols as number;
    const height = rows as number;
    if (width < 1 || width > 1000 || height < 1 || height > 500) return;
    const now = Date.now();
    const lastTime = this.lastResizeTime.get(sessionId) ?? 0;
    const previous = this.lastResizeDimensions.get(sessionId);
    if (now - lastTime < RESIZE_MIN_INTERVAL_MS) return;
    if (previous?.cols === width && previous.rows === height) return;
    this.terminal.resize(sessionId, width, height, Boolean(previous));
    this.lastResizeDimensions.set(sessionId, { cols: width, rows: height });
    this.lastResizeTime.set(sessionId, now);
  }

  private trackHeartbeat(socket: WebSocket): void {
    this.alive.set(socket, true);
    socket.on('pong', () => this.alive.set(socket, true));
  }

  private checkHeartbeats(): void {
    for (const socket of [...this.eventsServer.clients, ...this.terminalServer.clients]) {
      if (!this.alive.get(socket)) {
        socket.terminate();
        continue;
      }
      this.alive.set(socket, false);
      socket.ping();
    }
  }

  private closeServer(server: WebSocketServer): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (failed = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(grace);
        clearTimeout(hard);
        if (failed) reject(new WebSocketCleanupError());
        else resolve();
      };
      const grace = setTimeout(() => {
        for (const socket of server.clients) socket.terminate();
      }, 1000);
      const hard = setTimeout(() => finish(true), 2000);
      server.close((error) => finish(Boolean(error)));
    });
  }

  private send(socket: WebSocket, payload: unknown, channel: 'events' | 'terminal'): boolean {
    if (socket.readyState !== WebSocket.OPEN) return false;
    let encoded: string;
    try {
      encoded = JSON.stringify(payload);
    } catch {
      return false;
    }
    if (socket.bufferedAmount + Buffer.byteLength(encoded) > MAX_BUFFERED_BYTES) {
      socket.close(
        4008,
        channel === 'events'
          ? 'Event client is too slow. Reconnect and refresh state; commands are not replayed.'
          : 'Terminal client is too slow. Reconnect to the same session; commands are not replayed.'
      );
      return false;
    }
    try {
      socket.send(encoded, (error) => {
        if (error) socket.terminate();
      });
      return true;
    } catch {
      socket.terminate();
      return false;
    }
  }
}

export class WebSocketCleanupError extends Error {
  readonly code = 'WEBSOCKET_CLEANUP_FAILED';
  constructor() {
    super('WebSocket cleanup could not be confirmed.');
  }
}
