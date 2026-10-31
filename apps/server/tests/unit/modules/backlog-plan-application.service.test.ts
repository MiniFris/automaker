import { describe, expect, it, vi } from 'vitest';
import { BacklogPlanApplicationService } from '@/modules/backlog-plan/backlog-plan-application.service.js';
import { BacklogPlanJobRegistry } from '@/modules/backlog-plan/backlog-plan-job.registry.js';
import { FeatureTransitionService } from '@/modules/features/feature-transition.service.js';
import { ProjectFeatureSerializer } from '@/modules/features/project-feature-serializer.js';
import type { FeatureRepository } from '@/modules/features/feature.repository.js';

describe('BacklogPlanApplicationService', () => {
  it('applies an approved plan in delete/add/update order and clears the saved proposal', async () => {
    const existing = {
      id: 'old',
      title: 'Old',
      category: 'Core',
      description: 'Old',
      dependencies: [],
    };
    const repository: FeatureRepository = {
      list: vi.fn().mockResolvedValue([existing]),
      get: vi.fn(),
      getAgentConversation: vi.fn().mockResolvedValue([]),
      getAgentOutput: vi.fn(),
      getRawOutput: vi.fn(),
      create: vi.fn().mockImplementation(async (_path, feature) => ({ ...feature, id: 'new' })),
      update: vi
        .fn()
        .mockImplementation(async (_path, id, feature) => ({ ...existing, ...feature, id })),
      delete: vi.fn().mockResolvedValue(true),
      syncToAppSpec: vi.fn(),
    };
    const store = { load: vi.fn(), clear: vi.fn().mockResolvedValue(undefined) };
    const service = new BacklogPlanApplicationService(
      { generate: vi.fn() },
      store,
      new BacklogPlanJobRegistry({ validateLocalPath: (value: string) => value } as never),
      repository,
      new ProjectFeatureSerializer(),
      new FeatureTransitionService(),
      {
        getGlobalSettings: vi.fn().mockResolvedValue({ defaultPlanningMode: 'skip' }),
        getProjectSettings: vi.fn().mockResolvedValue({}),
      } as never
    );

    await expect(
      service.apply({
        projectPath: '/project',
        plan: {
          changes: [
            { type: 'update', featureId: 'old', feature: { title: 'Updated' }, reason: '' },
            { type: 'add', feature: { title: 'New', description: 'New' }, reason: '' },
            { type: 'delete', featureId: 'old', reason: '' },
          ],
          summary: '',
          dependencyUpdates: [],
        },
      })
    ).resolves.toEqual({
      success: true,
      appliedChanges: ['deleted:old', 'added:new', 'updated:old'],
    });
    expect(store.clear).toHaveBeenCalledWith('/project');
  });

  it('keeps generation as a proposal until the separate apply operation', async () => {
    const workflow = { generate: vi.fn().mockReturnValue(new Promise(() => {})) };
    const repository = {} as FeatureRepository;
    const service = new BacklogPlanApplicationService(
      workflow,
      { load: vi.fn(), clear: vi.fn() },
      new BacklogPlanJobRegistry({ validateLocalPath: (value: string) => value } as never),
      repository,
      new ProjectFeatureSerializer(),
      new FeatureTransitionService(),
      {} as never
    );

    expect(service.generate({ projectPath: '/project', prompt: 'Change backlog' })).toEqual({
      success: true,
    });
    await Promise.resolve();
    expect(workflow.generate).toHaveBeenCalledOnce();
  });
});
