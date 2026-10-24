import 'reflect-metadata';

import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AppModule } from '../../src/app.module.js';
import { manageApplicationShutdown } from '../../src/core/lifecycle/application-shutdown.js';
import { parseRuntimeConfig } from '../../src/core/config/index.js';
import { SharedHttpServerExpressAdapter } from '../../src/core/http/shared-http-server.adapter.js';
import { PROVIDER_REGISTRATIONS } from '../../src/modules/providers/provider-registry.service.js';
import { createProviderRegistrations } from '../../src/modules/providers/provider-registrations.js';
import { SetupStatusRuntime } from '../../src/core/platform/setup-status.runtime.js';
import { ClaudeVerificationRuntime } from '../../src/core/platform/claude-verification.runtime.js';
import { CodexCredentialRuntime } from '../../src/core/platform/codex-credential.runtime.js';
import { CodexVerificationRuntime } from '../../src/core/platform/codex-verification.runtime.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { ApplicationCredentialsService } from '../../src/modules/providers/application-credentials.service.js';
import { GeminiProvider } from '../../src/providers/gemini-provider.js';
import { CursorProvider } from '../../src/providers/cursor-provider.js';
import { MockProvider } from './mock-provider.js';
import { GithubReadPort } from '../../src/modules/github/github-read.port.js';

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
          hostEnvironment: {
            ...environment,
            GEMINI_API_KEY: undefined,
            GOOGLE_API_KEY: undefined,
            GOOGLE_APPLICATION_CREDENTIALS: undefined,
            GOOGLE_CLOUD_PROJECT: undefined,
            CURSOR_CONFIG_DIR: path.join(dataDirectory, 'host-cursor-profile'),
            CURSOR_API_KEY: undefined,
            ANTHROPIC_BASE_URL: 'https://claude-verification.fixture.invalid',
          },
        }),
      ],
      providers: [
        { provide: Symbol('E2E_DATA_CLEANUP'), useValue: { onApplicationShutdown: cleanup } },
      ],
    })
      .overrideProvider(PROVIDER_REGISTRATIONS)
      .useFactory({
        inject: [SettingsService, ApplicationCredentialsService],
        factory: (settings: SettingsService, credentials: ApplicationCredentialsService) =>
          createProviderRegistrations(settings).map((registration) => {
            // Preserve production metadata/aliases/priority, but never real execution.
            // Catalog access is offline; the production registrations unit test guards it.
            const models = registration.create().getAvailableModels();
            return {
              ...registration,
              create: () => {
                const provider = new MockProvider(
                  registration.name,
                  models,
                  '[test] hold Running Agents chat'
                );
                if (registration.name === 'cursor')
                  provider.checkAuth = () =>
                    new CursorProvider({}, () => credentials.environment()).checkAuth();
                // Real passive Google-key policy/status, but never a vendor CLI/query.
                // Keep file hints inside the owned test profile, not the operator's home.
                if (registration.name === 'gemini')
                  provider.checkAuth = () =>
                    new GeminiProvider({}, async () => ({
                      ...(await credentials.environment()),
                      HOME: path.join(dataDirectory, 'gemini-home'),
                    })).checkAuth();
                return provider;
              },
            };
          }),
      })
      // Generic UI fixtures never query the operator's real GitHub profile/network.
      // Native CLI/argv/cleanup behavior is exercised with an owned gh executable
      // in github-discovery.contract.test.ts, not by vendor calls in browser smoke.
      .overrideProvider(GithubReadPort)
      .useValue({
        remote: async () => ({ hasGitHubRemote: false, remoteUrl: null, owner: null, repo: null }),
        issues: async () => ({ openIssues: [], closedIssues: [] }),
        prs: async () => ({ openPRs: [], mergedPRs: [] }),
      })
      .overrideProvider(CodexCredentialRuntime)
      .useValue({ read: async () => ({ kind: 'api-key' }) })
      .overrideProvider(CodexVerificationRuntime)
      .useValue({ run: async () => 'verified' })
      .overrideProvider(ClaudeVerificationRuntime)
      .useValue({ run: async () => 'verified' })
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
        profileHint: async () => true,
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
    const shutdown = manageApplicationShutdown(app);
    await app.init();
    return { app, shutdown, dataDirectory, host: config.server.host, port: config.server.port };
  } catch (error) {
    await app?.close();
    await cleanup();
    throw error;
  }
}
