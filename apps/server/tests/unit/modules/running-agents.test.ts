import { describe, expect, it, vi } from 'vitest';

import { RunningAgentsService } from '../../../src/modules/agents/running-agents.service.js';
import { AppSpecJobRegistry } from '../../../src/modules/app-spec/app-spec-job.registry.js';
import { BacklogPlanJobRegistry } from '../../../src/modules/backlog-plan/backlog-plan-job.registry.js';

describe('RunningAgentsService', () => {
  it('combines feature, backlog and spec jobs into one read model', async () => {
    const autoMode = {
      getRunningAgents: vi.fn().mockResolvedValue([
        {
          featureId: 'feature',
          projectPath: '/workspace/project',
          projectName: 'project',
          isAutoMode: true,
        },
      ]),
    };
    const security = { validateLocalPath: (value: string) => value } as never;
    const specs = new AppSpecJobRegistry(security),
      backlog = new BacklogPlanJobRegistry(security);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    backlog.generate({ projectPath: '/workspace/backlog', prompt: 'Plan backlog' }, () => held);
    specs.run('/workspace/spec', 'sync', () => held);

    await expect(
      new RunningAgentsService(
        autoMode as never,
        {
          list: async () => [{ kind: 'chat', featureId: 'chat:session', sessionId: 'session' }],
        } as never,
        specs,
        backlog
      ).list()
    ).resolves.toMatchObject({
      success: true,
      totalCount: 4,
      runningAgents: [
        { featureId: 'feature' },
        { featureId: 'backlog-plan:/workspace/backlog', title: 'Backlog plan' },
        { featureId: 'spec-generation:/workspace/spec', title: 'Syncing spec with code' },
        { kind: 'chat', featureId: 'chat:session', sessionId: 'session' },
      ],
    });
    release();
    await Promise.all([specs.onModuleDestroy(), backlog.onModuleDestroy()]);
  });
});
