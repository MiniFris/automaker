import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import WebSocket from 'ws';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { PreviewPolicy, PREVIEW_BOOTSTRAP } from '../../src/core/config/index.js';
import { PreviewGateway } from '../../src/services/execution-environment/preview-gateway.js';
import { ManagedDevServerService } from '../../src/services/execution-environment/dev-server.js';
import { WebSocketTransportService } from '../../src/modules/terminal/websocket-transport.service.js';

let root: string;
const owners: Awaited<ReturnType<typeof createNestApplication>>[] = [];
const clients: WebSocket[] = [];
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'preview-app-policy-'));
});
afterEach(async () => {
  for (const client of clients.splice(0)) client.terminate();
  const closed = await Promise.allSettled(owners.splice(0).map((owner) => owner.app.close()));
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
  for (const result of closed) if (result.status === 'rejected') throw result.reason;
});
async function start(name: string, first = 45010, last = first + 1) {
  const directory = path.join(root, name);
  await mkdir(directory);
  const environment = {
    NODE_ENV: 'test',
    AUTOMAKER_API_KEY: 'fixture',
    CORS_ORIGIN: '*',
    AUTOMAKER_PREVIEW_PORT_FIRST: String(first),
    AUTOMAKER_PREVIEW_PORT_LAST: String(last),
    AUTOMAKER_PREVIEW_PUBLIC_URL: `https://${name}-{port}.preview.invalid`,
    AUTOMAKER_PREVIEW_BIND: '127.0.0.1',
  };
  const owner = await createNestApplication({
    workingDirectory: directory,
    host: '127.0.0.1',
    port: 0,
    dataDir: path.join(directory, 'data'),
    environment,
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
  });
  owners.push(owner);
  await owner.start();
  const base = `http://127.0.0.1:${owner.app.getHttpServer().address().port}`;
  return {
    ...owner,
    base,
    directory,
    environment,
    policy: owner.app.get(PreviewPolicy),
    managed: owner.app.get(ManagedDevServerService),
  };
}
async function status(base: string, headers: Record<string, string>) {
  const response = await fetch(base + '/api/health', {
    headers: { 'x-api-key': 'fixture', Connection: 'close', ...headers },
  });
  await response.text();
  return response.status;
}
function upgrade(base: string, origin: string): Promise<number> {
  const client = new WebSocket(base.replace('http:', 'ws:') + '/api/events', {
    headers: { Origin: origin, 'x-api-key': 'fixture' },
  });
  clients.push(client);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Private upgrade timed out.')), 2000);
    client.on('error', () => {});
    client.once('unexpected-response', (_, response) => {
      clearTimeout(timer);
      response.resume();
      resolve(response.statusCode!);
      client.terminate();
    });
    client.once('open', () => {
      clearTimeout(timer);
      client.close();
      resolve(101);
    });
  });
}

it('keeps HTTP/WS preview origin policy and managed descriptions isolated between two app snapshots', async () => {
  const one = await start('one', 45010),
    two = await start('two', 45110);
  expect(one.policy).not.toBe(two.policy);
  expect((one.managed as unknown as { preview: unknown }).preview).toBe(one.policy);
  expect((one.app.get(WebSocketTransportService) as unknown as { preview: unknown }).preview).toBe(
    one.policy
  );
  one.environment.AUTOMAKER_PREVIEW_PUBLIC_URL = 'https://mutated-{port}.invalid';
  vi.stubEnv('AUTOMAKER_PREVIEW_PUBLIC_URL', 'not an origin');
  vi.stubEnv('AUTOMAKER_PREVIEW_PORT_FIRST', '1');
  vi.stubEnv('AUTOMAKER_PREVIEW_PORT_LAST', '65535');
  const oneOrigin = one.policy.origin(45010),
    twoOrigin = two.policy.origin(45110);
  expect(oneOrigin).toBe('https://one-45010.preview.invalid');
  expect(await status(one.base, { Origin: oneOrigin })).toBe(403);
  expect(await status(two.base, { Origin: oneOrigin })).toBe(200);
  expect(await status(two.base, { Origin: twoOrigin })).toBe(403);
  expect(await status(one.base, { Origin: twoOrigin })).toBe(200);
  expect(await upgrade(one.base, oneOrigin)).toBe(403);
  expect(await upgrade(two.base, oneOrigin)).toBe(101);
  expect(await upgrade(two.base, twoOrigin)).toBe(403);
  for (const origin of ['malformed', 'file:///tmp/x', 'https://safe.invalid/path']) {
    expect(await status(one.base, { Origin: origin })).toBe(403);
    expect(await upgrade(one.base, origin)).toBe(403);
  }
  expect(await status(one.base, { Referer: 'http://any-host.invalid:45011/path' })).toBe(403);
  const session = {
    sessionId: 'managed-dev-fixture',
    target: { environment: { path: path.join(one.directory, 'relative') } },
    gateway: { port: 45010, url: oneOrigin + PREVIEW_BOOTSTRAP },
    finished: true,
  };
  const sessions = (one.managed as unknown as { sessions: Map<string, unknown> }).sessions;
  sessions.set(session.sessionId, session);
  try {
    expect(one.managed.find('relative')).toBe(session);
    expect(one.managed.describe(session as never)).toMatchObject({
      preserveUrlHost: true,
      url: oneOrigin + PREVIEW_BOOTSTRAP,
      targetPort: 46010,
    });
  } finally {
    sessions.delete(session.sessionId);
  }
});

it('uses an owned ephemeral gateway bind and retains its origin denial after gateway expiration', async () => {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = (reservation.address() as { port: number }).port;
  expect(port).toBeGreaterThan(3119);
  expect(port).toBeLessThanOrEqual(64535);
  let gateway: PreviewGateway | undefined;
  try {
    const owner = await start('gateway', port, port);
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    gateway = new PreviewGateway(owner.policy);
    await gateway.listen(port);
    vi.stubEnv('AUTOMAKER_PREVIEW_PUBLIC_URL', 'https://changed-{port}.invalid');
    vi.stubEnv('AUTOMAKER_PREVIEW_BIND', '/not/a/socket');
    const origin = owner.policy.origin(port);
    expect(gateway.url).toBe(`${origin}${PREVIEW_BOOTSTRAP}#${gateway.key}`);
    const result = await new Promise<{ status: number; cookie: string[] | undefined }>(
      (resolve, reject) => {
        const message = request(
          {
            host: '127.0.0.1',
            port,
            method: 'POST',
            path: PREVIEW_BOOTSTRAP + '/authorize',
            headers: {
              Host: new URL(origin).host,
              Origin: origin,
              'X-Automaker-Preview': gateway!.key,
            },
          },
          (response) => {
            response.resume();
            response.once('end', () =>
              resolve({ status: response.statusCode!, cookie: response.headers['set-cookie'] })
            );
          }
        );
        message.once('error', reject);
        message.end();
      }
    );
    expect(result.status).toBe(204);
    expect(result.cookie?.[0]).toContain('; Secure');
    await gateway.close();
    expect(await status(owner.base, { Origin: origin })).toBe(403);
    expect(await upgrade(owner.base, origin)).toBe(403);
  } finally {
    if (reservation.listening)
      await new Promise<void>((resolve) => reservation.close(() => resolve()));
    await gateway?.close();
  }
});
