import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/index.js';
import { AutoModeServiceCompat } from '../../src/services/auto-mode/index.js';
import { AgentPromptBuilder } from '../../src/services/agent/agent-prompt-builder.js';
import { AgentService } from '../../src/services/agent-service.js';
import { FeatureLoader } from '../../src/services/feature-loader.js';
import type { ExecutionFilesystem } from '../../src/services/execution-filesystem.js';
import { RecoveryService } from '../../src/services/recovery-service.js';
import { ConcurrencyManager } from '../../src/services/concurrency-manager.js';
import { TypedEventBus } from '../../src/services/typed-event-bus.js';
import { createEventEmitter } from '../../src/lib/events.js';
import { MockProvider } from '../helpers/mock-provider.js';

let root: string;
const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-recovery-io-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.allSettled(apps.splice(0).map(({ app }) => app.close()));
  await fs.rm(root, { recursive: true, force: true });
});
async function owner(name: string) {
  const project = path.join(root, name);
  await fs.mkdir(project);
  const provider = new MockProvider('claude');
  const query = vi.spyOn(provider, 'executeQuery');
  const runtime = await createNestApplication({
    workingDirectory: project,
    dataDir: path.join(project, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [{ name: 'claude', create: () => provider }],
    environment: { NODE_ENV: 'test', ALLOWED_ROOT_DIRECTORY: project },
  });
  apps.push(runtime);
  const filesystem = runtime.app.get<ExecutionFilesystem>(SECURE_FILESYSTEM);
  const facade = runtime.app.get(AutoModeServiceCompat).createFacade(project) as any;
  return { ...runtime, project, filesystem, facade, query };
}
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

it('owns real prompt context and both image entry points per application', async () => {
  const one = await owner('one'),
    two = await owner('two');
  const first = one.app.get(AgentPromptBuilder),
    second = two.app.get(AgentPromptBuilder);
  expect((first as any).filesystem).toBe(one.filesystem);
  const context = path.join(one.project, '.automaker/context');
  await fs.mkdir(context, { recursive: true });
  await fs.writeFile(path.join(context, 'OWNED.md'), 'First application private context');
  const signal = new AbortController().signal;
  const prompt = await first.systemPrompt({
    workingDirectory: one.project,
    message: 'Owned task',
    autoLoadClaudeMd: true,
    remoteContext: false,
    settings: null,
    signal,
  });
  expect(prompt).toContain('First application private context');
  const image = path.join(one.project, 'image.png');
  await fs.writeFile(image, 'owned-image');
  expect((await first.readImages([image], signal))[0].data).toBe(
    Buffer.from('owned-image').toString('base64')
  );
  expect(JSON.stringify(await first.content('Image fixture', [image], signal))).toContain(
    Buffer.from('owned-image').toString('base64')
  );
  await expect(second.readImages([image], signal)).rejects.toMatchObject({ statusCode: 403 });
  await expect(second.content('Denied', [image], signal)).rejects.toMatchObject({
    statusCode: 403,
  });
  await one.app.close();
  const own = path.join(two.project, 'own.png');
  await fs.writeFile(own, 'still-owned');
  expect((await second.readImages([own], signal))[0].filename).toBe('own.png');
});

it('does not invoke a native agent provider after an image read returns EIO', async () => {
  const runtime = await owner('image-error');
  const agents = runtime.app.get(AgentService);
  const sessionId = 'image-error';
  await agents.startConversation({ sessionId, workingDirectory: runtime.project });
  const image = path.join(runtime.project, 'image.png');
  await fs.writeFile(image, 'fixture');
  const read = runtime.filesystem.readFile.bind(runtime.filesystem);
  vi.spyOn(runtime.filesystem, 'readFile').mockImplementation((file, ...args) => {
    if (String(file) === image)
      return Promise.reject(Object.assign(new Error('image IO'), { code: 'EIO' }));
    return read(file, ...args);
  });
  await expect(
    agents.sendMessage({
      sessionId,
      message: 'Image task',
      imagePaths: [image],
      workingDirectory: runtime.project,
    })
  ).rejects.toMatchObject({ code: 'EIO' });
  expect(runtime.query).not.toHaveBeenCalled();
});

it('serializes atomic state commits/clear and filters every saved project snapshot', async () => {
  const runtime = await owner('state');
  const recovery = runtime.facade.recoveryService as RecoveryService;
  const manager = runtime.facade.concurrencyManager as ConcurrencyManager;
  manager.acquire({ projectPath: runtime.project, featureId: 'owned', isAutoMode: false });
  manager.acquire({ projectPath: '/other-project', featureId: 'foreign', isAutoMode: false });
  const state = path.join(runtime.project, '.automaker/execution-state.json');
  await recovery.saveExecutionState(runtime.project);
  expect(JSON.parse(await fs.readFile(state, 'utf8')).runningFeatureIds).toEqual(['owned']);
  const entered = deferred(),
    release = deferred();
  const rename = runtime.filesystem.rename.bind(runtime.filesystem);
  let held = false;
  vi.spyOn(runtime.filesystem, 'rename').mockImplementation(async (source, target) => {
    if (target === state && !held) {
      held = true;
      entered.resolve();
      await release.promise;
    }
    return rename(source, target);
  });
  const first = recovery.saveExecutionStateForProject(runtime.project, 'first', 2);
  await entered.promise;
  const second = recovery.saveExecutionStateForProject(runtime.project, 'second', 3);
  const clearing = recovery.clearExecutionState(runtime.project);
  expect(JSON.parse(await fs.readFile(state, 'utf8')).branchName).toBeNull();
  release.resolve();
  await Promise.all([first, second, clearing]);
  await expect(fs.access(state)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(
    (await fs.readdir(path.dirname(state))).filter((file) => file.includes('.write.'))
  ).toEqual([]);
  manager.release('owned', { force: true });
  manager.release('foreign', { force: true });
});

it('preserves committed state on rename failure and lets the next transaction succeed', async () => {
  const runtime = await owner('failure');
  const service = runtime.facade.recoveryService as RecoveryService;
  await service.saveExecutionState(runtime.project);
  const state = path.join(runtime.project, '.automaker/execution-state.json');
  const bytes = await fs.readFile(state, 'utf8');
  const rename = vi
    .spyOn(runtime.filesystem, 'rename')
    .mockRejectedValueOnce(Object.assign(new Error('rename IO'), { code: 'EIO' }));
  await expect(
    service.saveExecutionStateForProject(runtime.project, 'failed', 2)
  ).rejects.toMatchObject({ code: 'EIO' });
  expect(await fs.readFile(state, 'utf8')).toBe(bytes);
  expect(
    (await fs.readdir(path.dirname(state))).filter((file) => file.includes('.write.'))
  ).toEqual([]);
  rename.mockRestore();
  await service.saveExecutionStateForProject(runtime.project, 'next', 2);
  expect((await service.loadExecutionState(runtime.project, true)).branchName).toBe('next');
});

it('drains an accepted state rename before native filesystem shutdown and rejects later saves', async () => {
  const runtime = await owner('drain');
  const service = runtime.facade.recoveryService as RecoveryService;
  const entered = deferred(),
    release = deferred();
  const rename = runtime.filesystem.rename.bind(runtime.filesystem);
  vi.spyOn(runtime.filesystem, 'rename').mockImplementation(async (...args) => {
    entered.resolve();
    await release.promise;
    return rename(...args);
  });
  const saving = service.saveExecutionState(runtime.project);
  await entered.promise;
  let closed = false;
  const closing = runtime.app.close().then(() => {
    closed = true;
  });
  await vi.waitFor(() => expect((service as any).closing).toBeDefined());
  expect(closed).toBe(false);
  await expect(service.saveExecutionState(runtime.project)).rejects.toMatchObject({
    statusCode: 503,
  });
  release.resolve();
  await saving;
  await closing;
  expect(
    JSON.parse(
      await fs.readFile(path.join(runtime.project, '.automaker/execution-state.json'), 'utf8')
    ).version
  ).toBe(1);
});

it('queues strict recovery feature reads behind loader mutations and rejects corrupt feature state', async () => {
  const runtime = await owner('feature-lane');
  const loader = runtime.app.get(FeatureLoader);
  await loader.create(runtime.project, { id: 'feature', description: 'before', status: 'backlog' });
  const manager = new ConcurrencyManager(),
    execute = vi.fn();
  const service = new RecoveryService(
    new TypedEventBus(createEventEmitter()),
    manager,
    null,
    execute,
    (project, id, strict) => loader.get(project, id, { strict }),
    vi.fn(),
    vi.fn(),
    () => false,
    (options) => manager.acquire(options),
    (id, run) => manager.release(id, { expected: run }),
    runtime.filesystem
  );
  await service.saveExecutionState(runtime.project);
  const feature = loader.getFeatureJsonPath(runtime.project, 'feature');
  const entered = deferred(),
    release = deferred();
  const rename = runtime.filesystem.rename.bind(runtime.filesystem);
  const interception = vi
    .spyOn(runtime.filesystem, 'rename')
    .mockImplementation(async (source, target) => {
      if (target === feature) {
        entered.resolve();
        await release.promise;
      }
      return rename(source, target);
    });
  const update = loader.update(runtime.project, 'feature', { description: 'after' });
  await entered.promise;
  let scanned = false;
  const scan = service.resumeInterruptedFeatures(runtime.project).then(() => {
    scanned = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(scanned).toBe(false);
  release.resolve();
  await Promise.all([update, scan]);
  interception.mockRestore();
  expect((await loader.get(runtime.project, 'feature'))?.description).toBe('after');
  await fs.writeFile(feature, '{unknown');
  for (const file of await fs.readdir(path.dirname(feature)))
    if (file.includes('.bak')) await fs.unlink(path.join(path.dirname(feature), file));
  await expect(service.resumeInterruptedFeatures(runtime.project)).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
  expect(await fs.readFile(feature, 'utf8')).toBe('{unknown');
  await fs.writeFile(
    feature + '.bak1',
    JSON.stringify({ id: 'feature', status: 'backlog', description: 'Owned backup' })
  );
  await service.resumeInterruptedFeatures(runtime.project);
  expect(JSON.parse(await fs.readFile(feature, 'utf8')).description).toBe('Owned backup');
  expect(execute).not.toHaveBeenCalled();
});
