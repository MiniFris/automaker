import * as dockerCommand from '../../../src/services/execution-environment/docker-command.js';
import { mkdtemp, mkdir, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DockerProjectBinding } from '@automaker/types';
import { SettingsService } from '../../../src/services/settings-service.js';
import { ManagedDocker } from '../../../src/services/execution-environment/docker.js';
import {
  isIssuedEnvironment,
  ExecutionEnvironmentError,
} from '../../../src/services/execution-environment/runtime.js';
import {
  prepareDirectExecution,
  resolveExistingExecutionPreparation,
} from '../../../src/providers/openai-compatible/execution.js';

let root: string, project: string, settings: SettingsService, descriptor: DockerProjectBinding;
let existing: ReturnType<typeof vi.spyOn>,
  prepare: ReturnType<typeof vi.spyOn>,
  start: ReturnType<typeof vi.spyOn>,
  verify: ReturnType<typeof vi.spyOn>;
const signal = () => new AbortController().signal;
const model = 'direct-Analysis';
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'analysis-existing-docker-'));
  project = path.join(root, 'project');
  await mkdir(project);
  settings = new SettingsService(path.join(root, 'data'));
  await settings.updateGlobalSettings({
    executionEnvironment: {
      default: { mode: 'profile', profileId: 'docker' },
      profiles: [{ id: 'docker', name: 'Docker', type: 'docker' }],
    },
    openaiCompatibleEndpoints: [
      {
        id: 'offline',
        name: 'Offline',
        enabled: true,
        baseUrl: 'http://127.0.0.1:9/v1',
        protocol: 'chat-completions',
        auth: { type: 'none' },
        models: [
          {
            id: 'Analysis',
            displayName: 'Analysis',
            capabilities: { tools: true, streaming: false },
          },
        ],
      },
    ],
  });
  descriptor = {
    owner: 'owner',
    engineId: 'engine',
    containerId: 'existing-owned-container',
    imageId: 'image',
    projectPath: project,
    mount: { type: 'bind', source: project },
    user: '1000:1000',
  };
  existing = vi.spyOn(ManagedDocker.prototype, 'existing').mockResolvedValue(descriptor);
  verify = vi.spyOn(ManagedDocker.prototype, 'verifyStorage').mockResolvedValue(undefined);
  prepare = vi
    .spyOn(ManagedDocker.prototype, 'prepare')
    .mockRejectedValue(new Error('Unexpected prepare'));
  start = vi
    .spyOn(ManagedDocker.prototype, 'start')
    .mockRejectedValue(new Error('Unexpected start'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});
async function query(
  grant: Awaited<ReturnType<typeof resolveExistingExecutionPreparation>>,
  key = 'analysis-fixture'
) {
  return prepareDirectExecution(
    {
      model,
      prompt: 'offline',
      cwd: project,
      tools: ['Read', 'Glob', 'Grep'],
      readOnly: true,
      abortController: new AbortController(),
    },
    settings,
    { model, providerId: 'offline', projectPath: project, runKey: key },
    'agent',
    { PATH: '/usr/bin:/bin' },
    undefined,
    grant
  );
}
function noProvisioning() {
  expect(prepare).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
}
it('opens only the saved Docker target, issuing read-only runtime tools without container preparation or start', async () => {
  const grant = await resolveExistingExecutionPreparation(
    settings,
    project,
    'analysis-fixture',
    signal()
  );
  const options = await query(grant);
  expect(options.executionEnvironmentBinding).toMatchObject({
    type: 'docker',
    docker: { containerId: descriptor.containerId },
  });
  expect(isIssuedEnvironment(options.executionEnvironmentRuntime)).toBe(true);
  expect(options.tools).toEqual(['Read', 'Glob', 'Grep']);
  expect(options.readOnly).toBe(true);
  expect(verify).toHaveBeenCalledOnce();
  noProvisioning();
});
it('refuses a missing saved Docker target without trying to provision one', async () => {
  existing.mockResolvedValue(undefined);
  await expect(
    resolveExistingExecutionPreparation(settings, project, 'analysis-fixture', signal())
  ).rejects.toMatchObject({ code: 'DOCKER_PROJECT_REQUIRED' });
  expect(verify).not.toHaveBeenCalled();
  noProvisioning();
});
it('does not start a stopped or unverified saved container', async () => {
  verify.mockRejectedValue(new ExecutionEnvironmentError('DOCKER_NOT_RUNNING', 'Fixture stopped'));
  const grant = await resolveExistingExecutionPreparation(
    settings,
    project,
    'analysis-fixture',
    signal()
  );
  await expect(query(grant)).rejects.toThrow('Fixture stopped');
  noProvisioning();
});
it('rejects changed environment selection before opening a different target or falling back to Local', async () => {
  const grant = await resolveExistingExecutionPreparation(
    settings,
    project,
    'analysis-fixture',
    signal()
  );
  await settings.updateGlobalSettings({
    executionEnvironment: { default: { mode: 'local' }, profiles: [] },
  });
  await expect(query(grant)).rejects.toThrow('selection changed');
  expect(verify).not.toHaveBeenCalled();
  noProvisioning();
});
it('rejects a changed saved container descriptor before target dispatch', async () => {
  const grant = await resolveExistingExecutionPreparation(
    settings,
    project,
    'analysis-fixture',
    signal()
  );
  existing.mockResolvedValue({ ...descriptor, containerId: 'different-container' });
  await expect(query(grant)).rejects.toThrow('target changed');
  expect(verify).not.toHaveBeenCalled();
  noProvisioning();
});
it('rejects forged and cross-job authority objects before binding or Docker IO', async () => {
  await expect(query({ kind: 'existing-analysis-target' })).rejects.toThrow(
    'Invalid existing analysis execution grant'
  );
  const grant = await resolveExistingExecutionPreparation(
    settings,
    project,
    'analysis-fixture',
    signal()
  );
  await expect(query(grant, 'other-analysis')).rejects.toThrow(
    'Invalid existing analysis execution grant'
  );
  expect(verify).not.toHaveBeenCalled();
  noProvisioning();
});

it('the actual verifyStorage/runtime path refuses a stopped container without engine start or exec', async () => {
  verify.mockRestore();
  const inspect = vi
    .spyOn(ManagedDocker.prototype, 'verify')
    .mockResolvedValue({ State: { Running: false } } as never);
  const engine = vi
    .spyOn(dockerCommand, 'runDocker')
    .mockRejectedValue(new Error('Unexpected Docker dispatch'));
  const grant = await resolveExistingExecutionPreparation(
    settings,
    project,
    'analysis-fixture',
    signal()
  );
  await expect(query(grant)).rejects.toThrow('share a writable project');
  expect(inspect).toHaveBeenCalled();
  expect(engine).not.toHaveBeenCalled();
  noProvisioning();
  expect((await readdir(project)).filter((name) => name.startsWith('.automaker-storage-'))).toEqual(
    []
  );
});
it('actual issued Docker tools cannot restart a container that stops after preparation', async () => {
  const engine = vi
    .spyOn(dockerCommand, 'runDocker')
    .mockRejectedValue(new Error('Unexpected Docker dispatch'));
  vi.spyOn(ManagedDocker.prototype, 'verify').mockResolvedValue({
    State: { Running: false },
  } as never);
  const grant = await resolveExistingExecutionPreparation(
    settings,
    project,
    'analysis-fixture',
    signal()
  );
  const options = await query(grant);
  await expect(
    options.executionEnvironmentRuntime!.readFile('source.txt', 0, 100, signal())
  ).rejects.toMatchObject({ code: 'DOCKER_NOT_RUNNING' });
  expect(engine).not.toHaveBeenCalled();
  noProvisioning();
});
