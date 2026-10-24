import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toDirectModelId, type Feature } from '@automaker/types';
import { createNestApplication } from '../../src/main.js';
import { FeatureLoader } from '../../src/services/feature-loader.js';
import type { FeatureStateManager } from '../../src/services/feature-state-manager.js';
import { AutoModeServiceCompat } from '../../src/services/auto-mode/index.js';
import { APPLICATION_EVENTS } from '../../src/core/eventing/application-events.js';
import type { EventEmitter } from '../../src/lib/events.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/security.module.js';

let root: string;
const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'automaker-native-feature-state-'));
});
afterEach(async () => {
  const closed = await Promise.allSettled(apps.splice(0).map((owner) => owner.app.close()));
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
  for (const result of closed) if (result.status === 'rejected') throw result.reason;
});
async function start(name: string) {
  const directory = path.join(root, name);
  await mkdir(directory);
  const owner = await createNestApplication({
    workingDirectory: directory,
    dataDir: path.join(directory, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: { NODE_ENV: 'test', ALLOWED_ROOT_DIRECTORY: directory },
  });
  apps.push(owner);
  const facade = owner.app.get(AutoModeServiceCompat).createFacade(directory);
  const manager = (facade as unknown as { featureStateManager: FeatureStateManager })
    .featureStateManager;
  return {
    ...owner,
    directory,
    manager,
    loader: owner.app.get(FeatureLoader),
    filesystem: owner.app.get(SECURE_FILESYSTEM),
    events: owner.app.get<EventEmitter>(APPLICATION_EVENTS),
  };
}

it('uses the scoped loader for concurrent status, plan, tasks, summary and user edits with post-commit events', async () => {
  const owner = await start('transactions');
  const id = 'atomic-state';
  await owner.loader.create(owner.directory, {
    id,
    title: 'Initial',
    description: 'Owned',
    status: 'in_progress',
    planSpec: {
      status: 'pending',
      version: 1,
      reviewedByUser: false,
      tasks: [{ id: 'T001', description: 'Owned task', status: 'pending' }],
    },
  });
  const observed: Array<{ event: Record<string, unknown>; committed: Feature }> = [];
  owner.events.subscribe((type, payload) => {
    const event = payload as Record<string, unknown>;
    if (type === 'auto-mode:event' && event.featureId === id)
      observed.push({
        event,
        committed: JSON.parse(
          readFileSync(owner.loader.getFeatureJsonPath(owner.directory, id), 'utf8')
        ),
      });
  });
  await Promise.all([
    owner.manager.updateFeatureStatus(owner.directory, id, 'pipeline_review'),
    owner.manager.updateFeaturePlanSpec(owner.directory, id, { content: 'Owned plan' }),
    owner.manager.updateTaskStatus(owner.directory, id, 'T001', 'completed', 'Owned task summary'),
    owner.manager.saveFeatureSummary(owner.directory, id, 'Owned implementation summary'),
    owner.loader.update(owner.directory, id, { title: 'Concurrent user edit' }),
  ]);
  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      owner.manager.updateFeaturePlanSpec(owner.directory, id, {
        content: 'Plan revision ' + index,
      })
    )
  );
  const stored = await owner.loader.get(owner.directory, id);
  expect(stored).toMatchObject({
    title: 'Concurrent user edit',
    status: 'pipeline_review',
    planSpec: {
      content: 'Plan revision 11',
      version: 14,
      tasks: [{ id: 'T001', status: 'completed', summary: 'Owned task summary' }],
    },
  });
  expect(stored?.summary).toContain('### Review');
  expect(stored?.summary).toContain('Owned implementation summary');
  expect(observed.length).toBeGreaterThan(4);
  for (const { event, committed } of observed) {
    if (event.type === 'feature_status_changed') expect(committed.status).toBe(event.status);
    if (event.type === 'plan_spec_updated') expect(committed.planSpec).toEqual(event.planSpec);
    if (event.type === 'auto_mode_task_status')
      expect(committed.planSpec?.tasks).toEqual(event.tasks);
    if (event.type === 'auto_mode_summary') expect(committed.summary).toBe(event.summary);
  }
});

it('propagates scoped read/commit errors without status, plan or task success events', async () => {
  const owner = await start('failures'),
    id = 'state-errors';
  await owner.loader.create(owner.directory, {
    id,
    description: 'Owned',
    status: 'in_progress',
    planSpec: {
      status: 'pending',
      version: 1,
      reviewedByUser: false,
      tasks: [{ id: 'T001', description: 'Owned task', status: 'pending' }],
    },
  });
  const file = owner.loader.getFeatureJsonPath(owner.directory, id),
    before = await readFile(file, 'utf8');
  const emitted = vi.fn();
  owner.events.subscribe((type, payload) => {
    if (type === 'auto-mode:event') emitted(payload);
  });
  const read = owner.filesystem.readFile.bind(owner.filesystem);
  const fault = vi
    .spyOn(owner.filesystem, 'readFile')
    .mockImplementation((candidate, ...args) =>
      candidate === file
        ? Promise.reject(Object.assign(new Error('Owned EIO fixture'), { code: 'EIO' }))
        : read(candidate, ...args)
    );
  for (const operation of [
    () => owner.manager.updateFeatureStatus(owner.directory, id, 'verified'),
    () => owner.manager.updateFeaturePlanSpec(owner.directory, id, { content: 'Never' }),
    () => owner.manager.updateTaskStatus(owner.directory, id, 'T001', 'completed'),
    () => owner.manager.saveFeatureSummary(owner.directory, id, 'Never'),
    () => owner.manager.reconcileAllFeatureStates(owner.directory),
  ])
    await expect(operation()).rejects.toMatchObject({ code: 'EIO' });
  fault.mockRestore();
  const rename = owner.filesystem.rename.bind(owner.filesystem);
  const commit = vi
    .spyOn(owner.filesystem, 'rename')
    .mockImplementation((from, to) =>
      to === file
        ? Promise.reject(Object.assign(new Error('Owned commit failure'), { code: 'EIO' }))
        : rename(from, to)
    );
  await expect(
    owner.manager.updateFeatureStatus(owner.directory, id, 'waiting_approval')
  ).rejects.toMatchObject({ code: 'EIO' });
  commit.mockRestore();
  expect(emitted).not.toHaveBeenCalled();
  expect(await readFile(file, 'utf8')).toBe(before);
  for (const suffix of ['.bak1', '.bak2', '.bak3']) await rm(file + suffix, { force: true });
  await writeFile(file, '{corrupt');
  await expect(
    owner.manager.updateTaskStatus(owner.directory, id, 'T001', 'completed')
  ).rejects.toBeInstanceOf(SyntaxError);
  expect(await readFile(file, 'utf8')).toBe('{corrupt');
  expect(emitted).not.toHaveBeenCalled();
});

it('checks pipeline interruption inside the transaction and preserves reconciliation rules', async () => {
  const owner = await start('reconciliation'),
    id = 'pipeline-owner';
  await owner.loader.create(owner.directory, { id, description: 'Owned', status: 'in_progress' });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = false;
  const advancing = owner.loader.mutate(owner.directory, id, async (feature) => {
    entered = true;
    await held;
    feature.status = 'pipeline_review';
  });
  await vi.waitFor(() => expect(entered).toBe(true));
  const interrupted = owner.manager.markFeatureInterrupted(owner.directory, id);
  release();
  await Promise.all([advancing, interrupted]);
  expect((await owner.loader.get(owner.directory, id))?.status).toBe('pipeline_review');
  await owner.loader.update(owner.directory, id, {
    planSpec: {
      status: 'generating',
      version: 1,
      reviewedByUser: false,
      currentTaskId: 'T001',
      tasks: [{ id: 'T001', description: 'Interrupted task', status: 'in_progress' }],
    },
  });
  await owner.loader.create(owner.directory, {
    id: 'direct-owner',
    description: 'Owned direct',
    status: 'in_progress',
    model: toDirectModelId('fixture'),
  });
  await owner.loader.create(owner.directory, {
    id: 'approved-owner',
    description: 'Owned approved',
    status: 'in_progress',
    planSpec: { status: 'approved', version: 1, reviewedByUser: true },
  });
  expect(await owner.manager.reconcileAllFeatureStates(owner.directory)).toBe(3);
  expect(await owner.loader.get(owner.directory, id)).toMatchObject({
    status: 'pipeline_review',
    planSpec: { status: 'pending', tasks: [{ status: 'pending' }] },
  });
  expect((await owner.loader.get(owner.directory, id))?.planSpec?.currentTaskId).toBeUndefined();
  expect((await owner.loader.get(owner.directory, 'direct-owner'))?.status).toBe('interrupted');
  expect((await owner.loader.get(owner.directory, 'approved-owner'))?.status).toBe('ready');
});

it('keeps two application roots isolated through the actual native state managers', async () => {
  const one = await start('one'),
    two = await start('two');
  await one.loader.create(one.directory, { id: 'same', description: 'One' });
  await two.loader.create(two.directory, { id: 'same', description: 'Two' });
  await expect(
    one.manager.updateFeaturePlanSpec(two.directory, 'same', { content: 'Forbidden' })
  ).rejects.toThrow();
  await expect(one.manager.reconcileAllFeatureStates(two.directory)).rejects.toThrow();
  expect((await two.loader.get(two.directory, 'same'))?.planSpec).toBeUndefined();
  await one.app.close();
  await two.manager.updateFeatureStatus(two.directory, 'same', 'in_progress');
  expect((await two.loader.get(two.directory, 'same'))?.status).toBe('in_progress');
});
