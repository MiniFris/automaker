import path from 'node:path';
import { atomicWriteJson, DEFAULT_BACKUP_COUNT, createLogger } from '@automaker/utils';
import { SessionIdSchema } from '@automaker/contracts';
import * as secureFs from '../../lib/secure-fs.js';
import type { Message, QueuedPrompt, SessionMetadata } from './agent-session.types.js';
import { AgentSessionStorageError } from './agent-session-storage.error.js';
import { assertCanonicalAgentSessionId } from './agent-session-id.js';

type StoreKind = 'messages' | 'queue' | 'metadata';
const logger = createLogger('AgentSessionRepository');
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function valid(value: unknown, kind: StoreKind): boolean {
  if (kind === 'metadata')
    return (
      object(value) &&
      Object.entries(value).every(([id, entry]) => {
        const parsed = SessionIdSchema.safeParse(id);
        return parsed.success && parsed.data === id && object(entry) && entry.id === id;
      })
    );
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        object(entry) &&
        typeof entry.id === 'string' &&
        (kind === 'messages'
          ? (entry.role === 'user' || entry.role === 'assistant') &&
            typeof entry.content === 'string' &&
            typeof entry.timestamp === 'string'
          : typeof entry.message === 'string' && typeof entry.addedAt === 'string')
    )
  );
}

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
    return this.read(this.sessionFile(id), [], 'messages');
  }
  saveMessages(id: string, messages: Message[]): Promise<void> {
    return this.write(this.sessionFile(id), messages);
  }
  loadQueue(id: string): Promise<QueuedPrompt[]> {
    return this.read(this.queueFile(id), [], 'queue');
  }
  saveQueue(id: string, queue: QueuedPrompt[]): Promise<void> {
    return this.write(this.queueFile(id), queue);
  }
  loadMetadata(): Promise<Record<string, SessionMetadata>> {
    return this.read(this.metadataFile, {}, 'metadata');
  }
  saveMetadata(metadata: Record<string, SessionMetadata>): Promise<void> {
    return this.write(this.metadataFile, metadata);
  }

  addMetadata(session: SessionMetadata): Promise<void> {
    assertCanonicalAgentSessionId(session.id);
    const snapshot = globalThis.structuredClone(session);
    return this.mutateMetadata((metadata) => {
      metadata[snapshot.id] = snapshot;
      return { changed: true, result: undefined };
    });
  }

  updateMetadata(id: string, updates: Partial<SessionMetadata>): Promise<SessionMetadata | null> {
    assertCanonicalAgentSessionId(id);
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
    assertCanonicalAgentSessionId(id);
    return this.mutateMetadata((metadata) => {
      const session = Object.hasOwn(metadata, id) ? metadata[id] : undefined;
      if (!session?.sdkSessionId) return { changed: false, result: undefined };
      delete session.sdkSessionId;
      session.updatedAt = new Date().toISOString();
      return { changed: true, result: undefined };
    });
  }

  deleteMetadata(id: string): Promise<boolean> {
    assertCanonicalAgentSessionId(id);
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

  private async read<T>(file: string, fallback: T, kind: StoreKind): Promise<T> {
    let content: string;
    try {
      content = String(await secureFs.readFile(file, 'utf8'));
    } catch (error) {
      // Absence is authoritative (including after deletion). Never resurrect a
      // missing main file from an older backup or an uncommitted temp file.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
      throw new AgentSessionStorageError('read');
    }
    try {
      const data: unknown = JSON.parse(content);
      if (valid(data, kind)) return data as T;
    } catch {
      /* A corrupt main file may have a committed backup. */
    }
    for (let index = 1; index <= DEFAULT_BACKUP_COUNT; index++) {
      let backup: string;
      try {
        backup = String(await secureFs.readFile(`${file}.bak${index}`, 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw new AgentSessionStorageError('read');
      }
      try {
        const data: unknown = JSON.parse(backup);
        if (!valid(data, kind)) continue;
        logger.warn('Agent session store read from committed backup.', { kind, backup: index });
        return data as T;
      } catch {
        /* Try the next committed backup, without logging its contents. */
      }
    }
    throw new AgentSessionStorageError('read');
  }

  private write(file: string, value: unknown): Promise<void> {
    // Capture before waiting: callers may mutate their in-memory conversation/queue.
    const snapshot = globalThis.structuredClone(value);
    return this.enqueue(file, () => this.writeNow(file, snapshot));
  }
  private async writeNow(file: string, value: unknown): Promise<void> {
    try {
      await atomicWriteJson(file, value, { backupCount: DEFAULT_BACKUP_COUNT });
    } catch {
      throw new AgentSessionStorageError('write');
    }
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
    assertCanonicalAgentSessionId(id);
    return path.join(this.stateDirectory, `${id}.json`);
  }
  private queueFile(id: string): string {
    assertCanonicalAgentSessionId(id);
    return path.join(this.stateDirectory, `${id}-queue.json`);
  }
}
