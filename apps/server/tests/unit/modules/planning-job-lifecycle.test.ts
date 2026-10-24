import { afterEach, expect, it, vi } from 'vitest';
import { AppSpecJobRegistry } from '../../../src/modules/app-spec/app-spec-job.registry.js';
import { BacklogPlanJobRegistry } from '../../../src/modules/backlog-plan/backlog-plan-job.registry.js';
import { BacklogPlanApplicationService } from '../../../src/modules/backlog-plan/backlog-plan-application.service.js';
import { ProjectFeatureSerializer } from '../../../src/modules/features/project-feature-serializer.js';
import { FeatureTransitionService } from '../../../src/modules/features/feature-transition.service.js';

const security = { validateLocalPath: (value: string) => value } as never;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => vi.useRealTimers());

it('retains an aborted spec lease until the accepted operation actually settles', async () => {
  const jobs = new AppSpecJobRegistry(security),
    held = deferred();
  let signal!: AbortSignal;
  expect(
    jobs.run('/project', 'sync', (controller) => {
      signal = controller.signal;
      return held.promise;
    })
  ).toBe(true);
  await Promise.resolve();
  jobs.stop('/project');
  expect(signal.aborted).toBe(true);
  expect(jobs.status('/project').isRunning).toBe(true);
  expect(jobs.run('/project', 'sync', async () => {})).toBe(false);
  held.resolve();
  await vi.waitFor(() => expect(jobs.status('/project').isRunning).toBe(false));
  await jobs.onModuleDestroy();
});

it('retains the stopped backlog generation and does not start replacement work', async () => {
  const jobs = new BacklogPlanJobRegistry(security),
    held = deferred(),
    operation = vi.fn(() => held.promise);
  expect(jobs.generate({ projectPath: '/project', prompt: 'Original' }, operation)).toBe(true);
  await Promise.resolve();
  jobs.stop();
  expect(jobs.isRunning).toBe(true);
  expect(jobs.generate({ projectPath: '/another', prompt: 'Replacement' }, operation)).toBe(false);
  expect(operation).toHaveBeenCalledOnce();
  held.resolve();
  await jobs.onModuleDestroy();
  expect(jobs.isRunning).toBe(false);
});

it('aborts before dispatch and owns synchronous workflow throws without leaving a stale lease', async () => {
  const jobs = new AppSpecJobRegistry(security),
    operation = vi.fn(async () => {});
  jobs.run('/project', 'sync', operation);
  await jobs.onModuleDestroy();
  expect(operation).not.toHaveBeenCalled();
  const second = new AppSpecJobRegistry(security);
  second.run('/project', 'sync', () => {
    throw new Error('private-workflow-fixture');
  });
  await vi.waitFor(() => expect(second.status('/project').isRunning).toBe(false));
  await second.onModuleDestroy();
});

it('bounds accepted spec jobs while preserving duplicate-project behavior', async () => {
  const jobs = new AppSpecJobRegistry(security),
    held = deferred();
  for (let i = 0; i < 8; i++)
    expect(jobs.run(`/project-${i}`, 'sync', () => held.promise)).toBe(true);
  expect(jobs.run('/project-0', 'sync', () => held.promise)).toBe(false);
  expect(() => jobs.run('/overflow', 'sync', () => held.promise)).toThrow('unavailable');
  held.resolve();
  await jobs.onModuleDestroy();
});

it.each(['spec', 'backlog'] as const)(
  'reports a held %s shutdown as unconfirmed and caches failure after late settlement',
  async (kind) => {
    vi.useFakeTimers();
    const spec = new AppSpecJobRegistry(security),
      backlog = new BacklogPlanJobRegistry(security),
      held = deferred();
    if (kind === 'spec') spec.run('/project', 'sync', () => held.promise);
    else backlog.generate({ projectPath: '/project', prompt: 'Held' }, () => held.promise);
    await Promise.resolve();
    const owner = kind === 'spec' ? spec : backlog;
    const first = owner.onModuleDestroy(),
      rejected = expect(first).rejects.toThrow('unconfirmed');
    expect(owner.onModuleDestroy()).toBe(first);
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    held.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await expect(owner.onModuleDestroy()).rejects.toThrow('unconfirmed');
    expect(() =>
      kind === 'spec'
        ? spec.run('/new', 'sync', async () => {})
        : backlog.generate({ projectPath: '/new', prompt: 'new' }, async () => {})
    ).toThrow('unavailable');
  }
);

it('drains a held foreground apply and prevents any late mutation after shutdown admission closes', async () => {
  const jobs = new BacklogPlanJobRegistry(security),
    held = deferred();
  const features = {
    list: vi.fn(async () => {
      await held.promise;
      return [];
    }),
    create: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  };
  const store = { load: vi.fn(), clear: vi.fn() };
  const service = new BacklogPlanApplicationService(
    { generate: vi.fn() },
    store,
    jobs,
    features as never,
    new ProjectFeatureSerializer(),
    new FeatureTransitionService(),
    {
      getGlobalSettings: async () => ({}),
      getProjectSettings: async () => ({}),
    } as never
  );
  const applied = service.apply({
    projectPath: '/project',
    plan: {
      changes: [{ type: 'add', feature: { title: 'Must not write' }, reason: '' }],
      summary: '',
      dependencyUpdates: [],
    },
  });
  const rejected = expect(applied).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(features.list).toHaveBeenCalledOnce());
  let closed = false;
  const shutdown = jobs.onModuleDestroy().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  held.resolve();
  await rejected;
  await shutdown;
  expect(features.create).not.toHaveBeenCalled();
  expect(store.clear).not.toHaveBeenCalled();
});

it('caps foreground backlog admission and drains accepted operations', async () => {
  const jobs = new BacklogPlanJobRegistry(security),
    held = deferred();
  const operations = Array.from({ length: 32 }, () => jobs.track(async () => held.promise));
  expect(() => jobs.track(async () => {})).toThrow('unavailable');
  await Promise.resolve();
  held.resolve();
  await Promise.all(operations);
  await jobs.onModuleDestroy();
});
