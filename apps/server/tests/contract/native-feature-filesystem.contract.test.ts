import { mkdtemp, mkdir, rm, readFile, writeFile, readdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { FeatureLoader } from '../../src/services/feature-loader.js';
import {
  FEATURE_REPOSITORY,
  type FeatureRepository,
} from '../../src/modules/features/feature.repository.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/security.module.js';
import { getAppSpecPath } from '@automaker/platform';
import { AutoModeServiceCompat } from '../../src/services/auto-mode/index.js';

let root: string;
const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'automaker-native-feature-fs-'));
});
afterEach(async () => {
  const closed = await Promise.allSettled(apps.splice(0).map((owner) => owner.app.close()));
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
  for (const result of closed) if (result.status === 'rejected') throw result.reason;
});
async function start(name: string, allowed?: string) {
  const directory = path.join(root, name);
  await mkdir(directory, { recursive: true });
  const owner = await createNestApplication({
    workingDirectory: directory,
    dataDir: path.join(directory, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: { NODE_ENV: 'test', ALLOWED_ROOT_DIRECTORY: allowed ?? directory },
  });
  apps.push(owner);
  return {
    ...owner,
    directory,
    loader: owner.app.get(FeatureLoader),
    repository: owner.app.get<FeatureRepository>(FEATURE_REPOSITORY),
    filesystem: owner.app.get(SECURE_FILESYSTEM),
  };
}

it('owns every feature boundary per application and rejects the other root before and after close', async () => {
  const one = await start('one'),
    two = await start('two');
  expect((one.loader as unknown as { filesystem: unknown }).filesystem).toBe(one.filesystem);
  expect((two.loader as unknown as { filesystem: unknown }).filesystem).toBe(two.filesystem);
  expect(one.filesystem).not.toBe(two.filesystem);
  await one.repository.create(one.directory, { id: 'same-id', title: 'One', description: 'One' });
  await two.repository.create(two.directory, { id: 'same-id', title: 'Two', description: 'Two' });
  await expect(one.repository.get(two.directory, 'same-id')).rejects.toThrow();
  await expect(one.loader.saveAgentOutput(two.directory, 'same-id', 'forbidden')).rejects.toThrow();
  await one.app.close();
  await two.repository.update(two.directory, 'same-id', { description: 'Still owned by two' });
  expect((await two.repository.get(two.directory, 'same-id'))?.description).toBe(
    'Still owned by two'
  );
});

it('does not overwrite on IO/restore/corruption errors and preserves scoped backup recovery', async () => {
  const owner = await start('errors'),
    id = 'feature-owned';
  await owner.repository.create(owner.directory, { id, title: 'Original', description: 'First' });
  await owner.repository.update(owner.directory, id, { description: 'Second' });
  const file = owner.loader.getFeatureJsonPath(owner.directory, id);
  const committed = await readFile(file, 'utf8');
  const read = owner.filesystem.readFile.bind(owner.filesystem);
  const fault = vi
    .spyOn(owner.filesystem, 'readFile')
    .mockImplementation((candidate, ...args) =>
      candidate === file
        ? Promise.reject(Object.assign(new Error('Owned IO failure'), { code: 'EIO' }))
        : read(candidate, ...args)
    );
  await expect(
    owner.repository.update(owner.directory, id, { title: 'Must not overwrite' })
  ).rejects.toMatchObject({ code: 'EIO' });
  expect(await readFile(file, 'utf8')).toBe(committed);
  fault.mockRestore();
  await writeFile(file, '{corrupted');
  const restoreFault = vi
    .spyOn(owner.filesystem, 'copyFile')
    .mockRejectedValueOnce(Object.assign(new Error('Owned restore failure'), { code: 'EACCES' }));
  await expect(
    owner.repository.update(owner.directory, id, { title: 'Must not overwrite' })
  ).rejects.toMatchObject({ code: 'EACCES' });
  expect(await readFile(file, 'utf8')).toBe('{corrupted');
  restoreFault.mockRestore();
  await owner.repository.update(owner.directory, id, { title: 'Recovered and edited' });
  expect(await owner.repository.get(owner.directory, id)).toMatchObject({
    title: 'Recovered and edited',
    description: 'First',
  });
  await rm(file + '.bak1', { force: true });
  await rm(file + '.bak2', { force: true });
  await rm(file + '.bak3', { force: true });
  await writeFile(file, '{unrecoverable');
  await expect(
    owner.repository.update(owner.directory, id, { title: 'Never' })
  ).rejects.toBeInstanceOf(SyntaxError);
  expect(await readFile(file, 'utf8')).toBe('{unrecoverable');
});

it.skipIf(process.platform === 'win32')(
  'serializes alias updates and app-spec merges without losing accepted changes',
  async () => {
    const owner = await start('concurrent');
    const project = path.join(owner.directory, 'project'),
      alias = path.join(owner.directory, 'alias');
    await mkdir(project);
    await symlink(project, alias);
    await owner.repository.create(project, {
      id: 'history',
      title: 'Owned',
      description: 'Initial',
    });
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        owner.repository.update(index % 2 ? alias : project, 'history', {
          description: 'Edit ' + index,
        })
      )
    );
    const feature = await owner.repository.get(project, 'history');
    expect(feature?.description).toBe('Edit 19');
    expect(feature?.descriptionHistory).toHaveLength(21);
    const spec = getAppSpecPath(project);
    await writeFile(
      spec,
      '<project_specification><implemented_features></implemented_features></project_specification>'
    );
    await Promise.all([
      owner.loader.syncFeatureToAppSpec(project, {
        id: 'one',
        title: 'Feature one',
        description: 'One',
      }),
      owner.loader.syncFeatureToAppSpec(alias, {
        id: 'two',
        title: 'Feature two',
        description: 'Two',
      }),
    ]);
    expect(await readFile(spec, 'utf8')).toContain('Feature one');
    expect(await readFile(spec, 'utf8')).toContain('Feature two');
  }
);

it('publishes one feature for concurrent same-ID creates without overwriting the winner', async () => {
  const one = await start('create-one', root),
    two = await start('create-two', root);
  const project = path.join(root, 'shared');
  await mkdir(project);
  const results = await Promise.allSettled([
    one.repository.create(project, { id: 'exclusive', title: 'One', description: 'One' }),
    two.repository.create(project, { id: 'exclusive', title: 'Two', description: 'Two' }),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const winner = results.find((result) => result.status === 'fulfilled')!;
  const loser = results.find((result) => result.status === 'rejected')!;
  expect(loser.status === 'rejected' && loser.reason.statusCode).toBe(409);
  expect(await one.repository.get(project, 'exclusive')).toMatchObject(
    winner.status === 'fulfilled'
      ? { title: winner.value.title, description: winner.value.description }
      : {}
  );
  expect(
    (await readdir(one.loader.getFeatureDir(project, 'exclusive'))).some((name) =>
      name.includes('.create.')
    )
  ).toBe(false);
});

it('drains an accepted atomic update before the filesystem shutdown barrier', async () => {
  const owner = await start('drain');
  await owner.repository.create(owner.directory, { id: 'drain', description: 'Before' });
  const file = owner.loader.getFeatureJsonPath(owner.directory, 'drain');
  const rename = owner.filesystem.rename.bind(owner.filesystem);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = vi.spyOn(owner.filesystem, 'rename').mockImplementation(async (from, to) => {
    if (to === file) await held;
    return rename(from, to);
  });
  const updating = owner.repository.update(owner.directory, 'drain', { description: 'Accepted' });
  await vi.waitFor(() => expect(pending).toHaveBeenCalled());
  const closing = owner.app.close();
  await vi.waitFor(() =>
    expect((owner.loader as unknown as { stopping: boolean }).stopping).toBe(true)
  );
  await expect(
    owner.repository.update(owner.directory, 'drain', { description: 'Late' })
  ).rejects.toThrow('shutting down');
  release();
  await updating;
  await closing;
  expect(JSON.parse(await readFile(file, 'utf8')).description).toBe('Accepted');
});

it('keeps committed image references intact when the JSON commit fails', async () => {
  const owner = await start('image-commit');
  const directory = owner.loader.getFeatureImagesDir(owner.directory, 'image-owner');
  await mkdir(directory, { recursive: true });
  const image = path.join(directory, 'owned.png');
  await writeFile(image, 'owned image fixture');
  await owner.repository.create(owner.directory, {
    id: 'image-owner',
    description: 'Owned',
    imagePaths: [image],
  });
  const target = owner.loader.getFeatureJsonPath(owner.directory, 'image-owner');
  const rename = owner.filesystem.rename.bind(owner.filesystem);
  const failing = vi
    .spyOn(owner.filesystem, 'rename')
    .mockImplementation((from, to) =>
      to === target
        ? Promise.reject(Object.assign(new Error('Owned rename failure'), { code: 'EIO' }))
        : rename(from, to)
    );
  await expect(
    owner.repository.update(owner.directory, 'image-owner', { imagePaths: [] })
  ).rejects.toMatchObject({ code: 'EIO' });
  failing.mockRestore();
  expect(await readFile(image, 'utf8')).toBe('owned image fixture');
  expect((await owner.repository.get(owner.directory, 'image-owner'))?.imagePaths).toEqual([image]);
});

it('persists upstream runtime shutdown artifacts before loader drain and filesystem close', async () => {
  const owner = await start('upstream-shutdown');
  await owner.loader.create(owner.directory, { id: 'upstream', description: 'Before' });
  const runtime = owner.app.get(AutoModeServiceCompat);
  const mark = runtime.markAllRunningFeaturesInterrupted.bind(runtime);
  const order: string[] = [];
  vi.spyOn(runtime, 'markAllRunningFeaturesInterrupted').mockImplementation(async (reason) => {
    await mark(reason);
    await owner.loader.update(owner.directory, 'upstream', {
      description: 'Persisted during runtime shutdown',
    });
    await owner.loader.saveAgentOutput(owner.directory, 'upstream', 'Owned shutdown artifact');
    order.push('upstream-persisted');
  });
  const drain = owner.loader.beforeApplicationShutdown.bind(owner.loader);
  vi.spyOn(owner.loader, 'beforeApplicationShutdown').mockImplementation(() => {
    expect(order).toEqual(['upstream-persisted']);
    order.push('loader-drain');
    return drain();
  });
  const close = owner.filesystem.close.bind(owner.filesystem);
  vi.spyOn(owner.filesystem, 'close').mockImplementation(async () => {
    expect(order).toEqual(['upstream-persisted', 'loader-drain']);
    expect((owner.loader as unknown as { stopping: boolean }).stopping).toBe(true);
    order.push('filesystem-close');
    return close();
  });
  await owner.app.close();
  expect(order).toEqual(['upstream-persisted', 'loader-drain', 'filesystem-close']);
  expect(
    JSON.parse(await readFile(owner.loader.getFeatureJsonPath(owner.directory, 'upstream'), 'utf8'))
      .description
  ).toBe('Persisted during runtime shutdown');
  expect(await readFile(owner.loader.getAgentOutputPath(owner.directory, 'upstream'), 'utf8')).toBe(
    'Owned shutdown artifact'
  );
  await expect(
    owner.loader.update(owner.directory, 'upstream', { description: 'Late' })
  ).rejects.toThrow('shutting down');
});
