import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import type { DirectAgentCheckpoint } from '@automaker/types';
import { AgentCheckpointStore, parseCheckpoint } from '@/providers/openai-compatible/checkpoint.js';

function snapshot(): DirectAgentCheckpoint {
  return {
    version: 1,
    sessionId: randomUUID(),
    endpointId: 'local',
    modelId: 'model',
    workspace: '/project',
    requestHash: 'a'.repeat(64),
    tools: ['Read'],
    status: 'interrupted',
    turns: 1,
    toolCalls: 1,
    outputChars: 0,
    elapsedMs: 10,
    messages: [
      { role: 'user', content: 'Read a file' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-a',
            type: 'function',
            function: { name: 'Read', arguments: '{"path":"main.ts"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call-a', content: '{"ok":true}' },
    ],
  };
}

describe('direct agent checkpoints', () => {
  let directory: string;
  let store: AgentCheckpointStore;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'direct-checkpoint-test-'));
    store = new AgentCheckpointStore(directory);
  });
  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('returns a detached copy of validated history', () => {
    const original = snapshot();
    const parsed = parseCheckpoint(original);
    parsed.messages[0].content = 'modified';
    expect(original.messages[0].content).toBe('Read a file');
  });

  it.each([
    { version: 2 },
    { elapsedMs: -1 },
    { toolCalls: 0 },
    { sessionId: '../escape' },
    { apiKey: 'must-not-be-saved' },
    { messages: [] },
  ])('rejects invalid schema, counters and inline connection data (%#)', (overrides) => {
    expect(() => parseCheckpoint({ ...snapshot(), ...overrides })).toThrow();
  });

  it('rejects missing, out-of-order or orphaned tool results', () => {
    const missing = snapshot();
    missing.messages.pop();
    expect(() => parseCheckpoint(missing)).toThrow('Unbalanced');
    const orphaned = snapshot();
    orphaned.messages[2].tool_call_id = 'different';
    expect(() => parseCheckpoint(orphaned)).toThrow('Unbalanced');
    const interleaved = snapshot();
    interleaved.messages.splice(2, 0, { role: 'user', content: 'interleaving' });
    expect(() => parseCheckpoint(interleaved)).toThrow('Unbalanced');
  });

  it('rejects reused tool-call IDs across turns', () => {
    const state = snapshot();
    state.messages.push(...state.messages.slice(1));
    state.toolCalls = 2;
    expect(() => parseCheckpoint(state)).toThrow('Duplicate');
  });

  it('serializes overlapping writes for the same session and keeps the newest snapshot', async () => {
    const first = snapshot();
    const second = { ...first, elapsedMs: 20, status: 'failed' as const };
    await Promise.all([store.save(first), store.save(second)]);
    expect(await store.load(first.sessionId)).toEqual(second);
    const files = await fs.readdir(path.join(directory, 'direct-agent-checkpoints'));
    expect(files).toEqual([`${first.sessionId}.json`]);
  });

  it('keeps different sessions in separate files', async () => {
    const a = snapshot(),
      b = snapshot();
    b.messages[0].content = 'Other session';
    await Promise.all([store.save(a), store.save(b)]);
    expect((await store.load(a.sessionId)).messages[0].content).toBe('Read a file');
    expect((await store.load(b.sessionId)).messages[0].content).toBe('Other session');
  });

  it('does not follow checkpoint file or directory symlinks', async () => {
    const state = snapshot();
    await store.save(state);
    const file = path.join(directory, 'direct-agent-checkpoints', `${state.sessionId}.json`);
    const foreign = path.join(directory, 'foreign.json');
    await fs.writeFile(foreign, JSON.stringify(state));
    await fs.unlink(file);
    await fs.symlink(foreign, file);
    await expect(store.load(state.sessionId)).rejects.toThrow('could not be loaded');
    const folder = path.join(directory, 'direct-agent-checkpoints');
    await fs.rename(folder, folder + '-original');
    await fs.symlink(folder + '-original', folder);
    await expect(store.load(state.sessionId)).rejects.toThrow('could not be loaded');
    await expect(store.save(state)).rejects.toThrow('could not be saved');
  });

  it('sanitizes invalid/missing checkpoint file errors', async () => {
    const state = snapshot();
    await store.save(state);
    await fs.writeFile(
      path.join(directory, 'direct-agent-checkpoints', `${state.sessionId}.json`),
      'invalid sensitive contents'
    );
    await expect(store.load(state.sessionId)).rejects.toThrow(
      /^OpenAI-compatible: Agent checkpoint could not be loaded\.$/
    );
    await expect(store.load(randomUUID())).rejects.toThrow(
      /^OpenAI-compatible: Agent checkpoint could not be loaded\.$/
    );
  });
});
