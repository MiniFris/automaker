import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';

import { AppSpecJobRegistry } from '../app-spec/app-spec-job.registry.js';
import { BacklogPlanJobRegistry } from '../backlog-plan/backlog-plan-job.registry.js';
import { FEATURE_RUN_READ_MODEL, type FeatureRunReadModel } from '../auto-mode/auto-mode.ports.js';
import { ChatExecutionReadModel } from './chat-execution-read-model.js';

@Injectable()
export class RunningAgentsService {
  constructor(
    @Inject(FEATURE_RUN_READ_MODEL)
    private readonly autoMode: Pick<FeatureRunReadModel, 'getRunningAgents'>,
    @Inject(ChatExecutionReadModel) private readonly chats: ChatExecutionReadModel,
    @Inject(AppSpecJobRegistry) private readonly specs: AppSpecJobRegistry,
    @Inject(BacklogPlanJobRegistry) private readonly backlog: BacklogPlanJobRegistry
  ) {}

  async list(): Promise<Record<string, unknown>> {
    const runningAgents = [...(await this.autoMode.getRunningAgents())];
    const backlog = this.backlog.snapshot();
    if (backlog) {
      runningAgents.push({
        featureId: `backlog-plan:${backlog.projectPath}`,
        projectPath: backlog.projectPath,
        projectName: path.basename(backlog.projectPath),
        isAutoMode: false,
        title: 'Backlog plan',
        description: backlog.prompt,
      });
    }
    for (const generation of this.specs.snapshot()) {
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
