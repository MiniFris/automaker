import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { MockProvider } from '../helpers/mock-provider.js';
import { SetupStatusRuntime } from '../../src/core/platform/setup-status.runtime.js';
import { ClaudeVerificationRuntime } from '../../src/core/platform/claude-verification.runtime.js';
import { CodexVerificationRuntime } from '../../src/core/platform/codex-verification.runtime.js';
import { ApplicationCredentialsService } from '../../src/modules/providers/application-credentials.service.js';
import { HostSetupStatusService } from '../../src/modules/providers/host-setup-status.service.js';
import { ProviderSetupStatusService } from '../../src/modules/providers/provider-setup-status.service.js';
import { ProviderModelCatalogService } from '../../src/modules/providers/provider-model-catalog.service.js';
import { ProviderInstallGuidanceService } from '../../src/modules/providers/provider-install-guidance.service.js';
import { ProviderConnectionCommandService } from '../../src/modules/providers/provider-connection-command.service.js';
import { SetupCredentialsService } from '../../src/modules/providers/setup-credentials.service.js';
import { ClaudeVerificationService } from '../../src/modules/providers/claude-verification.service.js';
import { CodexVerificationService } from '../../src/modules/providers/codex-verification.service.js';
import { GithubAuthenticationService } from '../../src/modules/providers/github-authentication.service.js';
import { CursorModelConfigService } from '../../src/modules/providers/cursor-model-config.service.js';
import { CursorPermissionsService } from '../../src/modules/providers/cursor-permissions.service.js';
import { CursorPermissionsRepository } from '../../src/modules/providers/cursor-permissions.repository.js';

class SetupProvider extends MockProvider {
  async fetchAuthenticatedProviders() {
    return [{ id: 'fixture', name: 'Fixture', authenticated: false }];
  }
}
let runtime: Awaited<ReturnType<typeof createNestApplication>>;
let root: string, project: string, base: string;
const requests = new Map<string, { route: string; method: string; body?: unknown }>();
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'setup-response-'));
  project = path.join(root, 'project');
  await fs.mkdir(project);
  runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: project,
    dataDir: path.join(root, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: ['claude', 'codex', 'cursor', 'opencode', 'gemini', 'copilot'].map(
      (name) => ({ name, create: () => new SetupProvider(name) })
    ),
    environment: {
      NODE_ENV: 'test',
      HOME: root,
      CURSOR_CONFIG_DIR: path.join(root, 'cursor'),
      ALLOWED_ROOT_DIRECTORY: root,
    },
  });
  const status = runtime.app.get(SetupStatusRuntime);
  vi.spyOn(status, 'platformInfo').mockReturnValue({
    platform: 'linux',
    arch: 'x64',
    homeDir: root,
  });
  vi.spyOn(status, 'detect').mockImplementation(async (name) => ({
    installed: true,
    version: `${name} version 1.0`,
    path: `/fixture/bin/${name}`,
    method: 'path',
  }));
  vi.spyOn(status, 'profileHint').mockResolvedValue(false);
  vi.spyOn(status, 'claudeIndicators').mockResolvedValue({
    hasCredentialsFile: false,
    hasSettingsFile: false,
    hasStatsCacheWithActivity: false,
    hasProjectsSessions: false,
  });
  vi.spyOn(status, 'codexIndicators').mockResolvedValue({
    hasApiKey: false,
    hasAuthFile: false,
    hasOAuthToken: false,
  });
  vi.spyOn(status, 'cursorCredentials').mockResolvedValue(false);
  vi.spyOn(status, 'githubAuthentication').mockResolvedValue({
    authenticated: true,
    user: 'fixture-user',
  });
  vi.spyOn(runtime.app.get(ApplicationCredentialsService), 'presence').mockResolvedValue({
    hasAnthropicKey: false,
    hasGoogleKey: false,
    hasOpenaiKey: false,
    hasEnvOpenaiKey: false,
    hasStoredAnthropicKey: false,
    hasEnvAnthropicKey: false,
    hasStoredAnthropicOAuthToken: false,
  });
  vi.spyOn(runtime.app.get(ApplicationCredentialsService), 'change').mockResolvedValue(undefined);
  vi.spyOn(runtime.app.get(ClaudeVerificationRuntime), 'run').mockResolvedValue('authentication');
  vi.spyOn(runtime.app.get(CodexVerificationRuntime), 'run').mockResolvedValue('authentication');
  await runtime.start();
  base = `http://127.0.0.1:${runtime.app.getHttpServer().address().port}/api/setup/`;
});
// Keep bootstrap port fakes alive; restore only per-test application overrides below.
const overrides: Array<ReturnType<typeof vi.spyOn>> = [];
afterEach(() => {
  for (const spy of overrides.splice(0)) spy.mockRestore();
});
afterAll(async () => {
  vi.restoreAllMocks();
  await runtime?.app.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});
async function call(route: string, method = 'GET', body?: unknown, record = true) {
  const response = await fetch(base + route, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  const value = await response.json();
  if (record) requests.set(method + ' ' + route.split('?')[0], { route, method, body });
  return { status: response.status, body: value };
}
async function valid(route: string, method = 'GET', body?: unknown) {
  const response = await call(route, method, body);
  expect(response.status, `${method} ${route}: ${JSON.stringify(response.body)}`).toBe(200);
  return response.body;
}
const query = (values: Record<string, string>) => new URLSearchParams(values).toString();

it('serves all50 native Setup handlers using real application services and explicit offline runtime ports', async () => {
  for (const name of ['claude', 'codex', 'opencode', 'gemini', 'copilot', 'cursor'])
    await valid(`${name}-status`);
  await valid('gh-status');
  expect(await valid('install-claude', 'POST', {})).toMatchObject({
    success: false,
    requiresManualInstall: true,
    installationPerformed: false,
  });
  expect(await valid('install-codex', 'POST', {})).toMatchObject({
    success: true,
    installationPerformed: false,
  });
  for (const provider of ['claude', 'codex', 'opencode', 'gemini', 'copilot', 'cursor']) {
    const { target } = await valid('connection-target?' + query({ provider }));
    await valid(`deauth-${provider}`, 'POST', { confirmed: true, target });
    await valid(`auth-${provider}`, 'POST', { confirmed: true, target });
  }
  const credential = await valid('credential-target?provider=anthropic');
  await valid('store-api-key', 'POST', {
    confirmed: true,
    target: credential.target,
    apiKey: 'sk-ant-offline-fixture-not-a-real-key',
  });
  await valid('delete-api-key', 'POST', { confirmed: true, target: credential.target });
  await valid('api-keys');
  await valid('platform');
  const claude = await valid('claude-verification-target?authMethod=api_key');
  expect(
    await valid('verify-claude-auth', 'POST', {
      confirmed: true,
      target: claude.target,
      apiKey: 'sk-ant-offline-fixture-not-a-real-key',
    })
  ).toMatchObject({ success: true, authenticated: false, verification: 'unverified' });
  const codex = await valid('codex-verification-target?authMethod=api_key');
  expect(
    await valid('verify-codex-auth', 'POST', {
      confirmed: true,
      target: codex.target,
      apiKey: 'sk-offline-fixture-not-a-real-key',
    })
  ).toMatchObject({ success: true, authenticated: false, verification: 'unverified' });
  const github = await valid('github-authentication-target');
  await valid('verify-github-auth', 'POST', { confirmed: true, target: github.target });
  for (const provider of ['copilot', 'opencode']) {
    const models = await valid(`${provider}/models`);
    expect(models.models).toHaveLength(1);
    await valid(`${provider}/models/refresh`, 'POST', {});
    await valid(`${provider}/cache/clear`, 'POST', {});
  }
  await valid('opencode/providers');
  const modelQuery = query({ projectPath: project });
  const config = await valid('cursor-config/target?' + modelQuery);
  await valid('cursor-config?' + modelQuery);
  await valid('cursor-config/default-model', 'POST', {
    confirmed: true,
    target: config.target,
    model: 'cursor-auto',
  });
  await valid('cursor-config/models', 'POST', {
    confirmed: true,
    target: config.target,
    models: ['cursor-auto'],
  });
  const permissions = await valid(
    'cursor-permissions/target?' + query({ scope: 'project', projectPath: project })
  );
  await valid('cursor-permissions?' + modelQuery);
  await valid('cursor-permissions/profile', 'POST', {
    confirmed: true,
    target: permissions.target,
    profileId: 'development',
  });
  await valid('cursor-permissions/custom', 'POST', {
    confirmed: true,
    target: permissions.target,
    permissions: { allow: ['Read(**/*)'], deny: [] },
  });
  await valid('cursor-permissions', 'DELETE', { confirmed: true, target: permissions.target });
  await valid('cursor-permissions/example?profileId=development');
  expect(requests.size).toBe(50);
});

const handlers: Record<string, [any, string]> = {
  'claude-status': [HostSetupStatusService, 'claude'],
  'gh-status': [HostSetupStatusService, 'github'],
  'codex-status': [HostSetupStatusService, 'installationStatus'],
  'opencode-status': [HostSetupStatusService, 'installationStatus'],
  'cursor-status': [ProviderSetupStatusService, 'status'],
  'gemini-status': [ProviderSetupStatusService, 'status'],
  'copilot-status': [ProviderSetupStatusService, 'status'],
  'install-claude': [ProviderInstallGuidanceService, 'instructions'],
  'install-codex': [ProviderInstallGuidanceService, 'instructions'],
  'connection-target': [ProviderConnectionCommandService, 'target'],
  'credential-target': [SetupCredentialsService, 'target'],
  'store-api-key': [SetupCredentialsService, 'change'],
  'delete-api-key': [SetupCredentialsService, 'change'],
  'api-keys': [HostSetupStatusService, 'apiKeys'],
  platform: [HostSetupStatusService, 'platform'],
  'claude-verification-target': [ClaudeVerificationService, 'target'],
  'verify-claude-auth': [ClaudeVerificationService, 'verify'],
  'codex-verification-target': [CodexVerificationService, 'target'],
  'verify-codex-auth': [CodexVerificationService, 'verify'],
  'github-authentication-target': [GithubAuthenticationService, 'target'],
  'verify-github-auth': [GithubAuthenticationService, 'verify'],
  'copilot/models': [ProviderModelCatalogService, 'models'],
  'copilot/models/refresh': [ProviderModelCatalogService, 'models'],
  'copilot/cache/clear': [ProviderModelCatalogService, 'clear'],
  'opencode/models': [ProviderModelCatalogService, 'models'],
  'opencode/models/refresh': [ProviderModelCatalogService, 'models'],
  'opencode/providers': [ProviderModelCatalogService, 'authenticatedProviders'],
  'opencode/cache/clear': [ProviderModelCatalogService, 'clear'],
  'cursor-config/target': [CursorModelConfigService, 'target'],
  'cursor-config': [CursorModelConfigService, 'read'],
  'cursor-config/default-model': [CursorModelConfigService, 'setDefaultModel'],
  'cursor-config/models': [CursorModelConfigService, 'setEnabledModels'],
  'cursor-permissions/target': [CursorPermissionsService, 'target'],
  'GET cursor-permissions': [CursorPermissionsService, 'read'],
  'cursor-permissions/profile': [CursorPermissionsService, 'apply'],
  'cursor-permissions/custom': [CursorPermissionsService, 'custom'],
  'DELETE cursor-permissions': [CursorPermissionsService, 'delete'],
  'cursor-permissions/example': [CursorPermissionsService, 'example'],
};
for (const provider of ['claude', 'codex', 'cursor', 'opencode', 'gemini', 'copilot']) {
  handlers[`auth-${provider}`] = [ProviderConnectionCommandService, 'reconnect'];
  handlers[`deauth-${provider}`] = [ProviderConnectionCommandService, 'disconnect'];
}
it.each(Object.entries(handlers))(
  'rejects malformed application output at %s',
  async (key, [owner, handler]) => {
    const methodPrefix = key.startsWith('GET ')
      ? 'GET'
      : key.startsWith('DELETE ')
        ? 'DELETE'
        : undefined;
    const route = methodPrefix ? key.slice(methodPrefix.length + 1) : key;
    const fixture = [...requests.values()].find(
      (entry) =>
        entry.route.split('?')[0] === route && (!methodPrefix || entry.method === methodPrefix)
    );
    expect(fixture, `Missing successful fixture for ${key}`).toBeDefined();
    overrides.push(
      vi
        .spyOn(runtime.app.get(owner) as any, handler)
        .mockImplementation(() => ({ success: true, privateFixture: 'must-not-leak' }))
    );
    const response = await call(fixture!.route, fixture!.method, fixture!.body, false);
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ success: false, error: 'Internal server error.' });
    expect(JSON.stringify(response.body)).not.toContain('must-not-leak');
  }
);

it('keeps historical permission read values opaque at the transport boundary', async () => {
  const value = { allow: [1, null], deny: [], extra: { kept: true } };
  overrides.push(
    vi
      .spyOn(runtime.app.get(CursorPermissionsRepository), 'read')
      .mockResolvedValue({ permissions: value })
  );
  const response = await call('cursor-permissions', 'GET', undefined, false);
  expect(response.status).toBe(200);
  expect(response.body.effectivePermissions).toEqual(value);
});
it('retains confirmation/target admission errors before mutation and verification ports', async () => {
  const credentials =
    overrides[overrides.push(vi.spyOn(runtime.app.get(SetupCredentialsService), 'change')) - 1];
  const verification =
    overrides[overrides.push(vi.spyOn(runtime.app.get(ClaudeVerificationService), 'verify')) - 1];
  expect((await call('store-api-key', 'POST', { confirmed: false }, false)).status).toBe(400);
  expect((await call('verify-claude-auth', 'POST', { confirmed: false }, false)).status).toBe(400);
  expect(credentials).not.toHaveBeenCalled();
  expect(verification).not.toHaveBeenCalled();
});
