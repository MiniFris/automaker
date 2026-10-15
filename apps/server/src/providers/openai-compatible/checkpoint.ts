import path from 'node:path';
import { randomUUID } from 'node:crypto';
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

/** Opt-in server-owned persistence. Directory is supplied by the server, never by the model. */
export class AgentCheckpointStore {
  private readonly directory: string;
  private readonly writes = new Map<string, Promise<void>>();
  constructor(dataDirectory: string) {
    this.directory = path.resolve(dataDirectory, 'direct-agent-checkpoints');
  }

  private file(sessionId: string): string {
    if (!new RegExp(uuid).test(sessionId))
      throw new OpenAICompatibleError('Invalid checkpoint session ID.');
    return path.join(this.directory, `${sessionId}.json`);
  }

  async save(checkpoint: DirectAgentCheckpoint): Promise<void> {
    const snapshot = parseCheckpoint(checkpoint);
    const previous = this.writes.get(snapshot.sessionId) ?? Promise.resolve();
    const write = previous.catch(() => {}).then(() => this.write(snapshot));
    this.writes.set(snapshot.sessionId, write);
    try {
      await write;
    } finally {
      if (this.writes.get(snapshot.sessionId) === write) this.writes.delete(snapshot.sessionId);
    }
  }

  private async write(snapshot: DirectAgentCheckpoint): Promise<void> {
    const file = this.file(snapshot.sessionId);
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await secureFs.mkdir(this.directory, { recursive: true });
      if ((await secureFs.lstat(this.directory)).isSymbolicLink())
        throw new Error('Unsafe directory');
      await secureFs.writeFile(temp, JSON.stringify(snapshot), { mode: 0o600, flag: 'wx' });
      await secureFs.rename(temp, file);
    } catch {
      await secureFs.unlink(temp).catch(() => {});
      throw new OpenAICompatibleError('Agent checkpoint could not be saved.');
    }
  }

  async load(sessionId: string): Promise<DirectAgentCheckpoint> {
    const file = this.file(sessionId);
    try {
      if ((await secureFs.lstat(this.directory)).isSymbolicLink())
        throw new Error('Unsafe directory');
      const stat = await secureFs.lstat(file);
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error('Unsafe checkpoint file');
      return parseCheckpoint(JSON.parse((await secureFs.readFile(file, 'utf-8')) as string));
    } catch {
      throw new OpenAICompatibleError('Agent checkpoint could not be loaded.');
    }
  }
}
