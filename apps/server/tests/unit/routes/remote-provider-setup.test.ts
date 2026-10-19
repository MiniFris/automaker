import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { SettingsService } from '@/services/settings-service.js';
import { ProviderSetupService } from '@/services/execution-environment/provider-setup.js';
import { createExecutionEnvironmentSettingsRoutes } from '@/routes/settings/execution-environments.js';

let temporary: string, project: string, server: Server, url: string;
const status = {
  provider: 'codex',
  targetId: 'a'.repeat(64),
  environment: 'ssh',
  cwd: '/remote',
  root: '/remote/home/sdk',
  packageVersion: '0.98.0',
  installed: true,
  hasStoredKey: false,
  credentialSource: 'not-detected',
  authentication: 'not-detected',
} as const;
beforeEach(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-api-test-'));
  project = path.join(temporary, 'project');
  await fs.mkdir(project);
  const app = express();
  app.use(express.json());
  app.use(
    createExecutionEnvironmentSettingsRoutes(new SettingsService(path.join(temporary, 'data')))
  );
  server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/providers`;
});
afterEach(async () => {
  vi.restoreAllMocks();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(temporary, { recursive: true, force: true });
});
async function request(action: string, body: unknown) {
  return fetch(url + '/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
it('routes an explicit target inspection without accepting runtime/package overrides', async () => {
  const run = vi.spyOn(ProviderSetupService.prototype, 'run').mockResolvedValue(status);
  expect(
    await (await request('inspect', { projectPath: project, provider: 'codex' })).json()
  ).toEqual({ success: true, status });
  expect(run).toHaveBeenCalledWith(project, 'codex', 'inspect', expect.any(AbortSignal), undefined);
  expect(
    (await request('inspect', { projectPath: project, provider: 'codex', command: 'sh' })).status
  ).toBe(400);
  expect(run).toHaveBeenCalledTimes(1);
});
it.each([
  ['install', { provider: 'codex' }],
  ['install', { provider: 'codex', targetId: 'a'.repeat(64), accepted: false }],
  ['install', { provider: 'arbitrary-package', targetId: 'a'.repeat(64), accepted: true }],
  [
    'key',
    { provider: 'codex', targetId: 'a'.repeat(64), accepted: true, apiKey: 'token\nwith-newline' },
  ],
  [
    'key',
    {
      provider: 'codex',
      targetId: 'a'.repeat(64),
      accepted: true,
      apiKey: 'target-test-token',
      clear: true,
    },
  ],
  ['key', { provider: 'codex', targetId: 'a'.repeat(64), accepted: true, clear: 'yes' }],
])('rejects invalid %s before connecting or writing', async (action, body) => {
  const run = vi.spyOn(ProviderSetupService.prototype, 'run');
  expect((await request(action, { projectPath: project, ...body })).status).toBe(400);
  expect(run).not.toHaveBeenCalled();
});
it('accepts a separately confirmed target key and never returns its value', async () => {
  const run = vi.spyOn(ProviderSetupService.prototype, 'run').mockResolvedValue({
    ...status,
    hasStoredKey: true,
    credentialSource: 'managed-key',
    authentication: 'configured-unverified',
  });
  const response = await request('key', {
    projectPath: project,
    provider: 'codex',
    targetId: status.targetId,
    accepted: true,
    apiKey: 'target-test-token',
  });
  const body = await response.json();
  expect(body.status.hasStoredKey).toBe(true);
  expect(JSON.stringify(body)).not.toContain('target-test-token');
  expect(run).toHaveBeenCalledWith(project, 'codex', 'key', expect.any(AbortSignal), {
    targetId: status.targetId,
    apiKey: 'target-test-token',
    clear: false,
  });
});
