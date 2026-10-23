import { Inject, Injectable } from '@nestjs/common';
import type { Request, RequestHandler, Response } from 'express';
import { LEGACY_SERVICES } from '../../legacy/legacy.tokens.js';
import { createAnalyzeProjectHandler } from '../../routes/auto-mode/routes/analyze-project.js';
import { createCommitFeatureHandler } from '../../routes/auto-mode/routes/commit-feature.js';
import { createContextExistsHandler } from '../../routes/auto-mode/routes/context-exists.js';
import { createFollowUpFeatureHandler } from '../../routes/auto-mode/routes/follow-up-feature.js';
import { createMergeSSHFeatureHandler } from '../../routes/auto-mode/routes/merge-ssh-feature.js';
import { createReconcileHandler } from '../../routes/auto-mode/routes/reconcile.js';
import { createResumeFeatureHandler } from '../../routes/auto-mode/routes/resume-feature.js';
import { createResumeInterruptedHandler } from '../../routes/auto-mode/routes/resume-interrupted.js';
import { createRunFeatureHandler } from '../../routes/auto-mode/routes/run-feature.js';
import { createStartHandler } from '../../routes/auto-mode/routes/start.js';
import { createStatusHandler } from '../../routes/auto-mode/routes/status.js';
import { createStopFeatureHandler } from '../../routes/auto-mode/routes/stop-feature.js';
import { createStopHandler } from '../../routes/auto-mode/routes/stop.js';
import { createVerifyFeatureHandler } from '../../routes/auto-mode/routes/verify-feature.js';
import type { AutoModeServiceCompat } from '../../services/auto-mode/index.js';

export type AutoModeHandlerName = keyof ReturnType<AutoModeHandlersService['createHandlers']>;

/** Nest HTTP boundary around the existing per-project auto-mode coordinator. */
@Injectable()
export class AutoModeHandlersService {
  private readonly handlers: Record<string, RequestHandler>;

  constructor(@Inject(LEGACY_SERVICES.autoMode) autoMode: AutoModeServiceCompat) {
    this.handlers = this.createHandlers(autoMode);
  }

  run(name: AutoModeHandlerName, request: Request, response: Response): Promise<void> {
    return Promise.resolve(
      this.handlers[name](request, response, (error?: unknown) => {
        if (error) throw error;
      }) as void | Promise<void>
    );
  }

  private createHandlers(autoMode: AutoModeServiceCompat) {
    return {
      mergeEnvironmentFeature: createMergeSSHFeatureHandler(autoMode, true),
      mergeSshFeature: createMergeSSHFeatureHandler(autoMode),
      start: createStartHandler(autoMode),
      stop: createStopHandler(autoMode),
      stopFeature: createStopFeatureHandler(autoMode),
      status: createStatusHandler(autoMode),
      runFeature: createRunFeatureHandler(autoMode),
      verifyFeature: createVerifyFeatureHandler(autoMode),
      resumeFeature: createResumeFeatureHandler(autoMode),
      contextExists: createContextExistsHandler(autoMode),
      analyzeProject: createAnalyzeProjectHandler(autoMode),
      followUpFeature: createFollowUpFeatureHandler(autoMode),
      commitFeature: createCommitFeatureHandler(autoMode),
      resumeInterrupted: createResumeInterruptedHandler(autoMode),
      reconcile: createReconcileHandler(autoMode),
    } satisfies Record<string, RequestHandler>;
  }
}
