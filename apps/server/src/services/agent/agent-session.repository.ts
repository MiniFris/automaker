import path from 'node:path';
import { atomicWriteJson, DEFAULT_BACKUP_COUNT, createLogger } from '@automaker/utils';
import { SessionIdSchema } from '@automaker/contracts';
import * as secureFs from '../../lib/secure-fs.js';
import type { Message, QueuedPrompt, SessionMetadata } from './agent-session.types.js';
import { AgentSessionStorageError } from './agent-session-storage.error.js';
import { assertCanonicalAgentSessionId } from './agent-session-id.js';
import { ConflictDomainError } from '../../core/errors/domain-errors.js';
import { agentStorageArtifacts, removeAgentStorageArtifacts } from './agent-storage-artifacts.js';

export interface AgentSessionDeletionState {
  version: 1;
  sessionId: string;
  phase: 'deleting' | 'deleted';
  createdAt: string;
  completedAt?: string;
}

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
  private readonly deletionDirectory: string;
  private deletionIndex?: Promise<Map<string, AgentSessionDeletionState>>;

  constructor(dataDirectory: string) {
    this.stateDirectory = path.join(dataDirectory, 'agent-sessions');
    this.metadataFile = path.join(dataDirectory, 'sessions-metadata.json');
    this.deletionDirectory = path.join(dataDirectory, 'agent-session-deletions');
  }

  initialize(): Promise<unknown> {
    return secureFs.mkdir(this.stateDirectory, { recursive: true });
  }

  async loadMessages(id: string): Promise<Message[]> {
    if (await this.deletionState(id)) return [];
    return this.read(this.sessionFile(id), [], 'messages');
  }
  saveMessages(id: string, messages: Message[]): Promise<void> {
    return this.write(this.sessionFile(id), messages, id);
  }
  async loadQueue(id: string): Promise<QueuedPrompt[]> {
    if (await this.deletionState(id)) return [];
    return this.read(this.queueFile(id), [], 'queue');
  }
  saveQueue(id: string, queue: QueuedPrompt[]): Promise<void> {
    return this.write(this.queueFile(id), queue, id);
  }
  async loadMetadata(): Promise<Record<string, SessionMetadata>> {
    return this.maskDeleted(await this.read(this.metadataFile, {}, 'metadata'));
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
    }, session.id);
  }

  updateMetadata(id: string, updates: Partial<SessionMetadata>): Promise<SessionMetadata | null> {
    assertCanonicalAgentSessionId(id);
    const snapshot = globalThis.structuredClone(updates);
    return this.mutateMetadata((metadata) => {
      if (!Object.hasOwn(metadata, id)) return { changed: false, result: null };
      const session = { ...metadata[id], ...snapshot, updatedAt: new Date().toISOString() };
      metadata[id] = session;
      return { changed: true, result: session };
    }, id);
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
    }, id);
  }

  deleteMetadata(id: string): Promise<boolean> {
    assertCanonicalAgentSessionId(id);
    return this.enqueue(this.metadataFile, async () => {
      const metadata = await this.read<Record<string, SessionMetadata>>(
        this.metadataFile,
        {},
        'metadata'
      );
      if (!Object.hasOwn(metadata, id)) return false;
      delete metadata[id];
      await this.writeNow(this.metadataFile, await this.maskDeleted(metadata));
      return true;
    });
  }

  async deletionState(id: string): Promise<AgentSessionDeletionState | undefined> {
    assertCanonicalAgentSessionId(id);
    return (await this.deletions()).get(id);
  }

  async assertAvailable(id: string): Promise<void> {
    if (await this.deletionState(id))
      throw new ConflictDomainError('Agent session was deleted and cannot be reused.');
  }

  markForDeletion(id: string): Promise<AgentSessionDeletionState> {
    assertCanonicalAgentSessionId(id);
    return this.enqueue(this.deletionFile(id), async () => {
      const index = await this.deletions();
      const existing = index.get(id);
      if (existing) return existing;
      const state: AgentSessionDeletionState = {
        version: 1,
        sessionId: id,
        phase: 'deleting',
        createdAt: new Date().toISOString(),
      };
      await this.writeDeletion(state);
      index.set(id, state);
      return state;
    });
  }

  completeDeletion(id: string): Promise<void> {
    assertCanonicalAgentSessionId(id);
    return this.enqueue(this.deletionFile(id), async () => {
      const index = await this.deletions();
      const previous = index.get(id);
      if (!previous) throw new ConflictDomainError('Session deletion was not admitted.');
      const state: AgentSessionDeletionState = {
        ...previous,
        phase: 'deleted',
        completedAt: new Date().toISOString(),
      };
      await this.writeDeletion(state);
      index.set(id, state);
    });
  }

  async removeSessionArtifacts(id: string): Promise<void> {
    if (!(await this.deletionState(id)))
      throw new ConflictDomainError('Session deletion was not admitted.');
    for (const file of [this.sessionFile(id), this.queueFile(id)])
      await this.enqueue(file, () =>
        removeAgentStorageArtifacts(this.stateDirectory, path.basename(file))
      );
  }

  purgeMetadataSnapshots(): Promise<void> {
    return this.enqueue(this.metadataFile, async () => {
      for (const file of await agentStorageArtifacts(
        path.dirname(this.metadataFile),
        path.basename(this.metadataFile),
        false
      )) {
        let data: unknown;
        try {
          data = JSON.parse(String(await secureFs.readFile(file, 'utf8')));
        } catch {
          throw new AgentSessionStorageError('read');
        }
        if (!valid(data, 'metadata')) throw new AgentSessionStorageError('read');
        const masked = await this.maskDeleted(data as Record<string, SessionMetadata>);
        if (JSON.stringify(masked) === JSON.stringify(data)) continue;
        try {
          await atomicWriteJson(file, masked, { mode: 0o600 });
        } catch {
          throw new AgentSessionStorageError('write');
        }
      }
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

  private write(file: string, value: unknown, id?: string): Promise<void> {
    // Capture before waiting: callers may mutate their in-memory conversation/queue.
    const snapshot = globalThis.structuredClone(value);
    return this.enqueue(file, async () => {
      if (id) await this.assertAvailable(id);
      const data =
        file === this.metadataFile
          ? await this.maskDeleted(snapshot as Record<string, SessionMetadata>)
          : snapshot;
      await this.writeNow(file, data);
    });
  }
  private async writeNow(file: string, value: unknown): Promise<void> {
    try {
      await atomicWriteJson(file, value, { backupCount: DEFAULT_BACKUP_COUNT });
    } catch {
      throw new AgentSessionStorageError('write');
    }
  }
  private mutateMetadata<T>(
    mutate: (metadata: Record<string, SessionMetadata>) => { changed: boolean; result: T },
    id?: string
  ): Promise<T> {
    return this.enqueue(this.metadataFile, async () => {
      if (id) await this.assertAvailable(id);
      const metadata = await this.loadMetadata();
      const { changed, result } = mutate(metadata);
      if (changed) await this.writeNow(this.metadataFile, metadata);
      return result;
    });
  }
  private async maskDeleted(
    metadata: Record<string, SessionMetadata>
  ): Promise<Record<string, SessionMetadata>> {
    const deleted = await this.deletions();
    return Object.fromEntries(Object.entries(metadata).filter(([id]) => !deleted.has(id)));
  }
  private deletions(): Promise<Map<string, AgentSessionDeletionState>> {
    if (this.deletionIndex) return this.deletionIndex;
    const loading = this.loadDeletions();
    this.deletionIndex = loading;
    void loading.catch(() => {
      if (this.deletionIndex === loading) this.deletionIndex = undefined;
    });
    return loading;
  }
  private async loadDeletions(): Promise<Map<string, AgentSessionDeletionState>> {
    let files: string[];
    try {
      files = await secureFs.readdir(this.deletionDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
      throw new AgentSessionStorageError('read');
    }
    const index = new Map<string, AgentSessionDeletionState>();
    for (const file of files.filter((name) => name.endsWith('.json'))) {
      const id = file.slice(0, -5);
      try {
        assertCanonicalAgentSessionId(id);
        const state = JSON.parse(
          String(await secureFs.readFile(this.deletionFile(id), 'utf8'))
        ) as AgentSessionDeletionState;
        if (
          state?.version !== 1 ||
          state.sessionId !== id ||
          !['deleting', 'deleted'].includes(state.phase) ||
          typeof state.createdAt !== 'string'
        )
          throw new Error('Invalid deletion intent');
        index.set(id, state);
      } catch {
        throw new AgentSessionStorageError('read');
      }
    }
    return index;
  }
  private async writeDeletion(state: AgentSessionDeletionState): Promise<void> {
    try {
      await secureFs.mkdir(this.deletionDirectory, { recursive: true, mode: 0o700 });
      await atomicWriteJson(this.deletionFile(state.sessionId), state, { mode: 0o600 });
    } catch {
      throw new AgentSessionStorageError('write');
    }
  }
  private deletionFile(id: string): string {
    assertCanonicalAgentSessionId(id);
    return path.join(this.deletionDirectory, `${id}.json`);
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
