import type { NestApplicationOptions } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import type express from 'express';
import type { Server } from 'node:http';

/** HTTP and WebSocket upgrades must use the same server in every composition. */
export class SharedHttpServerExpressAdapter extends ExpressAdapter {
  constructor(instance: ReturnType<typeof express>, server: Server) {
    super(instance);
    this.setHttpServer(server);
  }

  override initHttpServer(_options: NestApplicationOptions): void {
    // The composition root owns this server; Nest must not replace it.
  }
}
