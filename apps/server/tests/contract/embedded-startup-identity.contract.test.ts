import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createNestApplication } from '../../src/main.js';

describe('embedded startup identity header', () => {
  it.each([
    '01020304-0506-4708-890a-0b0c0d0e0f10',
    '11020304-0506-4708-890a-0b0c0d0e0f10',
    'invalid-instance\r\nraw-env',
  ])('only returns a valid launch snapshot on authenticated detailed health: %j', async (nonce) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-startup-identity-'));
    let runtime: Awaited<ReturnType<typeof createNestApplication>> | undefined;
    try {
      runtime = await createNestApplication({
        host: '127.0.0.1',
        port: 0,
        workingDirectory: directory,
        dataDir: path.join(directory, 'data'),
        providerRegistrations: [],
        runStartupTasks: false,
        enableShutdownHooks: false,
        environment: {
          NODE_ENV: 'test',
          AUTOMAKER_API_KEY: 'fixture',
          ENABLE_REQUEST_LOGGING: 'false',
          AUTOMAKER_EMBEDDED_SERVER_ID: nonce,
        },
      });
      await runtime.start();
      const url = `http://127.0.0.1:${(runtime.app.getHttpServer().address() as AddressInfo).port}/api/health`;
      const publicResponse = await fetch(url);
      expect(publicResponse.status).toBe(200);
      expect(publicResponse.headers.has('x-automaker-instance-id')).toBe(false);
      expect(await publicResponse.json()).toMatchObject({
        status: 'ok',
        version: expect.any(String),
      });
      const denied = await fetch(url + '/detailed');
      expect(denied.status).toBe(401);
      expect(denied.headers.has('x-automaker-instance-id')).toBe(false);
      await denied.arrayBuffer();
      const detailed = await fetch(url + '/detailed', { headers: { 'x-api-key': 'fixture' } });
      expect(detailed.status).toBe(200);
      expect(detailed.headers.get('x-automaker-instance-id')).toBe(
        nonce.startsWith('invalid') ? null : nonce
      );
      const body = await detailed.json();
      expect(Object.keys(body).sort()).toEqual([
        'auth',
        'dataDir',
        'env',
        'memory',
        'status',
        'timestamp',
        'uptime',
        'version',
      ]);
      expect(body.dataDir).toBe(path.join(directory, 'data'));
      expect(JSON.stringify(body)).not.toContain(nonce);
    } finally {
      await runtime?.app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
