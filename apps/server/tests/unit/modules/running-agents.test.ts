import { afterEach, describe, expect, it, vi } from 'vitest';

import { RunningAgentsService } from '../../../src/modules/agents/running-agents.service.js';
import {
  setRunningDetails,
  setRunningState as setBacklogRunning,
} from '../../../src/routes/backlog-plan/common.js';
import { setRunningState as setSpecRunning } from '../../../src/routes/app-spec/common.js';

afterEach(() => {
  setBacklogRunning(false, null);
  setRunningDetails(null);
  setSpecRunning('/workspace/spec', false);
});

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
    setRunningDetails({
      projectPath: '/workspace/backlog',
      prompt: 'Plan backlog',
      startedAt: new Date().toISOString(),
    });
    setBacklogRunning(true);
    setSpecRunning('/workspace/spec', true, new AbortController(), 'sync');

    await expect(
      new RunningAgentsService(
        autoMode as never,
        {
          list: async () => [{ kind: 'chat', featureId: 'chat:session', sessionId: 'session' }],
        } as never
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
  });
});
