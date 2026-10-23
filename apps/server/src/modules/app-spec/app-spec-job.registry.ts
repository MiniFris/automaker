import { Injectable } from '@nestjs/common';
import type { AppSpecOperation } from './app-spec-workflow.port.js';
import { setRunningState as setLegacyRunningState } from '../../routes/app-spec/common.js';

interface RunningJob {
  controller: AbortController;
  type: AppSpecOperation;
  startedAt: string;
}

@Injectable()
export class AppSpecJobRegistry {
  private readonly jobs = new Map<string, RunningJob>();

  start(projectPath: string, type: AppSpecOperation): AbortController | undefined {
    if (this.jobs.has(projectPath)) return undefined;
    const controller = new AbortController();
    this.jobs.set(projectPath, { controller, type, startedAt: new Date().toISOString() });
    setLegacyRunningState(projectPath, true, controller, type);
    return controller;
  }

  finish(projectPath: string, controller: AbortController): void {
    if (this.jobs.get(projectPath)?.controller === controller) {
      this.jobs.delete(projectPath);
      setLegacyRunningState(projectPath, false);
    }
  }

  stop(projectPath?: string): void {
    if (projectPath) {
      this.jobs.get(projectPath)?.controller.abort();
      this.jobs.delete(projectPath);
      setLegacyRunningState(projectPath, false);
      return;
    }
    for (const job of this.jobs.values()) job.controller.abort();
    for (const projectPath of this.jobs.keys()) setLegacyRunningState(projectPath, false);
    this.jobs.clear();
  }

  status(projectPath?: string) {
    if (!projectPath) return { isRunning: this.jobs.size > 0 };
    const job = this.jobs.get(projectPath);
    return {
      isRunning: !!job,
      projectPath,
      ...(job && { type: job.type, startedAt: job.startedAt }),
    };
  }
}
