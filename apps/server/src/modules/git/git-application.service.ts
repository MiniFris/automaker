import { Inject, Injectable } from '@nestjs/common';
import { AutoModeServiceCompat } from '../../services/auto-mode/index.js';
import {
  ProjectGitService,
  gitWriteActions,
} from '../../services/execution-environment/project-git.js';
import { ExecutionEnvironmentError } from '../../services/execution-environment/runtime.js';
import { sshSerialized } from '../../services/execution-environment/ssh-state.js';
import type {
  GitDetailsRequest,
  GitFileRequest,
  GitProjectRequest,
  GitStageFilesRequest,
} from './git.schemas.js';

@Injectable()
export class GitApplicationService {
  constructor(
    @Inject(ProjectGitService) private readonly git: ProjectGitService,
    @Inject(AutoModeServiceCompat) private readonly autoMode: AutoModeServiceCompat
  ) {}

  diffs(input: GitProjectRequest, signal: AbortSignal) {
    return this.run('diffs', input, signal);
  }

  fileDiff(input: GitFileRequest, signal: AbortSignal) {
    return this.run('file-diff', input, signal);
  }

  details(input: GitDetailsRequest, signal: AbortSignal) {
    return this.run('details', input, signal);
  }

  enhancedStatus(input: GitProjectRequest, signal: AbortSignal) {
    return this.run('enhanced-status', input, signal);
  }

  async environment(input: GitProjectRequest) {
    const target = await this.git.resolveOrLocal(input.projectPath);
    return { success: true as const, executionEnvironment: target.environment };
  }

  stageFiles(input: GitStageFilesRequest, signal: AbortSignal) {
    return this.run('stage-files', input, signal);
  }

  private async run(
    action: string,
    input: GitProjectRequest & Record<string, unknown>,
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
