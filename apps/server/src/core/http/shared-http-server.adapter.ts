import type { NestApplicationOptions } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import type express from 'express';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import { performance } from 'node:perf_hooks';

export class HttpServerCleanupError extends Error {
  readonly code = 'HTTP_SERVER_CLEANUP_FAILED';
  constructor() {
    super('HTTP server cleanup could not be confirmed.');
  }
}

/** HTTP and WebSocket upgrades must use the same server in every composition. */
export class SharedHttpServerExpressAdapter extends ExpressAdapter {
  private readonly connections = new Set<Socket>();
  private closing = false;
  private cleanupFailed = false;
  private shutdown?: Promise<void>;
  private connectionClosed?: () => void;
  private readonly trackConnection = (socket: Socket) => {
    this.connections.add(socket);
    socket.once('close', () => {
      this.connections.delete(socket);
      this.connectionClosed?.();
    });
  };

  constructor(
    instance: ReturnType<typeof express>,
    private readonly ownedServer: Server
  ) {
    super(instance);
    this.setHttpServer(ownedServer);
    ownedServer.on('connection', this.trackConnection);
    instance.use((_request, response, next) => {
      if (!this.closing) {
        next();
        return;
      }
      response.setHeader('Connection', 'close');
      response
        .status(503)
        .json({ success: false, error: 'Service is shutting down.', errorCode: 'UNAVAILABLE' });
    });
  }

  get isClosing(): boolean {
    return this.closing;
  }
  beforeClose(): void {
    this.closing = true;
  }

  /** Bounded transport drain; destroying a socket does not cancel its domain work. */
  override close(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.closing = true;
    this.shutdown = new Promise<void>((resolve) => {
      let serverClosed = false,
        settled = false;
      const deadline = performance.now() + 6000;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(grace);
        clearTimeout(hard);
        this.connectionClosed = undefined;
        this.ownedServer.off('connection', this.trackConnection);
        resolve();
      };
      const confirm = () => {
        if (settled || !serverClosed || this.connections.size) return;
        if (performance.now() >= deadline) this.cleanupFailed = true;
        finish();
      };
      this.connectionClosed = confirm;
      const grace = setTimeout(() => {
        for (const socket of this.connections) {
          try {
            socket.destroy();
          } catch {
            this.cleanupFailed = true;
          }
        }
      }, 5000);
      const hard = setTimeout(() => {
        this.cleanupFailed = true;
        finish();
      }, 6000);
      try {
        this.ownedServer.close((error) => {
          if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING')
            this.cleanupFailed = true;
          serverClosed = true;
          confirm();
        });
      } catch {
        this.cleanupFailed = true;
        finish();
      }
    });
    return this.shutdown;
  }

  /** Checked by managed application close after later disposal hooks have run. */
  assertCleanupConfirmed(): void {
    if (this.cleanupFailed || !this.shutdown || this.connections.size)
      throw new HttpServerCleanupError();
  }

  override initHttpServer(_options: NestApplicationOptions): void {
    // The composition root owns this server; Nest must not replace it.
  }
}
