import 'reflect-metadata';

import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AppModule } from '../../src/app.module.js';
import { parseRuntimeConfig } from '../../src/core/config/index.js';
import { SharedHttpServerExpressAdapter } from '../../src/core/http/shared-http-server.adapter.js';
import { LEGACY_SERVICES } from '../../src/legacy/legacy.tokens.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';
import { createProviderRegistrations } from '../../src/modules/providers/provider-registrations.js';
import { SetupHandlersService } from '../../src/modules/providers/setup-handlers.service.js';
import type { SetupHandlerName } from '../../src/modules/providers/setup-handlers.service.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { MockProvider } from './mock-provider.js';
import type { Request, Response } from 'express';

/** Test-only composition: production bootstrap has no environment-controlled mocks. */
export async function createE2eApplication(
  environment: NodeJS.ProcessEnv = process.env,
  // Only pass a temporary directory created and owned by the test entrypoint.
  ownedDataDirectory?: string
) {
  if (environment.NODE_ENV === 'production')
    throw new Error('The E2E test composition must not run in production.');
  const dataDirectory =
    ownedDataDirectory ?? (await mkdtemp(path.join(os.tmpdir(), 'automaker-nest-e2e-')));
  const cleanup = () => rm(dataDirectory, { recursive: true, force: true });
  let app: NestExpressApplication | undefined;
  try {
    const config = parseRuntimeConfig({
      ...environment,
      NODE_ENV: 'test',
      DATA_DIR: dataDirectory,
    });
    const expressApplication = express();
    const httpServer = createServer(expressApplication);
    const adapter = new SharedHttpServerExpressAdapter(expressApplication, httpServer);
    const module = await Test.createTestingModule({
      imports: [AppModule.register(config, process.cwd(), { runStartupTasks: false, httpServer })],
      providers: [
        { provide: Symbol('E2E_DATA_CLEANUP'), useValue: { onApplicationShutdown: cleanup } },
      ],
    })
      .overrideProvider(LEGACY_SERVICES.providerRegistry)
      .useFactory({
        inject: [SettingsService],
        factory: (settings: SettingsService) =>
          new ProviderRegistry(
            createProviderRegistrations(settings).map((registration) => {
              // Preserve production metadata/aliases/priority, but never real execution.
              // Catalog access is offline; the production registrations unit test guards it.
              const models = registration.create().getAvailableModels();
              return { ...registration, create: () => new MockProvider(registration.name, models) };
            }),
            { isDisconnected: () => false } as never
          ),
      })
      .overrideProvider(SetupHandlersService)
      .useFactory({
        inject: [SettingsService, ProviderRegistry],
        factory: (settings: SettingsService, providers: ProviderRegistry) => {
          const real = new SetupHandlersService(settings, providers);
          return {
            run(name: SetupHandlerName, request: Request, response: Response) {
              if (name === 'verifyClaudeAuth' || name === 'verifyCodexAuth') {
                response.json({ success: true, authenticated: true });
                return Promise.resolve();
              }
              return real.run(name, request, response);
            },
          };
        },
      })
      .compile();
    app = module.createNestApplication<NestExpressApplication>(adapter, {
      bodyParser: false,
      cors: false,
      logger: false,
    });
    app.setGlobalPrefix('api');
    await app.init();
    return { app, dataDirectory, host: config.server.host, port: config.server.port };
  } catch (error) {
    await app?.close();
    await cleanup();
    throw error;
  }
}
