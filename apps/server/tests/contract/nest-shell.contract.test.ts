import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { HealthResponseSchema } from '@automaker/contracts';
import { afterAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import { createNestApplication } from '../../src/main.js';
import {
  assertSingleRouteOwner,
  getApiRouteGroup,
  ROUTE_GROUP_OWNERS,
} from '../../src/legacy/legacy-router.middleware.js';
import { LEGACY_APPLICATION, LEGACY_SERVICES } from '../../src/legacy/legacy.tokens.js';
import { SettingsService } from '../../src/services/settings-service.js';

const runtime = await createNestApplication({
  host: '127.0.0.1',
  port: 0,
  runStartupTasks: false,
  enableShutdownHooks: false,
});

afterAll(async () => {
  await runtime.app.close();
});

describe('Nest shell and legacy bridge contract', () => {
  it('creates the application without listening and shares one HTTP server', () => {
    expect(runtime.app.getHttpServer()).toBe(runtime.legacy.server);
    expect(runtime.legacy.server.listening).toBe(false);
    expect(runtime.app.get(LEGACY_APPLICATION)).toBe(runtime.legacy);
  });

  it('registers the existing stateful service instances without duplicates', () => {
    const services = runtime.legacy.services;
    const expected = {
      settings: services.settingsService,
      agent: services.agentService,
      featureLoader: services.featureLoader,
      autoMode: services.autoModeService,
      claudeUsage: services.claudeUsageService,
      codexAppServer: services.codexAppServerService,
      codexModelCache: services.codexModelCacheService,
      codexUsage: services.codexUsageService,
      zaiUsage: services.zaiUsageService,
      geminiUsage: services.geminiUsageService,
      mcpTest: services.mcpTestService,
      ideation: services.ideationService,
      devServer: services.devServerService,
      notification: services.notificationService,
      eventHistory: services.eventHistoryService,
      testRunner: services.testRunnerService,
      terminal: services.terminalService,
      pipeline: services.pipelineService,
      eventHook: services.eventHookService,
      loginAttemptStore: services.loginAttemptStore,
    };

    for (const [name, token] of Object.entries(LEGACY_SERVICES)) {
      expect(runtime.app.get(token), name).toBe(expected[name as keyof typeof expected]);
    }
    expect(runtime.app.get(SettingsService)).toBe(services.settingsService);
  });

  it('has one explicit owner for every API route group', () => {
    expect(() => assertSingleRouteOwner(ROUTE_GROUP_OWNERS)).not.toThrow();
    expect(Object.values(ROUTE_GROUP_OWNERS)).toEqual(expect.arrayContaining(['legacy']));
    expect(getApiRouteGroup({ originalUrl: '/api/features/feature-1?tab=plan' })).toBe('features');
    expect(getApiRouteGroup({ originalUrl: '/not-api/features' })).toBeUndefined();
  });

  it('serves the unchanged public health contract through Nest', async () => {
    await runtime.start();
    const address = runtime.legacy.server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);

    expect(response.status).toBe(200);
    expect(HealthResponseSchema.parse(await response.json())).toMatchObject({ status: 'ok' });

    const live = await fetch(`http://127.0.0.1:${address.port}/api/health/live`, {
      headers: { 'x-request-id': 'stage-3-live-check' },
    });
    expect(live.status).toBe(200);
    expect(live.headers.get('x-request-id')).toBe('stage-3-live-check');
    expect(await live.json()).toMatchObject({ status: 'ok' });

    const corsLive = await fetch(`http://127.0.0.1:${address.port}/api/health/live`, {
      headers: { Origin: 'http://localhost:4173' },
    });
    expect(corsLive.headers.get('access-control-allow-origin')).toBe('http://localhost:4173');
    expect(corsLive.headers.get('access-control-allow-credentials')).toBe('true');

    const ready = await fetch(`http://127.0.0.1:${address.port}/api/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ status: 'ready' });

    const detailedUrl = `http://127.0.0.1:${address.port}/api/health/detailed`;
    const unauthenticated = await fetch(detailedUrl);
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toMatchObject({
      success: false,
      error: 'Authentication required.',
      errorCode: 'UNAUTHORIZED',
    });

    const invalid = await fetch(detailedUrl, { headers: { 'x-api-key': 'invalid' } });
    expect(invalid.status).toBe(403);
    const apiKeyResponse = await fetch(detailedUrl, {
      headers: { 'x-api-key': 'automaker-test-api-key' },
    });
    expect(apiKeyResponse.status).toBe(200);

    const login = await fetch(`http://127.0.0.1:${address.port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'automaker-test-api-key' }),
    });
    const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
    expect(cookie).toBeTruthy();
    const cookieResponse = await fetch(detailedUrl, { headers: { Cookie: cookie! } });
    expect(cookieResponse.status).toBe(200);
  });

  it('preserves content-type, authentication, CORS, cookie and body-limit middleware', async () => {
    const address = runtime.legacy.server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const protectedResponse = await fetch(`${baseUrl}/api/settings`);
    expect(protectedResponse.status).toBe(401);

    const missingContentType = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ apiKey: 'automaker-test-api-key' }),
    });
    expect(missingContentType.status).toBe(415);

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'automaker-test-api-key' }),
    });
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.headers.get('set-cookie')).toContain('automaker_session=');

    const corsResponse = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'http://localhost:4173' },
    });
    expect(corsResponse.headers.get('access-control-allow-origin')).toBe('http://localhost:4173');
    expect(corsResponse.headers.get('access-control-allow-credentials')).toBe('true');

    const oversizedResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'x'.repeat(50 * 1024 * 1024) }),
    });
    expect(oversizedResponse.status).toBe(413);
  });

  it('keeps WebSocket upgrades on the shared Nest HTTP server', async () => {
    const address = runtime.legacy.server.address() as AddressInfo;
    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/api/events?apiKey=automaker-test-api-key`
    );
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });

    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  });

  it('serves migrated edge modules exclusively through Nest', async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), 'nest-edge-contract-'));
    const address = runtime.legacy.server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': 'automaker-test-api-key',
    };
    try {
      const models = await fetch(`${baseUrl}/api/models/available`, { headers });
      expect(models.status).toBe(200);
      expect(await models.json()).toMatchObject({ success: true, models: expect.any(Array) });

      const workspace = await fetch(`${baseUrl}/api/workspace/config`, { headers });
      expect(workspace.status).toBe(200);
      expect(await workspace.json()).toMatchObject({ success: true });

      for (const route of [
        'settings/status',
        'settings/global',
        'settings/credentials',
        'settings/model-timeouts',
        'settings/openai-compatible',
      ]) {
        const response = await fetch(`${baseUrl}/api/${route}`, { headers });
        expect(response.status, route).toBe(200);
        expect(await response.json()).toMatchObject({ success: true });
      }

      const projectSettings = await fetch(`${baseUrl}/api/settings/project`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectPath }),
      });
      expect(projectSettings.status).toBe(200);
      expect(await projectSettings.json()).toMatchObject({ success: true });

      const invalidSettings = await fetch(`${baseUrl}/api/settings/project`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectPath, unexpected: true }),
      });
      expect(invalidSettings.status).toBe(400);

      const invalidProvider = await fetch(`${baseUrl}/api/settings/model-timeouts/not-a-provider`, {
        headers,
      });
      expect(invalidProvider.status).toBe(400);

      for (const route of ['notifications/list', 'event-history/list']) {
        const response = await fetch(`${baseUrl}/api/${route}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ projectPath }),
        });
        expect(response.status, route).toBe(200);
        expect(await response.json()).toMatchObject({ success: true });
      }

      const strictRequest = await fetch(`${baseUrl}/api/notifications/list`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectPath, unexpected: true }),
      });
      expect(strictRequest.status).toBe(400);

      const invalidTemplate = await fetch(`${baseUrl}/api/templates/clone`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          repoUrl: 'https://example.com/x',
          projectName: 'x',
          parentDir: projectPath,
        }),
      });
      expect(invalidTemplate.status).toBe(400);
    } finally {
      await rm(projectPath, { recursive: true });
    }
  });

  it('preserves authentication for every protected endpoint through Nest', async () => {
    const inventoryPath = path.resolve(
      import.meta.dirname,
      '../../../../docs/backend-nestjs-migration/artifacts/http-routes.json'
    );
    const inventory = JSON.parse(await readFile(inventoryPath, 'utf8')) as {
      endpoints: Array<{ access: string; method: string; path: string }>;
    };
    const address = runtime.legacy.server.address() as AddressInfo;

    for (const endpoint of inventory.endpoints.filter(({ access }) => access === 'protected')) {
      const requestPath = endpoint.path
        .replace(/:[^/]+/g, 'contract-fixture')
        .replace(/\*/g, 'contract-fixture');
      const response = await fetch(`http://127.0.0.1:${address.port}${requestPath}`, {
        method: endpoint.method,
        headers: { 'Content-Type': 'application/json' },
        body: ['GET', 'HEAD'].includes(endpoint.method) ? undefined : '{}',
      });

      expect(response.status, `${endpoint.method} ${endpoint.path}`).toBe(401);
    }
  });

  it('cleans up a partially initialized Nest application when a blocking task fails', async () => {
    const initialize = vi.fn().mockRejectedValue(new Error('startup fixture failed'));

    await expect(
      createNestApplication({
        host: '127.0.0.1',
        port: 0,
        runStartupTasks: true,
        enableShutdownHooks: false,
        services: { agentService: { initialize } as never },
      })
    ).rejects.toThrow('startup fixture failed');
    expect(initialize).toHaveBeenCalledOnce();
  });
});
