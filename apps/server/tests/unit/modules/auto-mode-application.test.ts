import { describe, expect, it, vi } from 'vitest';
import { AutoModeApplicationService } from '../../../src/modules/auto-mode/auto-mode-application.service.js';
import { ProjectRunContextRegistry } from '../../../src/modules/auto-mode/project-run-context.registry.js';

describe('typed auto mode application service', () => {
  it('returns the global status contract without Express adapters', async () => {
    const runtime = {
      getStatus: vi
        .fn()
        .mockReturnValue({ isRunning: false, runningFeatures: [], runningCount: 0 }),
      getActiveAutoLoopProjects: vi.fn().mockReturnValue([]),
      getActiveAutoLoopWorktrees: vi.fn().mockReturnValue([]),
    };
    const service = new AutoModeApplicationService(
      runtime as never,
      runtime as never,
      runtime as never,
      new ProjectRunContextRegistry(),
      { launch: vi.fn() } as never
    );
    expect(await service.status({})).toEqual({
      success: true,
      isRunning: false,
      runningFeatures: [],
      runningCount: 0,
      activeAutoLoopProjects: [],
      activeAutoLoopWorktrees: [],
    });
  });
  it('normalizes an omitted branch and preserves idempotent start/stop results', async () => {
    let running = false;
    const runtime = {
      isAutoLoopRunningForProject: vi.fn(() => running),
      startAutoLoopForProject: vi.fn(async () => {
        running = true;
        return 2;
      }),
      stopAutoLoopForProject: vi.fn(async () => {
        running = false;
        return 0;
      }),
    };
    const contexts = new ProjectRunContextRegistry(),
      service = new AutoModeApplicationService(
        runtime as never,
        runtime as never,
        runtime as never,
        contexts,
        {
          launch: vi.fn(),
        } as never
      );
    expect(await service.start({ projectPath: '/project' })).toMatchObject({
      success: true,
      branchName: null,
    });
    expect(await service.start({ projectPath: '/project' })).toMatchObject({
      alreadyRunning: true,
      branchName: null,
    });
    expect(await service.stop({ projectPath: '/project' })).toMatchObject({
      runningFeaturesCount: 0,
    });
    expect(await service.stop({ projectPath: '/project' })).toMatchObject({ wasRunning: false });
    expect(runtime.startAutoLoopForProject).toHaveBeenCalledWith(
      '/project',
      null,
      undefined,
      undefined
    );
    await contexts.onModuleDestroy();
  });
});

it('captures each admitted request language before asynchronous execution and changes it on continuation', async () => {
  const runtime = { executeFeature: vi.fn(), resumeFeature: vi.fn(), followUpFeature: vi.fn() };
  const contexts = new ProjectRunContextRegistry();
  const service = new AutoModeApplicationService(
    {} as never,
    runtime as never,
    {} as never,
    contexts,
    {} as never
  );
  const request = { projectPath: '/project', featureId: 'task', outputLocale: 'ru' as 'ru' | 'en' };
  service.runFeature(request);
  request.outputLocale = 'en';
  await Promise.resolve();
  expect(runtime.executeFeature).toHaveBeenCalledWith('/project', 'task', false, false, undefined, {
    outputLocale: 'ru',
  });
  service.resumeFeature(request);
  await Promise.resolve();
  expect(runtime.resumeFeature).toHaveBeenCalledWith('/project', 'task', false, 'en');
  service.followUpFeature({ ...request, prompt: 'More detail', outputLocale: 'ru' });
  await Promise.resolve();
  expect(runtime.followUpFeature).toHaveBeenCalledWith(
    '/project',
    'task',
    'More detail',
    undefined,
    false,
    'ru'
  );
  await contexts.onModuleDestroy();
});
