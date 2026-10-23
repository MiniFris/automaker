import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';

import { LEGACY_SERVICES } from '../../legacy/legacy.tokens.js';
import { getAllRunningGenerations } from '../../routes/app-spec/common.js';
import { getBacklogPlanStatus, getRunningDetails } from '../../routes/backlog-plan/common.js';
import type { AutoModeServiceCompat } from '../../services/auto-mode/index.js';

@Injectable()
export class RunningAgentsService {
  constructor(@Inject(LEGACY_SERVICES.autoMode) private readonly autoMode: AutoModeServiceCompat) {}

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
    return { success: true, runningAgents, totalCount: runningAgents.length };
  }
}
