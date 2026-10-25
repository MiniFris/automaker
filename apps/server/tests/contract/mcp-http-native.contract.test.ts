import { createServer } from 'node:http';
import { once } from 'node:events';
import { SECURE_FILESYSTEM } from '../../src/core/security/index.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { MCPTestService } from '../../src/services/mcp-test-service.js';
import { mcpHTTPPeer } from '../helpers/mcp-http-peer.js';
import type { MCPServerConfig } from '@automaker/types';

const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [],
  roots: string[] = [],
  peers: Awaited<ReturnType<typeof mcpHTTPPeer>>[] = [];
afterEach(async () => {
  const closed = await Promise.allSettled(apps.splice(0).map((runtime) => runtime.app.close()));
  await Promise.all(peers.splice(0).map((peer) => peer.close()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  for (const result of closed) if (result.status === 'rejected') throw result.reason;
});
async function fixture(config: MCPServerConfig, name = 'fixture') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-native-'));
  roots.push(root);
  const environment = {
    NODE_ENV: 'test',
    HOME: root,
    PATH: `${root}/private-bin`,
    ALLOWED_ROOT_DIRECTORY: root,
    AUTOMAKER_API_KEY: name,
  };
  const runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: root,
    dataDir: path.join(root, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment,
  });
  apps.push(runtime);
  await runtime.start();
  const settings = runtime.app.get(SettingsService);
  await settings.updateGlobalSettings({ mcpServers: [config] });
  const base = `http://127.0.0.1:${runtime.app.getHttpServer().address().port}/api/mcp/`;
  async function post(action: string, body: unknown = { serverId: config.id }, key = name) {
    const response = await fetch(base + action, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  return { root, runtime, settings, post, environment };
}
async function peer(type: 'http' | 'sse', mode = 'success') {
  const value = await mcpHTTPPeer(type, mode);
  peers.push(value);
  return value;
}
for (const type of ['http', 'sse'] as const) {
  it(`native ${type} handshake/tools honors auth and saved target/header; manual disabled-server tests remain allowed`, async () => {
    const remote = await peer(type);
    const f = await fixture({
      id: 'saved',
      name: 'Private',
      type,
      url: remote.url,
      headers: { Authorization: 'fixture-header-secret' },
      enabled: false,
    });
    expect((await f.post('test', undefined, 'wrong')).status).toBe(403);
    expect(remote.requests).toHaveLength(0);
    expect((await f.post('test', { serverId: 'missing', url: remote.url })).body.success).toBe(
      false
    );
    expect(remote.requests).toHaveLength(0);
    expect(
      (await f.post('test', { serverId: 'saved', url: 'http://must-not-contact.invalid' })).body
    ).toMatchObject({ success: true, serverInfo: { name: 'private-mcp-peer' } });
    expect(remote.lists).toBe(0);
    expect((await f.post('tools')).body).toMatchObject({
      success: true,
      tools: [{ name: 'fixture_read' }],
    });
    expect(
      remote.requests.every((request) => request.authorization === 'fixture-header-secret')
    ).toBe(true);
    if (type === 'http')
      expect(remote.responseTypes.some((value) => value.includes('text/event-stream'))).toBe(true);
    await vi.waitFor(() => expect(remote.responses.size).toBe(0));
  });
  it.each(['empty', 'oversize-list', 'unterminated', 'raw-error'])(
    `native ${type} bounds and sanitizes %s before SDK parsing`,
    async (mode) => {
      const remote = await peer(type, mode);
      const f = await fixture({
        id: 'saved',
        name: 'Private',
        type,
        url: remote.url,
        headers: { Authorization: 'fixture-header-secret' },
      });
      const result = (
        await f.post(mode === 'unterminated' || mode === 'raw-error' ? 'test' : 'tools')
      ).body;
      if (mode === 'empty') expect(result).toMatchObject({ success: true, tools: [] });
      else {
        expect(result.success).toBe(false);
        expect(JSON.stringify(result)).not.toMatch(
          /fixture-header-secret|unconfigured-private-payload/
        );
        if (mode !== 'raw-error') expect(result.error).toContain('exceeds the allowed size');
      }
      await vi.waitFor(() => expect(remote.responses.size).toBe(0));
    }
  );
  it.each(['hang-connect', 'hang-list'])(
    `${type} operation deadline aborts actual held %s response`,
    async (mode) => {
      const remote = await peer(type, mode);
      const service = new MCPTestService(
        {
          getGlobalSettings: async () => ({
            mcpServers: [{ id: 'saved', name: 'Private', type, url: remote.url }],
          }),
        } as never,
        100
      );
      const result = await service.listToolsById('saved');
      expect(result).toMatchObject({
        success: false,
        error: mode === 'hang-connect' ? 'Connection timeout' : 'List tools timeout',
      });
      await service.beforeApplicationShutdown();
      await vi.waitFor(() => expect(remote.responses.size).toBe(0));
    }
  );
}
it('closing one native app drains held HTTP/SSE and prevents reconnect while another app remains usable', async () => {
  const http = await peer('http', 'hang-list'),
    sse = await peer('sse', 'hang-list'),
    healthy = await peer('http');
  const one = await fixture({ id: 'http', name: 'HTTP', type: 'http', url: http.url }, 'one');
  await one.settings.updateGlobalSettings({
    mcpServers: [
      { id: 'http', name: 'HTTP', type: 'http', url: http.url },
      { id: 'sse', name: 'SSE', type: 'sse', url: sse.url },
    ],
  });
  const two = await fixture(
    { id: 'healthy', name: 'Healthy', type: 'http', url: healthy.url },
    'two'
  );
  const held = [one.post('tools', { serverId: 'http' }), one.post('tools', { serverId: 'sse' })];
  await vi.waitFor(() => expect(http.lists + sse.lists).toBe(2));
  await one.runtime.app.close();
  expect((await Promise.all(held)).every((result) => result.body.success === false)).toBe(true);
  await vi.waitFor(() => expect(http.responses.size + sse.responses.size).toBe(0));
  const count = http.requests.length + sse.requests.length;
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(http.requests.length + sse.requests.length).toBe(count);
  expect((await two.post('tools')).body.success).toBe(true);
});

it('native HTTP JSON-response mode completes the real SDK initialize and list protocol', async () => {
  const remote = await peer('http', 'json');
  const f = await fixture({ id: 'saved', name: 'JSON', type: 'http', url: remote.url });
  expect((await f.post('tools')).body).toMatchObject({
    success: true,
    tools: [{ name: 'fixture_read' }],
  });
  await vi.waitFor(() => expect(remote.responses.size).toBe(0));
  expect(remote.responseTypes.some((value) => value.includes('application/json'))).toBe(true);
});

it('native shutdown drains an accepted saved-config lookup before the filesystem barrier and cannot dispatch it later', async () => {
  const remote = await peer('http');
  const f = await fixture({ id: 'saved', name: 'Held', type: 'http', url: remote.url });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = f.settings.getGlobalSettings.bind(f.settings);
  const lookup = vi.spyOn(f.settings, 'getGlobalSettings').mockImplementationOnce(async () => {
    await held;
    return original();
  });
  const filesystem = f.runtime.app.get(SECURE_FILESYSTEM) as {
    beforeApplicationShutdown(): Promise<void>;
  };
  const barrier = vi.spyOn(filesystem, 'beforeApplicationShutdown');
  const pending = f.post('test');
  await vi.waitFor(() => expect(lookup).toHaveBeenCalled());
  const close = f.runtime.app.close();
  await vi.waitFor(() =>
    expect((f.runtime.app.get(MCPTestService) as unknown as { stopping: boolean }).stopping).toBe(
      true
    )
  );
  expect(barrier).not.toHaveBeenCalled();
  release();
  expect((await pending).body.success).toBe(false);
  await close;
  expect(barrier).toHaveBeenCalledOnce();
  expect(remote.requests).toHaveLength(0);
});

for (const type of ['http', 'sse'] as const) {
  it.each([301, 302, 307, 308])(
    `native ${type} rejects redirect %s before configured credentials reach its peer`,
    async (status) => {
      const target = await peer(type);
      const received: Array<Record<string, unknown>> = [];
      const entry = createServer((request, response) => {
        received.push({
          authorization: request.headers.authorization,
          custom: request.headers['x-private-key'],
        });
        response.writeHead(status, { location: target.url + '?private-location-secret' });
        response.end('private-redirect-body');
      });
      entry.listen(0, '127.0.0.1');
      await once(entry, 'listening');
      try {
        const address = entry.address() as { port: number };
        const f = await fixture({
          id: 'saved',
          name: 'Private redirect',
          type,
          url: `http://127.0.0.1:${address.port}/configured`,
          headers: {
            Authorization: 'configured-auth-secret',
            'X-Private-Key': 'configured-custom-secret',
          },
        });
        const result = (await f.post('tools')).body;
        expect(result.success).toBe(false);
        expect(JSON.stringify(result)).not.toMatch(
          /configured-auth-secret|configured-custom-secret|private-location-secret|private-redirect-body/
        );
        expect(received).toEqual([
          { authorization: 'configured-auth-secret', custom: 'configured-custom-secret' },
        ]);
        expect(target.requests).toHaveLength(0);
        await f.runtime.app.close();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(received).toHaveLength(1);
        expect(target.requests).toHaveLength(0);
      } finally {
        const closed = new Promise<void>((resolve, reject) =>
          entry.close((error) => (error ? reject(error) : resolve()))
        );
        entry.closeAllConnections();
        await closed;
      }
    }
  );
}
