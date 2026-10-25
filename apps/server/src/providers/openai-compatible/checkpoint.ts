import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { Ajv } from 'ajv';
import { secureFs } from '@automaker/platform';
import type { DirectAgentCheckpoint } from '@automaker/types';
import { OpenAICompatibleError } from './errors.js';

const uuid = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const counter = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const validate = new Ajv({ strict: true, ownProperties: true, logger: false }).compile({
  type: 'object',
  additionalProperties: false,
  required: [
    'version',
    'sessionId',
    'endpointId',
    'modelId',
    'workspace',
    'requestHash',
    'tools',
    'status',
    'turns',
    'toolCalls',
    'outputChars',
    'elapsedMs',
    'messages',
  ],
  properties: {
    environmentBindingId: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    version: { const: 1 },
    sessionId: { type: 'string', pattern: uuid },
    endpointId: { type: 'string', minLength: 1 },
    modelId: { type: 'string', minLength: 1 },
    workspace: { type: 'string', minLength: 1 },
    requestHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    tools: { type: 'array', maxItems: 32, uniqueItems: true, items: { type: 'string' } },
    status: { enum: ['running', 'completed', 'interrupted', 'failed'] },
    turns: counter,
    toolCalls: counter,
    outputChars: counter,
    elapsedMs: counter,
    messages: {
      type: 'array',
      minItems: 1,
      maxItems: 1024,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['role', 'content'],
        properties: {
          role: { enum: ['system', 'user', 'assistant', 'tool'] },
          content: { type: ['string', 'null'] },
          tool_call_id: { type: 'string', minLength: 1 },
          tool_calls: {
            type: 'array',
            minItems: 1,
            maxItems: 128,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'type', 'function'],
              properties: {
                id: { type: 'string', minLength: 1, maxLength: 1024 },
                type: { const: 'function' },
                function: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['name', 'arguments'],
                  properties: {
                    name: { type: 'string', pattern: '^[A-Za-z0-9_-]+$' },
                    arguments: { type: 'string', maxLength: 1024 * 1024 },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
});

export function parseCheckpoint(value: unknown): DirectAgentCheckpoint {
  if (!validate(value)) throw new OpenAICompatibleError('Invalid agent checkpoint.');
  const snapshot = JSON.parse(JSON.stringify(value)) as DirectAgentCheckpoint;
  if (Buffer.byteLength(JSON.stringify(snapshot)) > 16 * 1024 * 1024)
    throw new OpenAICompatibleError('Checkpoint is too large.');
  let pending: string[] = [];
  const ids = new Set<string>();
  let count = 0;
  for (const message of snapshot.messages) {
    if (message.role === 'tool') {
      if (
        message.tool_calls ||
        !pending.length ||
        pending.shift() !== message.tool_call_id ||
        typeof message.content !== 'string'
      ) {
        throw new OpenAICompatibleError('Unbalanced checkpoint tool results.');
      }
    } else {
      if (pending.length || message.tool_call_id)
        throw new OpenAICompatibleError('Unbalanced checkpoint tool results.');
      if (message.tool_calls) {
        if (message.role !== 'assistant')
          throw new OpenAICompatibleError('Invalid checkpoint tool calls.');
        for (const call of message.tool_calls) {
          if (ids.has(call.id))
            throw new OpenAICompatibleError('Duplicate checkpoint tool call ID.');
          ids.add(call.id);
          pending.push(call.id);
          count++;
        }
      } else if (typeof message.content !== 'string') {
        throw new OpenAICompatibleError('Invalid checkpoint content.');
      }
    }
  }
  if (pending.length || count !== snapshot.toolCalls)
    throw new OpenAICompatibleError('Unbalanced checkpoint tool results.');
  return snapshot;
}

export interface AgentCheckpointRepository {
  save(checkpoint: DirectAgentCheckpoint): Promise<void>;
  load(sessionId: string): Promise<DirectAgentCheckpoint>;
}
export type CheckpointFilesystem = Pick<
  typeof secureFs,
  'mkdir' | 'lstat' | 'pipeFile' | 'writeFile' | 'rename' | 'unlink'
>;
const MAX_CHECKPOINT_BYTES = 16 * 1024 * 1024;

export class CheckpointCleanupError extends OpenAICompatibleError {
  readonly code = 'DIRECT_CHECKPOINT_OUTCOME_UNKNOWN';
  constructor() {
    super('Agent checkpoint persistence outcome is unconfirmed.');
  }
}

/** Native composition supplies scoped IO; the default remains standalone compatibility. */
export class AgentCheckpointStore implements AgentCheckpointRepository {
  private readonly directory: string;
  private readonly lanes = new Map<string, Promise<unknown>>();
  private readonly active = new Set<Promise<unknown>>();
  private readonly unknown = new Set<string>();
  private stopping = false;
  private shutdown?: Promise<void>;
  constructor(
    dataDirectory: string,
    private readonly filesystem: CheckpointFilesystem = secureFs,
    private readonly options: { maxAccepted?: number; drainMs?: number } = {}
  ) {
    this.directory = path.resolve(dataDirectory, 'direct-agent-checkpoints');
    if (
      !Number.isSafeInteger(options.maxAccepted ?? 64) ||
      (options.maxAccepted ?? 64) < 1 ||
      !Number.isSafeInteger(options.drainMs ?? 5000) ||
      (options.drainMs ?? 5000) < 1
    )
      throw new TypeError('Invalid checkpoint lifecycle limits.');
  }

  private file(sessionId: string): string {
    if (!new RegExp(uuid).test(sessionId))
      throw new OpenAICompatibleError('Invalid checkpoint session ID.');
    return path.join(this.directory, `${sessionId}.json`);
  }
  private run<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    this.file(sessionId);
    if (
      this.stopping ||
      this.unknown.has(sessionId) ||
      this.active.size + this.unknown.size >= (this.options.maxAccepted ?? 64)
    )
      return Promise.reject(new OpenAICompatibleError('Agent checkpoint storage is unavailable.'));
    const previous = this.lanes.get(sessionId) ?? Promise.resolve();
    const task = previous
      .catch(() => {})
      .then(() => {
        if (this.unknown.has(sessionId)) throw new CheckpointCleanupError();
        return operation();
      });
    this.lanes.set(sessionId, task);
    this.active.add(task);
    const finish = () => {
      this.active.delete(task);
      if (this.lanes.get(sessionId) === task) this.lanes.delete(sessionId);
    };
    void task.then(finish, finish);
    return task;
  }
  async save(checkpoint: DirectAgentCheckpoint): Promise<void> {
    const snapshot = parseCheckpoint(checkpoint);
    return this.run(snapshot.sessionId, () => this.write(snapshot));
  }
  private async directoryIsSafe(): Promise<void> {
    const stat = await this.filesystem.lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('Unsafe checkpoint directory');
  }
  private async read(
    sessionId: string,
    allowMissing = false
  ): Promise<DirectAgentCheckpoint | undefined> {
    await this.directoryIsSafe();
    const file = this.file(sessionId);
    let stat;
    try {
      stat = await this.filesystem.lstat(file);
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CHECKPOINT_BYTES)
      throw new Error('Unsafe checkpoint file');
    let bytes = 0;
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        bytes += chunk.byteLength;
        if (bytes > MAX_CHECKPOINT_BYTES)
          return callback(new Error('Checkpoint exceeds byte limit'));
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    await this.filesystem.pipeFile(file, sink, { maxBytes: MAX_CHECKPOINT_BYTES + 1 });
    const parsed = parseCheckpoint(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (parsed.sessionId !== sessionId) throw new Error('Checkpoint identity changed');
    return parsed;
  }
  private async write(snapshot: DirectAgentCheckpoint): Promise<void> {
    const file = this.file(snapshot.sessionId),
      temporary = `${file}.${randomUUID()}.tmp`;
    let temporaryAttempted = false,
      renameAttempted = false;
    try {
      await this.filesystem.mkdir(this.directory, { recursive: true, mode: 0o700 });
      const existing = await this.read(snapshot.sessionId, true);
      if (existing) {
        for (const key of [
          'endpointId',
          'modelId',
          'workspace',
          'requestHash',
          'environmentBindingId',
        ] as const)
          if (existing[key] !== snapshot[key]) throw new Error('Checkpoint binding changed');
        if (
          JSON.stringify([...existing.tools].sort()) !== JSON.stringify([...snapshot.tools].sort())
        )
          throw new Error('Checkpoint tools changed');
        for (const key of ['turns', 'toolCalls', 'outputChars', 'elapsedMs'] as const)
          if (snapshot[key] < existing[key]) throw new Error('Checkpoint history moved backwards');
      }
      temporaryAttempted = true;
      await this.filesystem.writeFile(temporary, JSON.stringify(snapshot), {
        mode: 0o600,
        flag: 'wx',
      });
      renameAttempted = true;
      await this.filesystem.rename(temporary, file);
    } catch {
      if (renameAttempted) this.unknown.add(snapshot.sessionId);
      if (temporaryAttempted) {
        try {
          await this.filesystem.unlink(temporary);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            this.unknown.add(snapshot.sessionId);
        }
      }
      throw new OpenAICompatibleError('Agent checkpoint could not be saved.');
    }
  }
  async load(sessionId: string): Promise<DirectAgentCheckpoint> {
    return this.run(sessionId, async () => {
      try {
        return (await this.read(sessionId))!;
      } catch {
        throw new OpenAICompatibleError('Agent checkpoint could not be loaded.');
      }
    });
  }
  close(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.stopping = true;
    this.shutdown = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.allSettled([...this.active]),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new CheckpointCleanupError()),
              this.options.drainMs ?? 5000
            );
          }),
        ]);
        if (this.unknown.size) throw new CheckpointCleanupError();
      } finally {
        clearTimeout(timer);
      }
    })();
    return this.shutdown;
  }
}
