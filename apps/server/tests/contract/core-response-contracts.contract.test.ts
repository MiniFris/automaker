import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { expect, it } from 'vitest';
import {
  HealthResponseSchema,
  HealthEnvironmentResponseSchema,
  LivenessResponseSchema,
  ReadinessResponseSchema,
  DetailedHealthResponseSchema,
} from '@automaker/contracts';
import {
  AuthStatusResponseSchema,
  LoginResponseSchema,
  LogoutResponseSchema,
  WebSocketTokenResponseSchema,
} from '@automaker/contracts/domains/auth';
import { createNestApplication } from '../../src/main.js';
import { ReadinessStateService } from '../../src/core/lifecycle/readiness-state.service.js';

it('serves the shared health/auth success contracts while retaining auth, cookie and readiness behavior', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automaker-core-responses-'));
  let runtime: Awaited<ReturnType<typeof createNestApplication>> | undefined;
  try {
    runtime = await createNestApplication({
      host: '127.0.0.1',
      port: 0,
      workingDirectory: root,
      dataDir: path.join(root, 'data'),
      runStartupTasks: false,
      enableShutdownHooks: false,
      providerRegistrations: [],
      environment: {
        NODE_ENV: 'test',
        HOME: root,
        USERPROFILE: root,
        XDG_CONFIG_HOME: path.join(root, 'config'),
        AUTOMAKER_API_KEY: 'core-response-fixture',
        ALLOWED_ROOT_DIRECTORY: root,
      },
    });
    await runtime.start();
    const base = `http://127.0.0.1:${runtime.app.getHttpServer().address().port}/api`;
    const key = { 'X-API-Key': 'core-response-fixture' };
    async function json(
      endpoint: string,
      schema: { parse(value: unknown): unknown },
      headers?: Record<string, string>
    ) {
      const response = await fetch(base + endpoint, { headers });
      expect(response.status).toBe(200);
      return schema.parse(await response.json());
    }
    await json('/health', HealthResponseSchema);
    await json('/health/environment', HealthEnvironmentResponseSchema);
    await json('/health/live', LivenessResponseSchema);
    await json('/health/ready', ReadinessResponseSchema);
    expect((await fetch(base + '/health/detailed')).status).toBe(401);
    const detailed = await json('/health/detailed', DetailedHealthResponseSchema, key);
    expect(detailed).toMatchObject({
      dataDir: path.join(root, 'data'),
      auth: { enabled: true, method: 'api_key_or_session' },
    });
    expect(await json('/auth/status', AuthStatusResponseSchema)).toMatchObject({
      authenticated: false,
      required: true,
    });
    expect((await fetch(base + '/auth/token')).status).toBe(401);
    await json('/auth/token', WebSocketTokenResponseSchema, key);
    const login = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'core-response-fixture' }),
    });
    expect(login.status).toBe(200);
    expect(LoginResponseSchema.parse(await login.json())).toMatchObject({ success: true });
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    expect(cookie).toBeTruthy();
    expect(await json('/auth/status', AuthStatusResponseSchema, { Cookie: cookie! })).toMatchObject(
      { authenticated: true }
    );
    const unsafeLogout = await fetch(base + '/auth/logout', {
      method: 'POST',
      headers: { Cookie: cookie! },
    });
    expect(unsafeLogout.status).toBe(415);
    const logout = await fetch(base + '/auth/logout', {
      method: 'POST',
      headers: { Cookie: cookie!, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(logout.status).toBe(200);
    expect(LogoutResponseSchema.parse(await logout.json())).toMatchObject({ success: true });
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await json('/auth/status', AuthStatusResponseSchema, { Cookie: cookie! })).toMatchObject(
      { authenticated: false }
    );
    runtime.app.get(ReadinessStateService).markStopping();
    const stopped = await fetch(base + '/health/ready');
    expect(stopped.status).toBe(503);
    expect(await stopped.json()).toMatchObject({
      statusCode: 503,
      message: 'Application is not ready.',
    });
    await json('/health/live', LivenessResponseSchema);
  } finally {
    await runtime?.app.close();
    await rm(root, { recursive: true, force: true });
  }
});
