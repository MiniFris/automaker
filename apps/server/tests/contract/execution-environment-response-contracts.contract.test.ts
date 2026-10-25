import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { ExecutionEnvironmentSettingsService } from '../../src/modules/settings/execution-environment-settings.service.js';
import { featureRunKey } from '../../src/services/execution-environment/ssh-feature.js';
import * as diagnostics from '../../src/services/execution-environment/docker-diagnostics.js';
import {
  ExecutionEnvironmentSettingsResponseSchema,
  ExecutionEnvironmentFeatureResponseSchema,
  ExecutionDockerDiagnosticResponseSchema,
  ExecutionDockerPreparationResponseSchema,
  ExecutionProviderStatusResponseSchema,
  ExecutionSSHScanResponseSchema,
  ExecutionSSHDiagnosticResponseSchema,
} from '@automaker/contracts/domains/execution-environment-responses';

vi.mock(
  '../../src/services/execution-environment/docker-diagnostics.js',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../../src/services/execution-environment/docker-diagnostics.js')
    >()),
    diagnoseDockerConnection: vi.fn(),
  })
);
let runtime: Awaited<ReturnType<typeof createNestApplication>>;
let root: string, project: string, base: string;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'environment-response-'));
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
      AUTOMAKER_API_KEY: 'environment-response-fixture',
    },
  });
  await runtime.start();
  base = `http://127.0.0.1:${runtime.app.getHttpServer().address().port}/api/settings/execution-environments/`;
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await runtime?.app.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});
async function call(route: string, body: unknown = {}, method = 'POST') {
  const response = await fetch(base + route, {
    method,
    headers: { 'content-type': 'application/json', 'x-api-key': 'environment-response-fixture' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, body: await response.json() };
}
const key = { algorithm: 'ssh-ed25519', fingerprint: 'SHA256:' + 'A'.repeat(43) };
const dockerDiagnostic = {
  status: 'unreachable',
  checkedAt: 'historical timestamp',
  scope: 'connection-only',
  containerLifecycle: 'not-tested',
  projectStorage: 'not-tested',
  platform: 'linux',
  serverContainerized: false,
  message: 'Offline fixture',
  remediation: ['Fixture'],
  documentation: [{ label: 'Fixture', url: 'historical link' }],
  extra: null,
};

it('validates all20 actual handlers with offline overrides at Docker/SSH/provider producer ports', async () => {
  const service = runtime.app.get(ExecutionEnvironmentSettingsService),
    ports = service as any;
  const sshProfile = {
    id: 'ssh',
    name: 'SSH fixture',
    type: 'ssh',
    host: 'offline.invalid',
    port: 22,
    username: 'fixture',
    basePath: '/remote',
    credentialId: 'fixture-key',
  };
  const config = {
    default: { mode: 'local' },
    profiles: [{ id: 'docker', name: 'Docker fixture', type: 'docker' }, sshProfile],
  };
  const hostStatus = vi.spyOn(ports.ssh, 'status').mockResolvedValue({
    trustedHost: key,
    hasPrivateKey: false,
    agentAvailable: false,
    project: {
      remotePath: '/remote/project',
      pendingOperations: 0,
      preparing: true,
      stagingPath: null,
      extra: { kept: true },
    },
  });
  const probe = vi.spyOn(ports.docker, 'probe').mockResolvedValue({
    connection: 'available',
    containerLifecycle: 'verified',
    projectStorage: 'verified',
    checkedAt: 'historical timestamp',
    message: 'Offline preparation',
    containerId: 'fixture',
    extra: null,
  });
  const providerStatus = {
    provider: 'claude',
    targetId: 'a'.repeat(64),
    environment: 'ssh',
    cwd: '/remote/project',
    packageVersion: 'fixture',
    installed: false,
    root: '/remote/project',
    hasStoredKey: false,
    credentialSource: 'not-detected',
    authentication: 'not-detected',
    extra: { kept: true },
  };
  const setup = vi.spyOn(ports.providers, 'run').mockResolvedValue(providerStatus);
  const scan = vi.spyOn(ports.ssh.state, 'scan').mockResolvedValue(key);
  const confirm = vi.spyOn(ports.ssh.state, 'confirm').mockResolvedValue(undefined);
  const removeKey = vi.spyOn(ports.ssh.state, 'removeKey').mockResolvedValue(undefined);
  const diagnose = vi.spyOn(ports.ssh, 'diagnose').mockResolvedValue({
    status: 'trust-required',
    checkedAt: 'historical timestamp',
    message: 'Confirm fixture trust',
    hostKey: key,
    worker: 'not-tested',
    project: 'not-tested',
    remotePath: null,
    extra: [1],
  });
  const prepareWorker = vi.spyOn(ports.ssh, 'prepareWorker').mockResolvedValue(undefined);
  const prepareProject = vi.spyOn(ports.ssh, 'prepareProject').mockResolvedValue(undefined);
  const trust = vi.spyOn(ports.ssh.state, 'trust').mockResolvedValue(key);
  const projectBinding = vi.spyOn(ports.ssh.state, 'project').mockResolvedValue({
    version: 1,
    ready: true,
    owner: 'fixture',
    profile: sshProfile,
    projectPath: project,
    fingerprint: key.fingerprint,
    identity: 'fixture',
    remotePath: '/remote/project',
    workerPath: '/remote/worker',
    workerHash: 'fixture',
    cancelPath: '/remote/cancel',
    cancelHash: 'fixture',
    jobsDirectory: '/remote/jobs',
  });
  const recover = vi.spyOn(ports.ssh, 'recover').mockResolvedValue(undefined);
  vi.mocked(diagnostics.diagnoseDockerConnection).mockResolvedValue(dockerDiagnostic as never);
  async function settings(route: string, body: unknown = {}, method = 'POST') {
    const result = await call(route, body, method);
    expect(result.status, `${route}: ${JSON.stringify(result.body)}`).toBe(200);
    return ExecutionEnvironmentSettingsResponseSchema.parse(result.body);
  }
  expect((await settings('inspect')).projectOverride).toBeNull();
  const feature = await call('feature/inspect', { projectPath: project, featureId: 'feature' });
  expect(feature.status).toBe(200);
  expect(ExecutionEnvironmentFeatureResponseSchema.parse(feature.body).binding).toBeNull();
  await settings('global', { settings: config }, 'PUT');
  await settings(
    'project',
    { projectPath: project, selection: { mode: 'profile', profileId: 'docker' } },
    'PUT'
  );
  for (const kind of ['local', 'auto']) {
    await settings('project', { projectPath: project, selection: { mode: kind } }, 'PUT');
    await settings(`${kind}/confirm`, { projectPath: project, accepted: true, warningVersion: 1 });
    await settings(`${kind}/revoke`, { projectPath: project });
  }
  await settings(
    'project',
    { projectPath: project, selection: { mode: 'profile', profileId: 'docker' } },
    'PUT'
  );
  const docker = await call('docker/check', { profileId: 'docker' });
  expect(docker.status).toBe(200);
  expect(ExecutionDockerDiagnosticResponseSchema.parse(docker.body).diagnostic).toEqual(
    dockerDiagnostic
  );
  const prepared = await call('docker/prepare', {
    projectPath: project,
    profileId: 'docker',
    accepted: true,
  });
  expect(prepared.status).toBe(200);
  expect(
    ExecutionDockerPreparationResponseSchema.parse(prepared.body).preparation.containerId
  ).toBe('fixture');
  for (const operation of ['inspect', 'install', 'key']) {
    const response = await call(`providers/${operation}`, {
      projectPath: project,
      provider: 'claude',
      ...(operation === 'inspect' ? {} : { targetId: 'a'.repeat(64), accepted: true }),
      ...(operation === 'key' ? { clear: true } : {}),
    });
    expect(response.status).toBe(200);
    expect(ExecutionProviderStatusResponseSchema.parse(response.body).status).toEqual(
      providerStatus
    );
  }
  const scanned = await call('ssh/scan', { profileId: 'ssh' });
  expect(scanned.status).toBe(200);
  expect(ExecutionSSHScanResponseSchema.parse(scanned.body).hostKey).toEqual(key);
  await settings('ssh/trust', { profileId: 'ssh', fingerprint: key.fingerprint, accepted: true });
  await settings('ssh/key', { profileId: 'ssh', clear: true });
  const checked = await call('ssh/check', { profileId: 'ssh', projectPath: project });
  expect(checked.status).toBe(200);
  expect(ExecutionSSHDiagnosticResponseSchema.parse(checked.body).diagnostic.status).toBe(
    'trust-required'
  );
  await settings('ssh/prepare', { profileId: 'ssh', accepted: true });
  await settings(
    'project',
    { projectPath: project, selection: { mode: 'profile', profileId: 'ssh' } },
    'PUT'
  );
  await settings('ssh/project', {
    profileId: 'ssh',
    projectPath: project,
    accepted: true,
    source: { method: 'existing', remotePath: '/remote/project' },
  });
  expect(
    (await settings('ssh/recover', { profileId: 'ssh', projectPath: project, accepted: true })).ssh
      ?.project?.stagingPath
  ).toBeNull();
  for (const producer of [
    hostStatus,
    probe,
    setup,
    scan,
    confirm,
    removeKey,
    diagnose,
    prepareWorker,
    prepareProject,
    trust,
    projectBinding,
    recover,
  ])
    expect(producer).toHaveBeenCalled();
});

it('preserves opaque historical binding extras through the actual peek reader', async () => {
  const id = createHash('sha256').update(featureRunKey(project, 'historical')).digest('hex');
  const binding = {
    version: 1,
    id,
    projectPath: project,
    cwd: false,
    createdAt: 123,
    selection: { mode: 77 },
    docker: 'historical opaque value',
    extra: { preserved: [null] },
  };
  const directory = path.join(root, 'data/execution-environments/bindings');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, id + '.json'), JSON.stringify({ binding }));
  const service = runtime.app.get(ExecutionEnvironmentSettingsService) as any;
  // The current project selection is SSH; metadata lookup must not connect while producing its DTO.
  const response = await call('feature/inspect', { projectPath: project, featureId: 'historical' });
  expect(response.status).toBe(200);
  expect(ExecutionEnvironmentFeatureResponseSchema.parse(response.body).binding).toEqual(binding);
});

const routes = [
  ['POST', 'inspect', 'inspect', 'settings'],
  ['POST', 'feature/inspect', 'inspectFeature', 'binding'],
  ['PUT', 'global', 'updateGlobal', 'settings'],
  ['PUT', 'project', 'updateProject', 'settings'],
  ['POST', 'local/confirm', 'updateConsent', 'settings'],
  ['POST', 'local/revoke', 'updateConsent', 'settings'],
  ['POST', 'auto/confirm', 'updateConsent', 'settings'],
  ['POST', 'auto/revoke', 'updateConsent', 'settings'],
  ['POST', 'docker/check', 'checkDocker', 'diagnostic'],
  ['POST', 'docker/prepare', 'prepareDocker', 'preparation'],
  ['POST', 'providers/inspect', 'providerOperation', 'status'],
  ['POST', 'providers/install', 'providerOperation', 'status'],
  ['POST', 'providers/key', 'providerOperation', 'status'],
  ['POST', 'ssh/scan', 'scanSSH', 'hostKey'],
  ['POST', 'ssh/trust', 'trustSSH', 'settings'],
  ['POST', 'ssh/key', 'updateSSHKey', 'settings'],
  ['POST', 'ssh/check', 'checkSSH', 'diagnostic'],
  ['POST', 'ssh/prepare', 'prepareSSH', 'settings'],
  ['POST', 'ssh/project', 'prepareSSHProject', 'settings'],
  ['POST', 'ssh/recover', 'recoverSSH', 'settings'],
] as const;
it.each(routes)(
  'rejects malformed application output at %s %s',
  async (method, route, handler, payload) => {
    vi.spyOn(
      runtime.app.get(ExecutionEnvironmentSettingsService) as any,
      handler
    ).mockResolvedValue({
      success: true,
      [payload]: { invalid: true },
      privateFixture: 'must-not-leak',
    });
    const response = await call(route, {}, method);
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ success: false, error: 'Internal server error.' });
    expect(JSON.stringify(response.body)).not.toContain('must-not-leak');
  }
);

it('keeps invalid input/acceptance precedence ahead of target producer calls and response parsing', async () => {
  const service = runtime.app.get(ExecutionEnvironmentSettingsService) as any;
  const docker = vi.spyOn(service.docker, 'probe').mockRejectedValue(new Error('must not execute'));
  const providers = vi
    .spyOn(service.providers, 'run')
    .mockRejectedValue(new Error('must not execute'));
  const worker = vi
    .spyOn(service.ssh, 'prepareWorker')
    .mockRejectedValue(new Error('must not execute'));
  expect((await call('docker/prepare', { accepted: false })).status).toBe(400);
  expect((await call('providers/install', { provider: 'claude', accepted: false })).status).toBe(
    400
  );
  expect((await call('providers/key', { provider: 'claude', accepted: false })).status).toBe(400);
  expect((await call('ssh/prepare', { profileId: 'ssh', accepted: false })).status).toBe(400);
  expect((await call('ssh/project', { profileId: 'ssh', accepted: false })).status).toBe(400);
  expect((await call('ssh/recover', { profileId: 'ssh', accepted: false })).status).toBe(400);
  expect((await call('local/confirm', { accepted: false, warningVersion: 1 })).status).toBe(400);
  expect((await call('inspect', { unexpected: true })).status).toBe(400);
  expect(docker).not.toHaveBeenCalled();
  expect(providers).not.toHaveBeenCalled();
  expect(worker).not.toHaveBeenCalled();
});
