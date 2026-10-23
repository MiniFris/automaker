import type { ActiveSession } from './agent-session.types.js';

/** Application-owned active state, distinct from persisted conversations. */
export class AgentSessionRegistry {
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly loading = new Map<
    string,
    {
      promise: Promise<ActiveSession | null>;
      invalidated: boolean;
    }
  >();

  get size(): number {
    return this.sessions.size;
  }
  get(id: string): ActiveSession | undefined {
    return this.sessions.get(id);
  }
  set(id: string, session: ActiveSession): void {
    this.sessions.set(id, session);
  }
  delete(id: string): boolean {
    const pending = this.loading.get(id);
    if (pending) pending.invalidated = true;
    return this.sessions.delete(id);
  }
  entries(): IterableIterator<[string, ActiveSession]> {
    return this.sessions.entries();
  }

  getOrCreate(id: string, create: () => ActiveSession): ActiveSession {
    const existing = this.sessions.get(id);
    if (existing) return existing;
    const session = create();
    this.sessions.set(id, session);
    return session;
  }

  getOrLoad(id: string, load: () => Promise<ActiveSession | null>): Promise<ActiveSession | null> {
    const existing = this.sessions.get(id);
    if (existing) return Promise.resolve(existing);
    const pending = this.loading.get(id);
    if (pending && !pending.invalidated) return pending.promise;
    const slot = { promise: Promise.resolve<ActiveSession | null>(null), invalidated: false };
    slot.promise = Promise.resolve()
      .then(load)
      .then((session) => {
        if (slot.invalidated) return this.sessions.get(id) ?? null;
        if (!session) return this.sessions.get(id) ?? null;
        return this.getOrCreate(id, () => session);
      })
      .finally(() => {
        if (this.loading.get(id) === slot) this.loading.delete(id);
      });
    this.loading.set(id, slot);
    return slot.promise;
  }

  onApplicationShutdown(): void {
    for (const pending of this.loading.values()) pending.invalidated = true;
    this.loading.clear();
    this.sessions.clear();
  }
}
