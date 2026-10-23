import type { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { createLegacyApplication } from '../../src/legacy-application.js';

const application = createLegacyApplication({
  host: '127.0.0.1',
  port: 0,
  runStartupTasks: false,
});

afterAll(async () => {
  await application.shutdown('contract test cleanup');
});

describe('legacy application lifecycle contract', () => {
  it('does not listen or install production startup tasks on import', () => {
    expect(application.server.listening).toBe(false);
  });

  it('starts explicitly without reclaiming Nest-owned health routes', async () => {
    await application.start();
    const address = application.server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);

    expect(application.server.listening).toBe(true);
    expect(response.status).toBe(401);
  });

  it('rejects unauthenticated requests for every protected endpoint in the inventory', async () => {
    const inventoryPath = path.resolve(
      import.meta.dirname,
      '../../../../docs/backend-nestjs-migration/artifacts/http-routes.json'
    );
    const inventory = JSON.parse(await readFile(inventoryPath, 'utf8')) as {
      endpoints: Array<{ access: string; method: string; path: string }>;
    };
    const address = application.server.address() as AddressInfo;
    const protectedEndpoints = inventory.endpoints.filter(
      (endpoint) => endpoint.access === 'protected'
    );

    for (const endpoint of protectedEndpoints) {
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
});
