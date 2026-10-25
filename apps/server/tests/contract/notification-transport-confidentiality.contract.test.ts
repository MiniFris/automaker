import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createNestApplication } from '../../src/main.js';
import { EVENT_BUS, type EventBus } from '../../src/core/eventing/event-bus.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { EventHookService } from '../../src/services/event-hook-service.js';
import { createServer } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { NtfyService } from '../../src/services/ntfy-service.js';
import type { NtfyEndpointConfig } from '@automaker/types';

const marker = 'offline-sensitive-response-marker';
const requests: Array<{ url: string; body: string; authorization?: string }> = [];
const peer = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => {
    body += chunk;
  });
  request.on('end', () => {
    requests.push({ url: request.url!, body, authorization: request.headers.authorization });
    if (request.url === '/redirect/owned') {
      response.writeHead(307, { location: origin + '/redirected' });
      response.end();
    } else if (request.url === '/error/owned') {
      response.writeHead(500);
      response.end(marker);
    } else {
      response.end('accepted');
    }
  });
});
let origin: string;
beforeAll(async () => {
  await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(peer.address() as { port: number }).port}`;
});
beforeEach(() => {
  requests.length = 0;
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  peer.closeAllConnections();
  await new Promise<void>((resolve) => peer.close(() => resolve()));
});
const context = {
  featureId: 'owned',
  featureName: 'Offline notification',
  projectPath: '/fixture',
  projectName: 'fixture',
  timestamp: '2026-10-25T00:00:00Z',
  eventType: 'feature_success',
};
const endpoint = (route: string): NtfyEndpointConfig => ({
  id: 'private',
  name: 'Private fixture',
  serverUrl: origin + route,
  topic: 'owned',
  enabled: true,
  authType: 'token',
  token: 'offline-token',
});

it('does not expose a real failed endpoint response in returned diagnostics or logs', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const result = await new NtfyService().sendNotification(endpoint('/error'), {}, context);
  expect(result).toEqual({ success: false, error: 'HTTP 500' });
  expect(JSON.stringify(errors.mock.calls)).not.toContain(marker);
  expect(requests).toHaveLength(1);
});
it('does not forward an authenticated notification body through a redirect', async () => {
  const result = await new NtfyService().sendNotification(
    endpoint('/redirect'),
    { body: marker },
    context
  );
  expect(result).toEqual({ success: false, error: 'HTTP 307' });
  expect(requests.map((request) => request.url)).toEqual(['/redirect/owned']);
});
it('retains intentional delivery while excluding the notification title from diagnostics', async () => {
  const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
  const result = await new NtfyService().sendNotification(
    endpoint('/success'),
    { title: marker, body: 'owned-body' },
    context
  );
  expect(result).toEqual({ success: true });
  expect(requests).toEqual([
    { url: '/success/owned', body: 'owned-body', authorization: 'Bearer offline-token' },
  ]);
  expect(JSON.stringify(logs.mock.calls)).not.toContain(marker);
});

it('keeps a configured native HTTP hook on its approved endpoint instead of forwarding its body through a redirect', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-hook-redirect-'));
  const runtime = await createNestApplication({
    workingDirectory: root,
    dataDir: path.join(root, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: { HOME: root, NODE_ENV: 'test', ALLOWED_ROOT_DIRECTORY: root },
  });
  try {
    await runtime.app.get(SettingsService).updateGlobalSettings({
      eventHooks: [
        {
          id: 'private-http',
          enabled: true,
          trigger: 'feature_created',
          action: {
            type: 'http',
            url: origin + '/redirect/owned',
            method: 'POST',
            headers: { 'X-Private-Key': marker },
            body: marker,
          },
        },
      ],
    });
    runtime.app
      .get<EventBus>(EVENT_BUS)
      .emit('feature:created', { featureId: 'owned', projectPath: root });
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0));
    await vi.waitFor(() =>
      expect(
        (runtime.app.get(EventHookService) as unknown as { pending: Set<unknown> }).pending.size
      ).toBe(0)
    );
    expect(requests.map((request) => request.url)).toEqual(['/redirect/owned']);
    expect(requests[0].body).toBe(marker);
  } finally {
    await runtime.app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
