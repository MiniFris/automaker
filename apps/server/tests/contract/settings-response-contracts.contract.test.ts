import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { SettingsQueryService } from '../../src/modules/settings/settings-query.service.js';
import { SettingsCommandService } from '../../src/modules/settings/settings-command.service.js';
import { DirectSettingsCommandService } from '../../src/modules/settings/direct-settings-command.service.js';
import { DEFAULT_CREDENTIALS } from '@automaker/types';
import {
  SettingsStatusResponseSchema,
  SettingsDocumentResponseSchema,
  SettingsCredentialsResponseSchema,
  SettingsAgentsResponseSchema,
  SettingsTimeoutsResponseSchema,
  SettingsDirectResponseSchema,
  SettingsMigrationResponseSchema,
  SettingsDirectModelsResponseSchema,
  SettingsDirectTestResponseSchema,
  SettingsRetiredCredentialsResponseSchema,
} from '@automaker/contracts/domains/settings';

const nativeFetch = globalThis.fetch;
let runtime: Awaited<ReturnType<typeof createNestApplication>>;
let root: string, project: string, base: string;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-responses-'));
  project = path.join(root, 'project');
  await fs.mkdir(project);
  runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: project,
    dataDir: path.join(root, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      NODE_ENV: 'test',
      HOME: root,
      ALLOWED_ROOT_DIRECTORY: root,
      AUTOMAKER_API_KEY: 'settings-response-fixture',
    },
  });
  await runtime.start();
  base = `http://127.0.0.1:${runtime.app.getHttpServer().address().port}/api/settings/`;
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await runtime?.app.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});
async function call(
  route: string,
  method = 'GET',
  body?: unknown,
  apiKey = 'settings-response-fixture'
) {
  const response = await nativeFetch(base + route, {
    method,
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, body: await response.json() };
}

it('validates all main Settings operations using owned files and explicit offline transport/credential fixtures', async () => {
  vi.spyOn(runtime.app.get(SettingsService), 'getCredentials').mockImplementation(async () =>
    structuredClone(DEFAULT_CREDENTIALS)
  );
  const status = await call('status');
  expect(status.status).toBe(200);
  expect(SettingsStatusResponseSchema.parse(status.body).dataDir).toBe(path.join(root, 'data'));
  expect(
    SettingsCredentialsResponseSchema.parse((await call('credentials')).body).credentials.anthropic
  ).toEqual({ configured: false, masked: '' });
  const extension = { nested: [{ retained: true }, null], historical: null };
  expect(
    SettingsDocumentResponseSchema.parse(
      (await call('global', 'PUT', { legacyExtension: extension, theme: 'future-theme' })).body
    ).settings
  ).toMatchObject({ legacyExtension: extension, theme: 'future-theme' });
  expect(
    SettingsDocumentResponseSchema.parse((await call('global')).body).settings.legacyExtension
  ).toEqual(extension);
  expect(
    SettingsDocumentResponseSchema.parse(
      (
        await call('project', 'PUT', {
          projectPath: project,
          updates: { legacyExtension: extension, currentWorktree: null },
        })
      ).body
    ).settings
  ).toMatchObject({ legacyExtension: extension, currentWorktree: null });
  expect(
    SettingsDocumentResponseSchema.parse(
      (await call('project', 'POST', { projectPath: project })).body
    ).settings.legacyExtension
  ).toEqual(extension);
  const agentsDir = path.join(project, '.claude/agents');
  await fs.mkdir(agentsDir, { recursive: true });
  await fs.writeFile(
    path.join(agentsDir, 'fixture.md'),
    '---\ndescription: Fixture agent\nmodel: sonnet\ntools: Read, Grep\n---\nFixture prompt'
  );
  expect(
    SettingsAgentsResponseSchema.parse(
      (await call('agents/discover', 'POST', { projectPath: project, sources: ['project'] })).body
    ).agents
  ).toMatchObject([{ name: 'fixture', definition: { tools: ['Read', 'Grep'] } }]);
  const timeouts = { requestTimeoutMs: 1200 };
  expect(
    SettingsTimeoutsResponseSchema.parse((await call('model-timeouts', 'PUT', { timeouts })).body)
      .timeouts
  ).toEqual(timeouts);
  expect(
    SettingsTimeoutsResponseSchema.parse((await call('model-timeouts')).body).timeouts
  ).toEqual(timeouts);
  expect(
    SettingsTimeoutsResponseSchema.parse(
      (await call('model-timeouts/claude', 'PUT', { timeouts })).body
    ).timeouts
  ).toEqual(timeouts);
  expect(
    SettingsTimeoutsResponseSchema.parse((await call('model-timeouts/claude')).body).timeouts
      .requestTimeoutMs
  ).toBe(1200);
  expect(
    SettingsMigrationResponseSchema.parse((await call('migrate', 'POST', { data: {} })).body)
      .success
  ).toBe(true);
  const failedMigration = await call('migrate', 'POST', { data: { 'automaker-storage': '{' } });
  expect(failedMigration.status).toBe(200);
  expect(SettingsMigrationResponseSchema.parse(failedMigration.body)).toMatchObject({
    success: false,
    errors: expect.any(Array),
  });
  const endpoint = {
    id: 'offline',
    name: 'Offline fixture',
    enabled: true,
    baseUrl: 'https://offline.invalid/v1/',
    protocol: 'chat-completions',
    auth: { type: 'none' },
    models: [
      {
        id: 'Vendor/Model:fixture',
        displayName: 'Fixture',
        capabilities: { tools: false, streaming: false, vision: false },
      },
    ],
  };
  expect(
    SettingsDirectResponseSchema.parse(
      (await call('openai-compatible/endpoint', 'PUT', { endpoint })).body
    ).endpoints
  ).toMatchObject([{ endpoint, keyConfigured: true }]);
  expect(
    SettingsDirectResponseSchema.parse((await call('openai-compatible')).body).endpoints
  ).toHaveLength(1);
  expect(
    SettingsDirectResponseSchema.parse(
      (
        await call('openai-compatible/agent', 'PUT', {
          access: 'read-only',
          limits: { maxToolCalls: 10 },
        })
      ).body
    ).agentSettings
  ).toMatchObject({ access: 'read-only', limits: { maxToolCalls: 10 } });
  // The actual command/decoder runs; its external transport is a strict local fake.
  const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const target = new URL(String(url));
    expect(target.origin).toBe('https://offline.invalid');
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
    if (target.pathname === '/v1/models')
      return Response.json({ data: [{ id: 'Vendor/Model:fixture' }] });
    expect(target.pathname).toBe('/v1/chat/completions');
    return Response.json({
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
    });
  });
  expect(
    SettingsDirectModelsResponseSchema.parse(
      (await call('openai-compatible/models', 'POST', { providerId: 'offline' })).body
    ).models
  ).toEqual(['Vendor/Model:fixture']);
  expect(
    SettingsDirectTestResponseSchema.parse(
      (
        await call('openai-compatible/test', 'POST', {
          providerId: 'offline',
          modelId: 'Vendor/Model:fixture',
          tools: false,
        })
      ).body
    )
  ).toEqual({ success: true, verified: true, tools: false });
  expect(transport).toHaveBeenCalledTimes(2);
  expect(
    SettingsDirectResponseSchema.parse(
      (await call('openai-compatible/remove', 'POST', { providerId: 'offline' })).body
    ).endpoints
  ).toEqual([]);
  const retired = await call('credentials', 'PUT', {});
  expect(retired.status).toBe(410);
  expect(SettingsRetiredCredentialsResponseSchema.parse(retired.body)).toMatchObject({
    success: false,
    errorCode: 'CREDENTIAL_WRITE_RETIRED',
  });
});

const bad = [
  ['GET', 'status', SettingsQueryService, 'status', { success: true, hasGlobalSettings: 'wrong' }],
  ['GET', 'global', SettingsQueryService, 'global', { success: true, settings: null }],
  ['GET', 'credentials', SettingsQueryService, 'credentials', { success: true, credentials: {} }],
  ['POST', 'project', SettingsQueryService, 'project', { success: true, settings: [] }],
  [
    'POST',
    'agents/discover',
    SettingsQueryService,
    'discoverAgents',
    { success: true, agents: [{}] },
  ],
  [
    'GET',
    'model-timeouts',
    SettingsQueryService,
    'modelTimeouts',
    { success: true, timeouts: { agentTimeoutMs: 'wrong' } },
  ],
  [
    'GET',
    'model-timeouts/claude',
    SettingsQueryService,
    'providerModelTimeouts',
    { success: true, timeouts: [] },
  ],
  [
    'GET',
    'openai-compatible',
    SettingsQueryService,
    'openAICompatible',
    { success: true, endpoints: [{}], agentSettings: {} },
  ],
  ['PUT', 'global', SettingsCommandService, 'updateGlobal', { success: true, settings: null }],
  ['PUT', 'project', SettingsCommandService, 'updateProject', { success: true, settings: 'wrong' }],
  ['POST', 'migrate', SettingsCommandService, 'migrate', { success: false, errors: 'wrong' }],
  [
    'PUT',
    'model-timeouts',
    SettingsCommandService,
    'updateModelTimeouts',
    { success: true, timeouts: 'wrong' },
  ],
  [
    'PUT',
    'model-timeouts/claude',
    SettingsCommandService,
    'updateProviderModelTimeouts',
    { success: true, timeouts: { agentTimeoutMs: null } },
  ],
  [
    'PUT',
    'openai-compatible/endpoint',
    DirectSettingsCommandService,
    'updateEndpoint',
    { success: true, endpoints: 'wrong', agentSettings: {} },
  ],
  [
    'POST',
    'openai-compatible/remove',
    DirectSettingsCommandService,
    'remove',
    { success: true, endpoints: [], agentSettings: 'wrong' },
  ],
  [
    'PUT',
    'openai-compatible/agent',
    DirectSettingsCommandService,
    'updateAgent',
    { success: true, endpoints: [{}], agentSettings: {} },
  ],
  [
    'POST',
    'openai-compatible/models',
    DirectSettingsCommandService,
    'discoverModels',
    { success: true, models: [42] },
  ],
  [
    'POST',
    'openai-compatible/test',
    DirectSettingsCommandService,
    'testConnection',
    { success: true, verified: 'wrong', tools: false },
  ],
] as const;
function requestBody(route: string) {
  if (route === 'project') return { projectPath: project, updates: {} };
  if (route === 'migrate') return { data: {} };
  if (route === 'model-timeouts' || route.startsWith('model-timeouts/')) return { timeouts: {} };
  return {};
}
it.each(bad)(
  'rejects malformed application payload for %s %s',
  async (method, route, owner, handler, output) => {
    vi.spyOn(runtime.app.get(owner) as any, handler).mockResolvedValue({
      ...output,
      privateFixture: 'must-not-leak',
    });
    const body =
      route === 'project' && method === 'POST' ? { projectPath: project } : requestBody(route);
    const response = await call(route, method, method === 'GET' ? undefined : body);
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ success: false, error: 'Internal server error.' });
    expect(JSON.stringify(response.body)).not.toContain('must-not-leak');
  }
);

it('preserves extension/null values throughout direct endpoint and discovered-agent responses', async () => {
  const output = {
    success: true,
    endpoints: [
      {
        keyConfigured: false,
        statusExtension: null,
        endpoint: {
          id: 'legacy',
          name: 'Legacy',
          enabled: false,
          baseUrl: 'historical base value',
          protocol: 'future-protocol',
          auth: { type: 'future-auth', variableName: null, extraAuth: [1] },
          timeoutMs: null,
          models: [
            {
              id: 'Model/Exact:Tag',
              displayName: 'Legacy',
              capabilities: { tools: true, streaming: false, vision: null, extraCapability: true },
              contextWindow: null,
              extraModel: { kept: true },
            },
          ],
          extraEndpoint: ['kept'],
        },
      },
    ],
    agentSettings: {
      access: 'future-access',
      shell: null,
      limits: null,
      extraAgent: { kept: true },
    },
    extraEnvelope: null,
  };
  vi.spyOn(runtime.app.get(SettingsQueryService), 'openAICompatible').mockResolvedValue(
    output as never
  );
  const response = await call('openai-compatible');
  expect(response.status).toBe(200);
  expect(SettingsDirectResponseSchema.parse(response.body)).toEqual(output);
});

it('preserves retired credential authentication and invalid input semantics', async () => {
  expect((await call('credentials', 'PUT', {}, 'invalid-fixture-key')).status).toBe(403);
  expect((await call('project', 'POST', { projectPath: 42 })).status).toBe(400);
  expect((await call('model-timeouts/unsupported')).status).toBe(400);
});
