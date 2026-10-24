import 'reflect-metadata';

import express from 'express';
import { createServer } from 'node:http';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createLogger } from '@automaker/utils';

import { AppModule } from './app.module.js';
import { assertNoLegacyServiceOverrides, parseRuntimeConfig } from './core/config/index.js';
import type { LegacyApplication, LegacyApplicationOptions } from './legacy-application.js';
import { LEGACY_APPLICATION } from './legacy/legacy.tokens.js';
import { NestLogger } from './nest-logger.js';
import { SharedHttpServerExpressAdapter } from './core/http/shared-http-server.adapter.js';
import type { ProviderRegistration } from './modules/providers/provider-registry.service.js';
import { manageApplicationShutdown } from './core/lifecycle/application-shutdown.js';

const logger = createLogger('ServerBootstrap');

const DEFAULT_PORT = 3008;

export interface NestApplicationFactoryOptions extends Pick<
  LegacyApplicationOptions,
  'dataDir' | 'runStartupTasks'
> {
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
  legacy: LegacyApplication;
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
      httpServer,
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
  const legacy = app.get<LegacyApplication>(LEGACY_APPLICATION);

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
