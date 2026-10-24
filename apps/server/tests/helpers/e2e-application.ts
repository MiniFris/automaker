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
import { ProviderConnectionRepository } from '../../src/modules/providers/provider-connection.repository.js';
import { createProviderRegistrations } from '../../src/modules/providers/provider-registrations.js';
import { SetupHandlersService } from '../../src/modules/providers/setup-handlers.service.js';
import { SetupCredentialCache } from '../../src/modules/providers/setup-credential-cache.service.js';
import { SetupStatusRuntime } from '../../src/core/platform/setup-status.runtime.js';
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
      imports: [
        // Native setup mutations must only write into this owned test profile.
        AppModule.register(config, dataDirectory, {
          runStartupTasks: false,
          httpServer,
          hostEnvironment: environment,
        }),
      ],
      providers: [
        { provide: Symbol('E2E_DATA_CLEANUP'), useValue: { onApplicationShutdown: cleanup } },
      ],
    })
      .overrideProvider(LEGACY_SERVICES.providerRegistry)
      .useFactory({
        inject: [SettingsService, LEGACY_SERVICES.providerConnections],
        factory: (settings: SettingsService, connections: ProviderConnectionRepository) =>
          new ProviderRegistry(
            createProviderRegistrations(settings).map((registration) => {
              // Preserve production metadata/aliases/priority, but never real execution.
              // Catalog access is offline; the production registrations unit test guards it.
              const models = registration.create().getAvailableModels();
              return {
                ...registration,
                create: () =>
                  new MockProvider(registration.name, models, '[test] hold Running Agents chat'),
              };
            }),
            connections
          ),
      })
      .overrideProvider(SetupHandlersService)
      .useFactory({
        inject: [SettingsService, ProviderRegistry, SetupCredentialCache],
        factory: (
          settings: SettingsService,
          providers: ProviderRegistry,
          keys: SetupCredentialCache
        ) => {
          const real = new SetupHandlersService(settings, providers, keys);
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
      .overrideProvider(SetupStatusRuntime)
      .useValue({
        platformInfo: () => ({ platform: os.platform(), arch: os.arch(), homeDir: os.homedir() }),
        detect: async () => ({
          installed: true,
          version: 'test-fixture',
          path: '/test-only/cli',
          method: 'path',
        }),
        claudeIndicators: async () => ({
          hasCredentialsFile: false,
          hasSettingsFile: false,
          hasStatsCacheWithActivity: true,
          hasProjectsSessions: false,
          credentials: null,
        }),
        codexIndicators: async () => ({ hasApiKey: false, hasAuthFile: true, hasOAuthToken: true }),
        cursorCredentials: async () => true,
        githubAuthentication: async () => ({ authenticated: true, user: 'test-fixture' }),
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
