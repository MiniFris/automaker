import { createServer, type Server, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { probeBackend } from '../../../src/electron/server/health-probe';

const identity = {
  apiKey: 'startup-fixture-key',
  startupId: '01020304-0506-4708-890a-0b0c0d0e0f10',
  dataDirectory: '/owned/startup-data',
};
const health = () => ({
  status: 'ok',
  version: '1.0.0',
  timestamp: new Date().toISOString(),
  dataDir: identity.dataDirectory,
});
const servers: Server[] = [];
async function serve(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return (server.address() as AddressInfo).port;
}
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

describe('backend startup handshake', () => {
  it('external mode accepts public JSON health without sending an API key', async () => {
    const port = await serve((request, response) => {
      expect(request.url).toBe('/api/health');
      expect(request.headers['x-api-key']).toBeUndefined();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(health()));
    });
    await expect(probeBackend(port)).resolves.toBeUndefined();
  });
  it('embedded mode authenticates and requires this launch and data directory', async () => {
    const port = await serve((request, response) => {
      expect(request.url).toBe('/api/health/detailed');
      expect(request.headers['x-api-key']).toBe(identity.apiKey);
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.setHeader('x-automaker-instance-id', identity.startupId);
      response.end(JSON.stringify(health()));
    });
    await expect(probeBackend(port, identity)).resolves.toBeUndefined();
  });
  it.each([
    ['SPA HTML', 'text/html', '<html><div id="root"></div></html>', undefined],
    ['HTML labelled JSON', 'application/json', '<html>wrong server</html>', undefined],
    ['unrelated JSON', 'application/json', '{}', undefined],
    [
      'another instance with the same key',
      'application/json',
      () => JSON.stringify(health()),
      '11020304-0506-4708-890a-0b0c0d0e0f10',
    ],
    [
      'incorrect data directory',
      'application/json',
      () => JSON.stringify({ ...health(), dataDir: '/another/data' }),
      identity.startupId,
    ],
    ['oversized response', 'application/json', ' '.repeat(65537), identity.startupId],
  ])('rejects %s', async (_name, contentType, body, startupId) => {
    const port = await serve((_request, response) => {
      response.setHeader('content-type', contentType);
      if (startupId) response.setHeader('x-automaker-instance-id', startupId);
      response.end(typeof body === 'function' ? body() : body);
    });
    await expect(probeBackend(port, identity)).rejects.toThrow('Backend health probe failed.');
  });
  it('bounds a connected server that never returns health', async () => {
    const port = await serve(() => {});
    const started = Date.now();
    await expect(probeBackend(port, identity)).rejects.toThrow('Backend health probe failed.');
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
