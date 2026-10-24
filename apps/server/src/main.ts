import 'reflect-metadata';

import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createLogger } from '@automaker/utils';
import dotenv from 'dotenv';

import { AppModule } from './app.module.js';
import { assertNoLegacyServiceOverrides, parseRuntimeConfig } from './core/config/index.js';
import { installProcessExceptionHandlers } from './core/lifecycle/process-exception-handlers.js';
import { NestLogger } from './nest-logger.js';
import { SharedHttpServerExpressAdapter } from './core/http/shared-http-server.adapter.js';
import type { ProviderRegistration } from './modules/providers/provider-registry.service.js';
import { manageApplicationShutdown } from './core/lifecycle/application-shutdown.js';

const logger = createLogger('ServerBootstrap');

const DEFAULT_PORT = 3008;

export interface NestApplicationFactoryOptions {
  dataDir?: string;
  runStartupTasks?: boolean;
  host?: string;
  port?: number;
  enableShutdownHooks?: boolean;
  environment?: NodeJS.ProcessEnv;
  workingDirectory?: string;
  /** Explicit code-level composition seam; never populated from environment/HTTP. */
  providerRegistrations?: readonly ProviderRegistration[];
}

export interface AutomakerNestApplication {
  app: NestExpressApplication;
  host: string;
  port: number;
  start(): Promise<void>;
}

export async function createNestApplication(
  options: NestApplicationFactoryOptions = {}
): Promise<AutomakerNestApplication> {
  assertNoLegacyServiceOverrides(options);
  const environment = { ...(options.environment ?? process.env) };
  if (options.host !== undefined) environment.HOST = options.host;
  if (options.port !== undefined) environment.PORT = String(options.port);
  if (options.dataDir !== undefined) environment.DATA_DIR = options.dataDir;
  const workingDirectory = options.workingDirectory ?? process.cwd();
  const config = parseRuntimeConfig(environment, workingDirectory);
  const { host, port } = config.server;

  const expressApplication = express();
  const httpServer = createServer(expressApplication);
  const adapter = new SharedHttpServerExpressAdapter(expressApplication, httpServer);
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register(config, workingDirectory, {
      runStartupTasks: options.runStartupTasks ?? true,
      providerRegistrations: options.providerRegistrations,
      hostEnvironment: environment,
    }),
    adapter,
    {
      bodyParser: false,
      cors: false,
      logger: new NestLogger(),
    }
  );

  app.setGlobalPrefix('api');
  try {
    const shutdown = manageApplicationShutdown(app);
    if (options.enableShutdownHooks ?? true) shutdown.enableSignals();
    await app.init();
  } catch (error) {
    await app.close().catch((closeError) => {
      logger.error('Failed to clean up a partially initialized Nest application', closeError);
    });
    throw error;
  }

  return {
    app,
    host,
    port,
    async start() {
      await app.listen(port, host);
      logger.info(`Nest application listening on http://${host}:${port}`);
    },
  };
}

async function bootstrap(): Promise<void> {
  dotenv.config();
  const uninstall = installProcessExceptionHandlers();
  let application: AutomakerNestApplication | undefined;
  try {
    application = await createNestApplication();
    await application.start();
  } catch (error) {
    uninstall();
    await application?.app.close();
    throw error;
  }
}

function logBootstrapFailure(error: unknown): void {
  const nodeError = error as NodeJS.ErrnoException;
  if (nodeError?.code === 'EADDRINUSE') {
    logger.error(`Port ${process.env.PORT ?? DEFAULT_PORT} is already in use`);
  }
  logger.error('Failed to start Automaker backend', error);
}

const directEntry =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (process.env.AUTOMAKER_RUN_MAIN === '1' || (directEntry && process.env.NODE_ENV !== 'test')) {
  bootstrap().catch((error) => {
    logBootstrapFailure(error);
    process.exitCode = 1;
  });
}
