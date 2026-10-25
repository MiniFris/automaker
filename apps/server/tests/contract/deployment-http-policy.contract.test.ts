import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createNestApplication } from '../../src/main.js';

let runtime: Awaited<ReturnType<typeof createNestApplication>>;
let directory: string;
let base: string;
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'deployment-http-policy-'));
  runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: directory,
    dataDir: path.join(directory, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      HOME: directory,
      NODE_ENV: 'production',
      AUTOMAKER_API_KEY: 'private-policy-fixture',
      CORS_ORIGIN: 'https://automaker.example',
      ALLOWED_ROOT_DIRECTORY: directory,
    },
  });
  await runtime.start();
  base = `http://127.0.0.1:${runtime.app.getHttpServer().address().port}`;
});
afterAll(async () => {
  await runtime?.app.close();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

it.each([
  'https://automaker.example',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://192.168.1.2:4173',
  'http://10.1.2.3:4173',
  'http://172.20.1.2:4173',
])('retains credentialed configured/local origin: %s', async (origin) => {
  const response = await fetch(base + '/api/health/live', { headers: { origin } });
  expect(response.status).toBe(200);
  expect(response.headers.get('access-control-allow-origin')).toBe(origin);
  expect(response.headers.get('access-control-allow-credentials')).toBe('true');
  await response.arrayBuffer();
});
it.each(['https://foreign.example', 'null', 'malformed'])(
  'does not allow foreign origin: %s',
  async (origin) => {
    const response = await fetch(base + '/api/health/live', { headers: { origin } });
    expect(response.ok).toBe(false);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    await response.arrayBuffer();
  }
);
it('handles JSON preflight without claiming private-network permission', async () => {
  const response = await fetch(base + '/api/auth/login', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://automaker.example',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,x-api-key',
      'access-control-request-private-network': 'true',
    },
  });
  expect(response.status).toBe(204);
  expect(response.headers.get('access-control-allow-headers')).toContain('x-api-key');
  expect(response.headers.get('access-control-allow-private-network')).toBeNull();
});
it('ignores spoofed forwarding protocol and uses production cookie policy', async () => {
  expect(runtime.app.getHttpAdapter().getInstance().get('trust proxy')).toBe(false);
  const response = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-proto': 'http',
      'x-forwarded-for': '203.0.113.1',
    },
    body: JSON.stringify({ apiKey: 'private-policy-fixture' }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie')!;
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('Secure');
  expect(cookie).toContain('SameSite=Lax');
  await response.arrayBuffer();
  for (const contentType of [
    'text/plain',
    'application/x-www-form-urlencoded',
    'multipart/form-data',
  ]) {
    const rejected = await fetch(base + '/api/auth/logout', {
      method: 'POST',
      headers: { cookie: cookie.split(';')[0], 'content-type': contentType },
      body: 'ignored',
    });
    expect(rejected.status).toBe(415);
    expect(await rejected.json()).toMatchObject({ errorCode: 'UNSUPPORTED_MEDIA_TYPE' });
  }
});
