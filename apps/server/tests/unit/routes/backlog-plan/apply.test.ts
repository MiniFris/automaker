import { describe, expect, it, vi } from 'vitest';
import { BacklogPlanApplicationService } from '@/modules/backlog-plan/backlog-plan-application.service.js';
import { BacklogPlanJobRegistry } from '@/modules/backlog-plan/backlog-plan-job.registry.js';
import { ProjectFeatureSerializer } from '@/modules/features/project-feature-serializer.js';
import { FeatureTransitionService } from '@/modules/features/feature-transition.service.js';

function fixture(global: object, project: object) {
  const settings = {
    getGlobalSettings: vi.fn().mockResolvedValue(global),
    getProjectSettings: vi.fn().mockResolvedValue(project),
  };
  const features = {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn(async (_path: string, value: object) => ({ id: 'feature-created', ...value })),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const store = { load: vi.fn(), clear: vi.fn().mockResolvedValue(undefined) };
  const security = { validateLocalPath: (value: string) => value };
  const jobs = new BacklogPlanJobRegistry(security as never);
  const service = new BacklogPlanApplicationService(
    { generate: vi.fn() } as never,
    store,
    jobs,
    features as never,
    new ProjectFeatureSerializer(security as never),
    new FeatureTransitionService(),
    settings as never
  );
  return { service, features, store, jobs };
}
const input = {
  projectPath: '/tmp/project',
  plan: {
    changes: [
      {
        type: 'add' as const,
        feature: { id: 'feature-from-plan', title: 'Created from plan', description: 'desc' },
      },
    ],
    dependencyUpdates: [],
  },
};
describe('native backlog apply use case with explicit feature/store/settings ports', () => {
  it('applies global default model/planning/approval settings when additions omit them', async () => {
    const { service, features, store, jobs } = fixture(
      {
        defaultFeatureModel: { model: 'codex-gpt-5.2-codex', reasoningEffort: 'high' },
        defaultPlanningMode: 'spec',
        defaultRequirePlanApproval: true,
      },
      {}
    );
    try {
      expect(await service.apply(input as never)).toMatchObject({ success: true });
      expect(features.create).toHaveBeenCalledWith(
        '/tmp/project',
        expect.objectContaining({
          model: 'codex-gpt-5.2-codex',
          reasoningEffort: 'high',
          planningMode: 'spec',
          requirePlanApproval: true,
        })
      );
      expect(store.clear).toHaveBeenCalledWith('/tmp/project');
    } finally {
      await jobs.onModuleDestroy();
    }
  });
  it('uses project model override and enforces no approval in skip mode', async () => {
    const { service, features, jobs } = fixture(
      {
        defaultFeatureModel: { model: 'claude-opus' },
        defaultPlanningMode: 'skip',
        defaultRequirePlanApproval: true,
      },
      {
        defaultFeatureModel: {
          model: 'GLM-4.7',
          providerId: 'provider-glm',
          thinkingLevel: 'adaptive',
        },
      }
    );
    try {
      await service.apply(input as never);
      expect(features.create).toHaveBeenCalledWith(
        '/tmp/project',
        expect.objectContaining({
          model: 'GLM-4.7',
          providerId: 'provider-glm',
          thinkingLevel: 'adaptive',
          planningMode: 'skip',
          requirePlanApproval: false,
        })
      );
    } finally {
      await jobs.onModuleDestroy();
    }
  });
});
