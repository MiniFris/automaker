import path from 'node:path';
import { atomicWriteJson, DEFAULT_BACKUP_COUNT } from '@automaker/utils';
import { SessionIdSchema } from '@automaker/contracts';
import * as secureFs from '../../lib/secure-fs.js';
import type { Message, QueuedPrompt, SessionMetadata } from './agent-session.types.js';

/** Legacy-compatible file formats; each mutation has one application-local writer. */
export class AgentSessionRepository {
  private readonly stateDirectory: string;
  private readonly metadataFile: string;
  private readonly writes = new Map<string, Promise<unknown>>();

  constructor(dataDirectory: string) {
    this.stateDirectory = path.join(dataDirectory, 'agent-sessions');
    this.metadataFile = path.join(dataDirectory, 'sessions-metadata.json');
  }

  initialize(): Promise<unknown> {
    return secureFs.mkdir(this.stateDirectory, { recursive: true });
  }

  loadMessages(id: string): Promise<Message[]> {
    return this.read(this.sessionFile(id), []);
  }
  saveMessages(id: string, messages: Message[]): Promise<void> {
    return this.write(this.sessionFile(id), messages);
  }
  loadQueue(id: string): Promise<QueuedPrompt[]> {
    return this.read(this.queueFile(id), []);
  }
  saveQueue(id: string, queue: QueuedPrompt[]): Promise<void> {
    return this.write(this.queueFile(id), queue);
  }
  loadMetadata(): Promise<Record<string, SessionMetadata>> {
    return this.read(this.metadataFile, {});
  }
  saveMetadata(metadata: Record<string, SessionMetadata>): Promise<void> {
    return this.write(this.metadataFile, metadata);
  }

  addMetadata(session: SessionMetadata): Promise<void> {
    SessionIdSchema.parse(session.id);
    const snapshot = globalThis.structuredClone(session);
    return this.mutateMetadata((metadata) => {
      metadata[snapshot.id] = snapshot;
      return { changed: true, result: undefined };
    });
  }

  updateMetadata(id: string, updates: Partial<SessionMetadata>): Promise<SessionMetadata | null> {
    SessionIdSchema.parse(id);
    const snapshot = globalThis.structuredClone(updates);
    return this.mutateMetadata((metadata) => {
      if (!Object.hasOwn(metadata, id)) return { changed: false, result: null };
      const session = { ...metadata[id], ...snapshot, updatedAt: new Date().toISOString() };
      metadata[id] = session;
      return { changed: true, result: session };
    });
  }

  touchMetadata(id: string): Promise<SessionMetadata | null> {
    return this.updateMetadata(id, {});
  }

  clearSdkSessionId(id: string): Promise<void> {
    SessionIdSchema.parse(id);
    return this.mutateMetadata((metadata) => {
      const session = Object.hasOwn(metadata, id) ? metadata[id] : undefined;
      if (!session?.sdkSessionId) return { changed: false, result: undefined };
      delete session.sdkSessionId;
      session.updatedAt = new Date().toISOString();
      return { changed: true, result: undefined };
    });
  }

  deleteMetadata(id: string): Promise<boolean> {
    SessionIdSchema.parse(id);
    return this.mutateMetadata((metadata) => {
      if (!Object.hasOwn(metadata, id)) return { changed: false, result: false };
      delete metadata[id];
      return { changed: true, result: true };
    });
  }

  async deleteMessages(id: string): Promise<void> {
    const file = this.sessionFile(id);
    await this.enqueue(file, async () => {
      try {
        await secureFs.unlink(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    });
  }

  async drain(): Promise<void> {
    while (this.writes.size) await Promise.all(this.writes.values());
  }
  onApplicationShutdown(): Promise<void> {
    return this.drain();
  }

  private async read<T>(file: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(String(await secureFs.readFile(file, 'utf8'))) as T;
    } catch {
      return fallback;
    }
  }

  private write(file: string, value: unknown): Promise<void> {
    // Capture before waiting: callers may mutate their in-memory conversation/queue.
    const snapshot = globalThis.structuredClone(value);
    return this.enqueue(file, () => this.writeNow(file, snapshot));
  }
  private writeNow(file: string, value: unknown): Promise<void> {
    return atomicWriteJson(file, value, { backupCount: DEFAULT_BACKUP_COUNT });
  }
  private mutateMetadata<T>(
    mutate: (metadata: Record<string, SessionMetadata>) => { changed: boolean; result: T }
  ): Promise<T> {
    return this.enqueue(this.metadataFile, async () => {
      const metadata = await this.loadMetadata();
      const { changed, result } = mutate(metadata);
      if (changed) await this.writeNow(this.metadataFile, metadata);
      return result;
    });
  }
  private enqueue<T>(file: string, operation: () => Promise<T>): Promise<T> {
    const job = (this.writes.get(file) ?? Promise.resolve()).then(operation);
    const tail = job.then(
      () => undefined,
      () => undefined
    );
    this.writes.set(file, tail);
    void tail.then(() => {
      if (this.writes.get(file) === tail) this.writes.delete(file);
    });
    return job;
  }
  private sessionFile(id: string): string {
    return path.join(this.stateDirectory, `${SessionIdSchema.parse(id)}.json`);
  }
  private queueFile(id: string): string {
    return path.join(this.stateDirectory, `${SessionIdSchema.parse(id)}-queue.json`);
  }
}
