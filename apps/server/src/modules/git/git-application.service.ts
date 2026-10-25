import type {
  GitDetailsInput,
  GitFileInput,
  GitProjectInput,
  GitStageFilesInput,
} from './application.inputs.js';

import { type FeatureRunReadModel } from '../auto-mode/auto-mode.ports.js';
import {
  ProjectGitService,
  gitWriteActions,
} from '../../services/execution-environment/project-git.js';
import { ExecutionEnvironmentError } from '../../services/execution-environment/runtime.js';
import { sshSerialized } from '../../services/execution-environment/ssh-state.js';

export class GitApplicationService {
  constructor(
    private readonly git: ProjectGitService,

    private readonly autoMode: Pick<FeatureRunReadModel, 'isProjectRunning'>
  ) {}

  diffs(input: GitProjectInput, signal: AbortSignal) {
    return this.run('diffs', input, signal);
  }

  fileDiff(input: GitFileInput, signal: AbortSignal) {
    return this.run('file-diff', input, signal);
  }

  details(input: GitDetailsInput, signal: AbortSignal) {
    return this.run('details', input, signal);
  }

  enhancedStatus(input: GitProjectInput, signal: AbortSignal) {
    return this.run('enhanced-status', input, signal);
  }

  async environment(input: GitProjectInput) {
    const target = await this.git.resolveOrLocal(input.projectPath);
    return { success: true as const, executionEnvironment: target.environment };
  }

  stageFiles(input: GitStageFilesInput, signal: AbortSignal) {
    return this.run('stage-files', input, signal);
  }

  private async run(
    action: string,
    input: GitProjectInput & Record<string, unknown>,
    signal: AbortSignal
  ) {
    const target = await this.git.resolveOrLocal(input.projectPath);
    const body = {
      ...input,
      ...(action === 'stage-files' &&
      !input.environmentTargetId &&
      target.runtime.type === 'local' &&
      !target.binding
        ? { environmentTargetId: target.environment.targetId }
        : {}),
    };
    const operation = async () => {
      if (
        gitWriteActions.has(action) &&
        (await this.autoMode.isProjectRunning(target.environment.projectPath))
      ) {
        throw new ExecutionEnvironmentError(
          'GIT_PROJECT_BUSY',
          'Stop active project features before changing Git state from the UI.'
        );
      }
      return this.git.run(target, action, body, signal);
    };
    return gitWriteActions.has(action)
      ? sshSerialized(`git-ui\0${target.environment.projectPath}`, operation)
      : operation();
  }
}
