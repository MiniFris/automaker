import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { ProviderModelCatalogService } from '../../src/modules/providers/provider-model-catalog.service.js';
import { ProviderUsageService } from '../../src/modules/providers/provider-usage.service.js';
import { ClaudeVerificationService } from '../../src/modules/providers/claude-verification.service.js';
import { CodexVerificationService } from '../../src/modules/providers/codex-verification.service.js';
import { CursorPermissionsService } from '../../src/modules/providers/cursor-permissions.service.js';
import { ProviderConnectionRepository } from '../../src/modules/providers/provider-connection.repository.js';
import { CursorPermissionsRepository } from '../../src/modules/providers/cursor-permissions.repository.js';
import { HostSetupJsonFiles } from '../../src/modules/providers/host-setup-json-files.js';
import { IdeationService } from '../../src/services/ideation-service.js';
import { SettingsQueryService } from '../../src/modules/settings/settings-query.service.js';
import { SettingsCommandService } from '../../src/modules/settings/settings-command.service.js';

let runtime: Awaited<ReturnType<typeof createNestApplication>>;
let directory: string;
let base: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-query-input-'));
  runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: directory,
    dataDir: path.join(directory, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      NODE_ENV: 'test',
      AUTOMAKER_API_KEY: 'fixture',
      ENABLE_REQUEST_LOGGING: 'false',
      ALLOWED_ROOT_DIRECTORY: directory,
      CURSOR_CONFIG_DIR: path.join(directory, 'cursor'),
    },
  });
  await runtime.start();
  base = `http://127.0.0.1:${(runtime.app.getHttpServer().address() as AddressInfo).port}/api/`;
});
afterAll(async () => {
  await runtime?.app.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function request(route: string, method = 'GET', body?: unknown) {
  const response = await fetch(new URL(route, base), {
    method,
    headers: { 'x-api-key': 'fixture', 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

it('keeps refresh true only for a scalar literal, accepting repeated and bracketed query keys', async () => {
  const catalogs = vi
    .spyOn(runtime.app.get(ProviderModelCatalogService), 'models')
    .mockResolvedValue({ success: true } as never);
  const usage = vi
    .spyOn(runtime.app.get(ProviderUsageService), 'codexModelCatalog')
    .mockResolvedValue({
      status: 200,
      body: {
        success: true,
        models: [
          {
            id: 'codex-fixture',
            label: 'Fixture',
            description: '',
            hasThinking: false,
            supportsVision: true,
            tier: 'standard',
            isDefault: true,
          },
        ],
        cachedAt: 0,
      },
    });
  for (const [query, refresh] of [
    ['', false],
    ['?refresh=true', true],
    ['?refresh=TRUE', false],
    ['?refresh=', false],
    ['?refresh=true&refresh=true', false],
    ['?refresh[x]=true', false],
  ] as const) {
    for (const provider of ['copilot', 'opencode'] as const) {
      expect((await request(`setup/${provider}/models${query}`)).status).toBe(200);
      expect(catalogs).toHaveBeenLastCalledWith(provider, refresh);
    }
    expect((await request(`codex/models${query}`)).status).toBe(200);
    expect(usage).toHaveBeenLastCalledWith(refresh);
  }
});

it('retains semantic errors for missing, unknown and duplicate query values before host IO', async () => {
  const connections = vi.spyOn(runtime.app.get(ProviderConnectionRepository), 'target');
  const files = vi.spyOn(runtime.app.get(HostSetupJsonFiles), 'read');
  const permissionLocation = vi.spyOn(runtime.app.get(CursorPermissionsRepository), 'location');
  for (const suffix of ['', '=unknown', '=cli&authMethod=cli']) {
    for (const provider of ['claude', 'codex']) {
      const result = await request(
        `setup/${provider}-verification-target${suffix ? `?authMethod${suffix}` : ''}`
      );
      expect(result).toMatchObject({
        status: 400,
        body: { error: 'An explicit authentication method is required.' },
      });
    }
  }
  for (const query of ['', '?provider=unknown', '?provider=openai&provider=openai'])
    expect(await request(`setup/credential-target${query}`)).toMatchObject({
      status: 400,
      body: { error: 'Unsupported credential provider.' },
    });
  for (const query of ['', '?scope=unknown', '?scope=global&scope=global'])
    expect(await request(`setup/cursor-permissions/target${query}`)).toMatchObject({
      status: 400,
      body: { error: 'Scope must be global or project.' },
    });
  expect(await request('setup/cursor-permissions/target?scope=global&projectPath=')).toMatchObject({
    status: 400,
    body: { error: 'Global scope must not include projectPath.' },
  });
  for (const query of ['?profileId=', '?profileId=unknown', '?profileId=strict&profileId=strict'])
    expect(await request(`setup/cursor-permissions/example${query}`)).toMatchObject({
      status: 400,
      body: { error: 'Unknown Cursor permission profile.' },
    });
  expect(connections).not.toHaveBeenCalled();
  expect(permissionLocation).not.toHaveBeenCalled();
  expect(files).not.toHaveBeenCalled();
  expect(await request('setup/cursor-permissions/example')).toMatchObject({
    status: 200,
    body: { profileId: 'development' },
  });
});

it('keeps project path validation and empty optional project global fallback', async () => {
  const files = vi.spyOn(runtime.app.get(HostSetupJsonFiles), 'read');
  for (const route of ['setup/cursor-config/target', 'setup/cursor-config']) {
    for (const query of [
      '',
      '?projectPath=',
      '?projectPath=relative',
      '?projectPath=a&projectPath=b',
      '?projectPath=%00',
    ])
      expect(await request(`${route}${query}`)).toMatchObject({
        status: 400,
        body: { error: 'An absolute project path is required.' },
      });
  }
  expect(files).not.toHaveBeenCalled();
  expect(await request('setup/cursor-permissions?projectPath=')).toMatchObject({
    status: 200,
    body: { hasProjectConfig: false },
  });
  expect(await request('setup/cursor-permissions?projectPath=a&projectPath=b')).toMatchObject({
    status: 400,
    body: { error: 'An absolute project path is required.' },
  });
});

it('preserves invalid category/provider errors without querying prompts or mutating timeout settings', async () => {
  const prompts = vi.spyOn(runtime.app.get(IdeationService), 'getPromptsByCategory');
  const query = vi.spyOn(runtime.app.get(SettingsQueryService), 'providerModelTimeouts');
  const update = vi.spyOn(runtime.app.get(SettingsCommandService), 'updateProviderModelTimeouts');
  expect(await request('ideation/prompts/unknown-category')).toMatchObject({
    status: 400,
    body: { error: 'Invalid category' },
  });
  expect((await request('settings/model-timeouts/unknown')).status).toBe(400);
  expect((await request('settings/model-timeouts/unknown', 'PUT', {})).status).toBe(400);
  expect(prompts).not.toHaveBeenCalled();
  expect(query).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});

it('retains shutdown admission before invalid semantic query errors', async () => {
  const claude = runtime.app.get(ClaudeVerificationService);
  const codex = runtime.app.get(CodexVerificationService);
  const permissions = runtime.app.get(CursorPermissionsService);
  await Promise.all([
    claude.beforeApplicationShutdown(),
    codex.beforeApplicationShutdown(),
    permissions.beforeApplicationShutdown(),
  ]);
  for (const route of [
    'setup/claude-verification-target?authMethod=bad',
    'setup/codex-verification-target?authMethod=bad',
    'setup/cursor-permissions/target?scope=bad',
    'setup/cursor-permissions/example?profileId=bad',
  ])
    expect((await request(route)).status).toBe(503);
});

it('retains passwordless terminal auth for arbitrary passwords and array/no-body inputs', async () => {
  for (const body of [
    undefined,
    [],
    {},
    { password: 4 },
    { password: null },
    { password: [], ignored: true },
  ])
    expect(await request('terminal/auth', 'POST', body)).toEqual({
      status: 200,
      body: { success: true, data: { authenticated: true, passwordRequired: false } },
    });
  const protectedRuntime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: directory,
    dataDir: path.join(directory, 'protected'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      NODE_ENV: 'test',
      AUTOMAKER_API_KEY: 'fixture',
      TERMINAL_PASSWORD: 'terminal-fixture',
      ENABLE_REQUEST_LOGGING: 'false',
    },
  });
  try {
    await protectedRuntime.start();
    const { port } = protectedRuntime.app.getHttpServer().address() as AddressInfo;
    for (const body of [[], {}, { password: 4 }, { password: null }]) {
      const response = await fetch(`http://127.0.0.1:${port}/api/terminal/auth`, {
        method: 'POST',
        headers: { 'x-api-key': 'fixture', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ success: false, error: 'Invalid password' });
    }
  } finally {
    await protectedRuntime.app.close();
  }
});
