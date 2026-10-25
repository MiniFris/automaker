import { Injectable, type BeforeApplicationShutdown } from '@nestjs/common';
import { createLogger } from '@automaker/utils';
import type { ApplicationSupervisor, SupervisorHealth } from './supervisor.js';

const logger = createLogger('Lifecycle');

@Injectable()
export class SupervisorCoordinator implements BeforeApplicationShutdown {
  private readonly supervisors: ApplicationSupervisor[] = [];
  private stopping = false;
  register(supervisor: ApplicationSupervisor): () => void {
    if (this.supervisors.some(({ name }) => name === supervisor.name))
      throw new Error(`Supervisor "${supervisor.name}" is already registered`);
    this.supervisors.push(supervisor);
    return () => {
      const index = this.supervisors.indexOf(supervisor);
      if (index >= 0) this.supervisors.splice(index, 1);
    };
  }
  async startAll(): Promise<void> {
    for (const supervisor of this.supervisors) await supervisor.start();
  }
  async health(): Promise<Record<string, SupervisorHealth>> {
    return Object.fromEntries(
      await Promise.all(
        this.supervisors.map(async (item) => [item.name, await item.health()] as const)
      )
    );
  }
  async beforeApplicationShutdown(signal?: string): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    const deadline = Date.now() + 30_000;
    for (const supervisor of [...this.supervisors].reverse()) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        logger.error('Supervisor shutdown deadline exhausted', { supervisor: supervisor.name });
        break;
      }
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          Promise.resolve(supervisor.stop(signal ?? 'application shutdown')),
          new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              logger.error('Supervisor did not stop before deadline', {
                supervisor: supervisor.name,
              });
              resolve();
            }, remaining);
            timer.unref();
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  }
}
