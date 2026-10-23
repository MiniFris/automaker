import { describe, expect, it, vi } from 'vitest';
import { FeatureCommandService } from '@/modules/features/feature-command.service.js';
import { FeatureTransitionService } from '@/modules/features/feature-transition.service.js';
import { ProjectFeatureSerializer } from '@/modules/features/project-feature-serializer.js';
import type { FeatureRepository } from '@/modules/features/feature.repository.js';

const current = {
  id: 'feature-1',
  title: 'Feature',
  category: 'Core',
  description: 'Before',
  status: 'in_progress',
};

const createRepository = (): FeatureRepository => ({
  list: vi.fn(),
  get: vi.fn().mockResolvedValue(current),
  getAgentOutput: vi.fn(),
  getRawOutput: vi.fn(),
  create: vi.fn().mockResolvedValue(current),
  update: vi.fn().mockResolvedValue({ ...current, status: 'completed' }),
  delete: vi.fn().mockResolvedValue(true),
  syncToAppSpec: vi.fn().mockResolvedValue(true),
});

describe('FeatureCommandService', () => {
  it('emits completion and synchronizes app spec only for a new completion transition', async () => {
    const repository = createRepository();
    const events = { emit: vi.fn() };
    const service = new FeatureCommandService(
      repository,
      {} as never,
      events as never,
      new FeatureTransitionService(),
      new ProjectFeatureSerializer()
    );

    await expect(
      service.update({
        projectPath: '/project',
        featureId: 'feature-1',
        updates: { status: 'completed' },
      })
    ).resolves.toMatchObject({ success: true, feature: { status: 'completed' } });
    expect(events.emit).toHaveBeenCalledWith('feature:completed', expect.any(Object));
    expect(repository.syncToAppSpec).toHaveBeenCalledOnce();
  });

  it('rejects unknown statuses before writing', async () => {
    const repository = createRepository();
    const service = new FeatureCommandService(
      repository,
      {} as never,
      { emit: vi.fn() } as never,
      new FeatureTransitionService(),
      new ProjectFeatureSerializer()
    );

    await expect(
      service.update({
        projectPath: '/project',
        featureId: 'feature-1',
        updates: { status: 'invented-status' },
      })
    ).rejects.toMatchObject({ statusCode: 400, errorCode: 'VALIDATION_ERROR' });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('serializes competing writes within one project while allowing other projects', async () => {
    const serializer = new ProjectFeatureSerializer();
    const order: string[] = [];
    let release: (() => void) | undefined;
    const blocked = serializer.run('/one', async () => {
      order.push('one:start');
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      order.push('one:end');
    });
    const queued = serializer.run('/one', async () => order.push('one:second'));
    const parallel = serializer.run('/two', async () => order.push('two'));

    await parallel;
    expect(order).toEqual(['one:start', 'two']);
    release?.();
    await Promise.all([blocked, queued]);
    expect(order).toEqual(['one:start', 'two', 'one:end', 'one:second']);
  });
});
