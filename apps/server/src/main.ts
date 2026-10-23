import 'reflect-metadata';

import express from 'express';
import { createServer, type Server } from 'node:http';
import type { NestApplicationOptions } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createLogger } from '@automaker/utils';

import { AppModule } from './app.module.js';
import { parseRuntimeConfig } from './core/config/index.js';
import {
  createLegacyApplication,
  type LegacyApplication,
  type LegacyApplicationOptions,
} from './legacy-application.js';
import { NestLogger } from './nest-logger.js';

const logger = createLogger('ServerBootstrap');

const DEFAULT_PORT = 3008;
const DEFAULT_HOST = '0.0.0.0';

class SharedHttpServerExpressAdapter extends ExpressAdapter {
  constructor(instance: ReturnType<typeof express>, server: Server) {
    super(instance);
    this.setHttpServer(server);
  }

  override initHttpServer(_options: NestApplicationOptions): void {
    // The server is created before the legacy graph so HTTP and WebSocket traffic
    // share exactly one native server. Nest must not replace it during bootstrap.
  }
}

export interface NestApplicationFactoryOptions extends Pick<
  LegacyApplicationOptions,
  'dataDir' | 'services' | 'runStartupTasks'
> {
  host?: string;
  port?: number;
  enableShutdownHooks?: boolean;
  environment?: NodeJS.ProcessEnv;
  workingDirectory?: string;
}

export interface AutomakerNestApplication {
  app: NestExpressApplication;
  legacy: LegacyApplication;
  host: string;
  port: number;
  start(): Promise<void>;
}

export async function createNestApplication(
  options: NestApplicationFactoryOptions = {}
): Promise<AutomakerNestApplication> {
  const environment = { ...(options.environment ?? process.env) };
  if (options.host !== undefined) environment.HOST = options.host;
  if (options.port !== undefined) environment.PORT = String(options.port);
  if (options.dataDir !== undefined) environment.DATA_DIR = options.dataDir;
  const workingDirectory = options.workingDirectory ?? process.cwd();
  const config = parseRuntimeConfig(environment, workingDirectory);
  const { host, port } = config.server;
  const dataDirectory = config.storage.dataDirectory;

  const expressApplication = express();
  const httpServer = createServer(expressApplication);
  const legacy = createLegacyApplication({
    dataDir: dataDirectory,
    host,
    port,
    runStartupTasks: options.runStartupTasks ?? true,
    services: options.services,
    httpServer,
    workingDirectory,
    attachWebSockets: false,
  });
  const adapter = new SharedHttpServerExpressAdapter(expressApplication, httpServer);
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register(legacy, config, workingDirectory),
    adapter,
    {
      bodyParser: false,
      cors: false,
      logger: new NestLogger(),
    }
  );

  app.setGlobalPrefix('api');
  if (options.enableShutdownHooks ?? true) {
    // Several legacy services still register their own signal listeners. Re-emitting
    // the signal after Nest shutdown would therefore keep the process alive.
    app.enableShutdownHooks([], { useProcessExit: true });
  }

  try {
    await app.init();
  } catch (error) {
    await app.close().catch((closeError) => {
      logger.error('Failed to clean up a partially initialized Nest application', closeError);
    });
    throw error;
  }

  return {
    app,
    legacy,
    host,
    port,
    async start() {
      await app.listen(port, host);
      logger.info(`Nest application listening on http://${host}:${port}`);
    },
  };
}

async function bootstrap(): Promise<void> {
  const application = await createNestApplication();
  application.legacy.installExceptionHandlers();
  await application.start();
}

function logBootstrapFailure(error: unknown): void {
  const nodeError = error as NodeJS.ErrnoException;
  if (nodeError?.code === 'EADDRINUSE') {
    logger.error(`Port ${process.env.PORT ?? DEFAULT_PORT} is already in use`);
  }
  logger.error('Failed to start Automaker backend', error);
}

if (process.env.NODE_ENV !== 'test' || process.env.AUTOMAKER_RUN_MAIN === '1') {
  bootstrap().catch((error) => {
    logBootstrapFailure(error);
    process.exitCode = 1;
  });
}
