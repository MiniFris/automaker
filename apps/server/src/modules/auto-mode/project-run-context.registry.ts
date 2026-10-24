import { Inject, Injectable } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { createLogger } from '@automaker/utils';
import type { AutoModeServiceFacade } from '../../services/auto-mode/facade.js';
import { SecurityService } from '../../core/security/security.service.js';
import { UnavailableDomainError } from '../../core/errors/domain-errors.js';

const logger = createLogger('AutoModeCommands');
export interface ProjectRunContext {
  readonly projectPath: string;
  facade?: AutoModeServiceFacade;
  readonly pendingCommands: Set<Promise<unknown>>;
}

export class AutoModeCommandCleanupError extends Error {
  readonly code = 'AUTO_MODE_COMMAND_CLEANUP_FAILED';
  constructor() {
    super('Auto mode command cleanup could not be confirmed.');
  }
}

/** Canonical project identity and accepted command lifetime; execution leases remain in ConcurrencyManager. */
@Injectable()
export class ProjectRunContextRegistry {
  private readonly contexts = new Map<string, ProjectRunContext>();
  private stopping = false;
  private pendingCount = 0;
  private shutdown?: Promise<void>;

  constructor(@Inject(SecurityService) private readonly security?: SecurityService) {}

  getOrCreate(
    projectPath: string,
    create: (canonical: string) => AutoModeServiceFacade
  ): AutoModeServiceFacade {
    const context = this.context(projectPath);
    return (context.facade ??= create(context.projectPath));
  }

  canonicalProject(projectPath: string): string {
    return (
      this.security?.validateLocalPath(projectPath, 'auto mode project') ??
      path.resolve(projectPath)
    );
  }

  isStopping(): boolean {
    return this.stopping;
  }

  launch(projectPath: string, action: () => Promise<unknown>): void {
    if (this.pendingCount >= 256)
      throw new UnavailableDomainError('Auto mode command queue is busy.');
    const context = this.context(projectPath);
    const task = Promise.resolve()
      .then(() => {
        if (!this.stopping) return action();
      })
      .catch(() => {
        logger.error('Background auto mode command failed.');
      })
      .finally(() => {
        context.pendingCommands.delete(task);
        this.pendingCount--;
      });
    context.pendingCommands.add(task);
    this.pendingCount++;
  }

  interruptForShutdown(): void {
    this.stopAdmission();
    for (const context of this.contexts.values()) context.facade?.interruptForShutdown();
  }

  stopAdmission(): void {
    this.stopping = true;
    for (const context of this.contexts.values()) context.facade?.closeAdmission();
  }

  onModuleDestroy(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.interruptForShutdown();
    const accepted = [...this.contexts.values()].flatMap((context) => [...context.pendingCommands]);
    let timer: NodeJS.Timeout | undefined;
    const deadline = performance.now() + 5000;
    this.shutdown = Promise.race([
      Promise.allSettled(accepted).then(() => {
        if (performance.now() >= deadline) throw new AutoModeCommandCleanupError();
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new AutoModeCommandCleanupError()), 5000);
      }),
    ]).finally(() => clearTimeout(timer));
    return this.shutdown;
  }

  private context(projectPath: string): ProjectRunContext {
    if (this.stopping) throw new UnavailableDomainError('Auto mode is shutting down.');
    const canonical = this.canonicalProject(projectPath);
    let context = this.contexts.get(canonical);
    if (!context) {
      if (this.contexts.size >= 1024)
        throw new UnavailableDomainError('Auto mode project context limit reached.');
      context = { projectPath: canonical, pendingCommands: new Set() };
      this.contexts.set(canonical, context);
    }
    return context;
  }
}
