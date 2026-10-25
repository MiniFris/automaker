import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, afterAll, afterEach, it, expect, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { ModelsCatalogService } from '../../src/modules/models/models-catalog.service.js';
import { PromptEnhancementService } from '../../src/modules/prompt-enhancement/prompt-enhancement.service.js';
import { TerminalService } from '../../src/services/terminal-service.js';
import { TerminalAccessService } from '../../src/modules/terminal/terminal-access.service.js';

let runtime: Awaited<ReturnType<typeof createNestApplication>>;
let root: string, base: string;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'model-terminal-wire-'));
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
      ALLOWED_ROOT_DIRECTORY: root,
      AUTOMAKER_API_KEY: 'wire',
      PATH: '/usr/bin:/bin',
      TERMINAL_ENABLED: 'true',
    },
  });
  await runtime.start();
  base = `http://127.0.0.1:${runtime.app.getHttpServer().address().port}/api/`;
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await runtime?.app.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});
async function call(route: string, method = 'GET', body?: unknown, key = 'wire') {
  const response = await fetch(base + route, {
    method,
    headers: { 'x-api-key': key, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, body: await response.json() };
}
const model = {
  id: 'future-model',
  name: 'Future',
  modelString: 'future',
  provider: 'fixture',
  description: '',
  tier: 'future-tier',
  contextWindow: 0,
  supportsVision: null,
  historical: null,
};
it('preserves model catalog extensions, passive provider metadata and prompt response', async () => {
  const catalog = runtime.app.get(ModelsCatalogService);
  vi.spyOn(catalog, 'listAvailable').mockResolvedValue({ success: true, models: [model] });
  const providers = {
    success: true,
    providers: {
      anthropic: { available: false, hasApiKey: false },
      cursor: { available: false, authenticated: false, authenticationChecked: false },
      'openai-compatible': { available: false, configuredEndpoints: 0 },
      extension: null,
    },
  };
  vi.spyOn(catalog, 'getProviders').mockResolvedValue(providers);
  expect(await call('models/available')).toEqual({
    status: 200,
    body: { success: true, models: [model] },
  });
  expect(await call('models/providers')).toEqual({ status: 200, body: providers });
  const enhancement = vi
    .spyOn(runtime.app.get(PromptEnhancementService), 'enhance')
    .mockResolvedValue({ success: true, enhancedText: 'enhanced offline' });
  expect(
    await call('enhance-prompt', 'POST', { originalText: 'original', enhancementMode: 'improve' })
  ).toEqual({ status: 200, body: { success: true, enhancedText: 'enhanced offline' } });
  expect(enhancement).toHaveBeenCalledWith({
    originalText: 'original',
    enhancementMode: 'improve',
  });
});
it('rejects malformed catalog/prompt producer replies and keeps admission precedence', async () => {
  const catalog = runtime.app.get(ModelsCatalogService);
  const available = vi
    .spyOn(catalog, 'listAvailable')
    .mockResolvedValue({ success: true, models: [{ id: 'missing-metadata' }] });
  vi.spyOn(catalog, 'getProviders').mockResolvedValue({ success: true, providers: {} });
  const enhancement = vi
    .spyOn(runtime.app.get(PromptEnhancementService), 'enhance')
    .mockResolvedValue({ success: true, enhancedText: 7 } as never);
  expect((await call('models/available')).status).toBe(500);
  expect((await call('models/providers')).status).toBe(500);
  expect(
    (await call('enhance-prompt', 'POST', { originalText: 'text', enhancementMode: 'improve' }))
      .status
  ).toBe(500);
  available.mockClear();
  enhancement.mockClear();
  expect((await call('models/available', 'GET', undefined, 'wrong')).status).toBe(403);
  expect((await call('enhance-prompt', 'POST', {})).status).toBe(400);
  expect(available).not.toHaveBeenCalled();
  expect(enhancement).not.toHaveBeenCalled();
});
it('validates all ten terminal operations without spawning a shell and preserves Date wire values', async () => {
  const terminal = runtime.app.get(TerminalService);
  const session = {
    id: 'offline-session',
    cwd: root,
    shell: '/offline-shell',
    createdAt: new Date('2025-01-02T03:04:05Z'),
  };
  vi.spyOn(terminal, 'getPlatformInfo').mockReturnValue({
    platform: 'fixture',
    isWSL: false,
    defaultShell: '/offline-shell',
    arch: 'future',
  });
  vi.spyOn(terminal, 'getAllSessions').mockReturnValue([session]);
  vi.spyOn(terminal, 'getSession').mockReturnValue(session as never);
  vi.spyOn(terminal, 'isSessionClosing').mockReturnValue(false);
  vi.spyOn(terminal, 'createSession').mockResolvedValue(session as never);
  vi.spyOn(terminal, 'stopSession').mockResolvedValue(true);
  vi.spyOn(terminal, 'resize').mockReturnValue(true);
  expect(await call('terminal/status')).toMatchObject({
    status: 200,
    body: {
      success: true,
      data: { enabled: true, passwordRequired: false, platform: { platform: 'fixture' } },
    },
  });
  expect(await call('terminal/auth', 'POST', {})).toEqual({
    status: 200,
    body: { success: true, data: { authenticated: true, passwordRequired: false } },
  });
  expect(await call('terminal/logout', 'POST', {})).toEqual({
    status: 200,
    body: { success: true },
  });
  expect(await call('terminal/sessions')).toEqual({
    status: 200,
    body: { success: true, data: [{ ...session, createdAt: session.createdAt.toISOString() }] },
  });
  expect(await call('terminal/sessions/offline-session')).toEqual({
    status: 200,
    body: { success: true, data: { id: session.id, cwd: root, shell: session.shell } },
  });
  expect(await call('terminal/sessions', 'POST', { cwd: root })).toEqual({
    status: 200,
    body: { success: true, data: { ...session, createdAt: session.createdAt.toISOString() } },
  });
  expect(await call('terminal/sessions/offline-session', 'DELETE')).toEqual({
    status: 200,
    body: { success: true },
  });
  expect(
    await call('terminal/sessions/offline-session/resize', 'POST', { cols: 80, rows: 24 })
  ).toEqual({ status: 200, body: { success: true } });
  expect(await call('terminal/settings', 'PUT', { maxSessions: 7 })).toEqual({
    status: 200,
    body: { success: true, data: { maxSessions: 7, currentSessions: 0 } },
  });
  expect(await call('terminal/settings')).toEqual({
    status: 200,
    body: { success: true, data: { maxSessions: 7, currentSessions: 0 } },
  });
});
it('retains terminal manual errors, limits, false outcomes and rejects malformed typed records', async () => {
  const terminal = runtime.app.get(TerminalService);
  const access = runtime.app.get(TerminalAccessService);
  const auth = vi
    .spyOn(access, 'authenticate')
    .mockReturnValue({ status: 401, body: { success: false, error: 'Invalid password' } } as never);
  expect(await call('terminal/auth', 'POST', {})).toEqual({
    status: 401,
    body: { success: false, error: 'Invalid password' },
  });
  auth.mockReturnValue({
    status: 200,
    body: { success: true, data: { authenticated: 'invalid' } },
  } as never);
  expect((await call('terminal/auth', 'POST', {})).status).toBe(500);
  vi.spyOn(terminal, 'getSession').mockReturnValue(undefined);
  expect((await call('terminal/sessions/missing')).status).toBe(404);
  vi.spyOn(terminal, 'createSession').mockResolvedValue(null);
  expect((await call('terminal/sessions', 'POST', {})).status).toBe(429);
  const stop = vi.spyOn(terminal, 'stopSession').mockResolvedValue(false);
  expect((await call('terminal/sessions/missing', 'DELETE')).status).toBe(404);
  stop.mockRejectedValue(new Error('offline cleanup failure'));
  expect(await call('terminal/sessions/missing', 'DELETE')).toMatchObject({
    status: 503,
    body: { success: false, errorCode: 'UNAVAILABLE' },
  });
  vi.spyOn(terminal, 'resize').mockReturnValue(false);
  expect(
    (await call('terminal/sessions/missing/resize', 'POST', { cols: 80, rows: 24 })).status
  ).toBe(404);
  expect(
    (await call('terminal/sessions/missing/resize', 'POST', { cols: 0, rows: 24 })).status
  ).toBe(400);
  expect((await call('terminal/settings', 'PUT', { maxSessions: 0 })).status).toBe(400);
  vi.spyOn(terminal, 'getAllSessions').mockReturnValue([{ id: 1 }] as never);
  expect((await call('terminal/sessions')).status).toBe(500);
});
