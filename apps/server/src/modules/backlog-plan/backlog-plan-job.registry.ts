import { Injectable } from '@nestjs/common';
import type { BacklogGenerateRequest } from './backlog-plan.schemas.js';

@Injectable()
export class BacklogPlanJobRegistry {
  private running?: {
    input: BacklogGenerateRequest;
    controller: AbortController;
    startedAt: string;
  };

  start(input: BacklogGenerateRequest): AbortController | undefined {
    if (this.running) return undefined;
    const controller = new AbortController();
    this.running = { input, controller, startedAt: new Date().toISOString() };
    return controller;
  }

  finish(controller: AbortController): void {
    if (this.running?.controller === controller) this.running = undefined;
  }

  stop(): void {
    this.running?.controller.abort();
    this.running = undefined;
  }

  get isRunning(): boolean {
    return !!this.running;
  }
}
