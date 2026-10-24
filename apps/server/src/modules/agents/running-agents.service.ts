import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';

import { getAllRunningGenerations } from '../../routes/app-spec/common.js';
import { getBacklogPlanStatus, getRunningDetails } from '../../routes/backlog-plan/common.js';
import { AutoModeServiceCompat } from '../../services/auto-mode/index.js';
import { ChatExecutionReadModel } from './chat-execution-read-model.js';

@Injectable()
export class RunningAgentsService {
  constructor(
    @Inject(AutoModeServiceCompat) private readonly autoMode: AutoModeServiceCompat,
    @Inject(ChatExecutionReadModel) private readonly chats: ChatExecutionReadModel
  ) {}

  async list(): Promise<Record<string, unknown>> {
    const runningAgents = [...(await this.autoMode.getRunningAgents())];
    const backlog = getRunningDetails();
    if (getBacklogPlanStatus().isRunning && backlog) {
      runningAgents.push({
        featureId: `backlog-plan:${backlog.projectPath}`,
        projectPath: backlog.projectPath,
        projectName: path.basename(backlog.projectPath),
        isAutoMode: false,
        title: 'Backlog plan',
        description: backlog.prompt,
      });
    }
    for (const generation of getAllRunningGenerations()) {
      const copy =
        generation.type === 'feature_generation'
          ? ['Generating features from spec', 'Creating features from the project specification']
          : generation.type === 'sync'
            ? ['Syncing spec with code', 'Updating spec from codebase and completed features']
            : ['Regenerating spec', 'Analyzing project and generating specification'];
      runningAgents.push({
        featureId: `spec-generation:${generation.projectPath}`,
        projectPath: generation.projectPath,
        projectName: path.basename(generation.projectPath),
        isAutoMode: false,
        title: copy[0],
        description: copy[1],
      });
    }
    const combined = [...runningAgents, ...(await this.chats.list())];
    return { success: true, runningAgents: combined, totalCount: combined.length };
  }
}
