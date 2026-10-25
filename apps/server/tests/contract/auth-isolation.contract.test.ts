import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { AuthService } from '../../src/core/auth/auth.service.js';

it('isolates native HTTP/WS credentials and restores only its own persisted sessions after restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-auth-isolation-'));
  const runtimes: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const start = async (name: string) => {
    const runtime = await createNestApplication({
      host: '127.0.0.1',
      port: 0,
      dataDir: path.join(directory, name),
      runStartupTasks: false,
      enableShutdownHooks: false,
      environment: {
        NODE_ENV: 'test',
        AUTOMAKER_API_KEY: `${name}-key`,
        ENABLE_REQUEST_LOGGING: 'false',
      },
    });
    runtimes.push(runtime);
    await runtime.start();
    const { port } = runtime.app.getHttpServer().address() as AddressInfo;
    return { runtime, base: `http://127.0.0.1:${port}/api` };
  };
  const login = async (base: string, key: string) => {
    const response = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key }),
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { token: string }).token;
  };
  const detailed = (base: string, token: string) =>
    fetch(`${base}/health/detailed`, {
      headers: { Cookie: `automaker_session=${token}` },
    });
  try {
    const first = await start('first');
    const second = await start('second');
    const token = await login(first.base, 'first-key');
    const secondToken = await login(second.base, 'second-key');
    expect((await detailed(first.base, token)).status).toBe(200);
    expect((await detailed(second.base, token)).status).toBe(401);
    expect(
      (await fetch(`${second.base}/health/detailed`, { headers: { 'x-api-key': 'first-key' } }))
        .status
    ).toBe(403);
    const wsResponse = await fetch(`${first.base}/auth/token`, {
      headers: { 'x-api-key': 'first-key' },
    });
    expect(wsResponse.status).toBe(200);
    const wsToken = ((await wsResponse.json()) as { token: string }).token;
    expect(second.runtime.app.get(AuthService).consumeWebSocketToken(wsToken)).toBe(false);
    expect(first.runtime.app.get(AuthService).consumeWebSocketToken(wsToken)).toBe(true);
    expect(first.runtime.app.get(AuthService).consumeWebSocketToken(wsToken)).toBe(false);

    await first.runtime.app.close();
    expect((await detailed(second.base, secondToken)).status).toBe(200);
    const restarted = await start('first');
    expect((await detailed(restarted.base, token)).status).toBe(200);
    expect((await detailed(restarted.base, secondToken)).status).toBe(401);
    const logout = await fetch(`${restarted.base}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `automaker_session=${token}` },
      body: '{}',
    });
    expect(logout.status).toBe(200);
    await restarted.runtime.app.close();
    const afterLogout = await start('first');
    expect((await detailed(afterLogout.base, token)).status).toBe(401);
    expect((await detailed(second.base, secondToken)).status).toBe(200);
  } finally {
    for (const runtime of runtimes) await runtime.app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
