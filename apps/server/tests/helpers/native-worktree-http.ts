import express from 'express';
import { createServer } from 'node:http';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../src/app.module.js';
import { parseRuntimeConfig, PreviewPolicy } from '../../src/core/config/index.js';
import { ApplicationLoggingPolicy } from '../../src/core/observability/logging-policy.js';
import { SharedHttpServerExpressAdapter } from '../../src/core/http/shared-http-server.adapter.js';
import { manageApplicationShutdown } from '../../src/core/lifecycle/application-shutdown.js';
import { APPLICATION_EVENTS } from '../../src/core/eventing/application-events.js';
import { createEventEmitter, type EventEmitter } from '../../src/lib/events.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { ManagedDevServerService } from '../../src/services/execution-environment/dev-server.js';
import { ManagedTestRunnerService } from '../../src/services/execution-environment/test-runner.js';
import { AutoModeServiceCompat } from '../../src/services/auto-mode/compat.js';
import type { ProviderRegistration } from '../../src/modules/providers/provider-registry.service.js';

/** Actual native composition; overrides are explicit test ports, never factory.services/legacy routes. */
export async function createNativeWorktreeHttp(options: {
  root: string;
  settings?: SettingsService;
  events?: EventEmitter;
  managedDev?: ManagedDevServerService;
  managedTests?: ManagedTestRunnerService;
  busy?: () => boolean;
  apiKey?: string;
  environment?: NodeJS.ProcessEnv;
  providerRegistrations?: readonly ProviderRegistration[];
}) {
  const apiKey = options.apiKey ?? 'native-worktree-fixture';
  const environment = {
    NODE_ENV: 'test',
    AUTOMAKER_API_KEY: apiKey,
    DATA_DIR: options.root + '/native-http-data',
    HOST: '127.0.0.1',
    PORT: '0',
    ENABLE_REQUEST_LOGGING: 'false',
    AUTOMAKER_PREVIEW_PORT_FIRST: '43300',
    AUTOMAKER_PREVIEW_PORT_LAST: '43319',
    ...options.environment,
  };
  const config = parseRuntimeConfig(environment, options.root),
    logging = new ApplicationLoggingPolicy(environment, false);
  const builder = Test.createTestingModule({
    imports: [
      AppModule.register(config, options.root, {
        runStartupTasks: false,
        hostEnvironment: environment,
        loggingPolicy: logging,
        providerRegistrations: options.providerRegistrations ?? [],
      }),
    ],
  });
  const events = options.events ?? createEventEmitter();
  builder.overrideProvider(APPLICATION_EVENTS).useValue(events);
  if (options.settings) builder.overrideProvider(SettingsService).useValue(options.settings);
  if (options.managedDev)
    builder.overrideProvider(ManagedDevServerService).useValue(options.managedDev);
  if (options.managedTests)
    builder.overrideProvider(ManagedTestRunnerService).useValue(options.managedTests);
  const module = await logging.run(() => builder.compile());
  const instance = express(),
    server = createServer(instance),
    adapter = new SharedHttpServerExpressAdapter(instance, server);
  const app = module.createNestApplication<NestExpressApplication>(adapter, {
    bodyParser: false,
    cors: false,
    logger: false,
  });
  app.setGlobalPrefix('api');
  manageApplicationShutdown(app, logging);
  if (options.busy) app.get(AutoModeServiceCompat).isProjectRunning = async () => options.busy!();
  try {
    await logging.run(async () => {
      await app.init();
      await app.listen(0, '127.0.0.1');
    });
  } catch (error) {
    await app.close().catch(() => {});
    throw error;
  }
  return {
    app,
    server,
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    apiKey,
    events,
    policy: app.get(PreviewPolicy),
    settings: app.get(SettingsService),
    managedDev: app.get(ManagedDevServerService),
    managedTests: app.get(ManagedTestRunnerService),
    close: () => logging.run(() => app.close()),
  };
}
