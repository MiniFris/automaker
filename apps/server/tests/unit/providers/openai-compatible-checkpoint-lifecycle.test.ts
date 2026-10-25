import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { secureFs } from '@automaker/platform';
import type { DirectAgentCheckpoint } from '@automaker/types';
import { AgentCheckpointStore } from '../../../src/providers/openai-compatible/checkpoint.js';

const roots: string[] = [];
const releases: Array<() => void> = [];
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  releases.splice(0).forEach((release) => release());
  await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()));
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
function snapshot(): DirectAgentCheckpoint {
  return {
    version: 1,
    sessionId: randomUUID(),
    endpointId: 'offline',
    modelId: 'fixture',
    workspace: '/private-project',
    requestHash: 'a'.repeat(64),
    tools: [],
    status: 'interrupted',
    turns: 0,
    toolCalls: 0,
    outputChars: 0,
    elapsedMs: 0,
    messages: [{ role: 'user', content: 'Offline fixture' }],
  };
}
async function fixture(options?: { maxAccepted?: number; drainMs?: number }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'checkpoint-owner-'));
  roots.push(root);
  const filesystem = secureFs.createSecureFs((candidate) => {
    const resolved = path.resolve(candidate);
    if (!resolved.startsWith(root + path.sep) && resolved !== root)
      throw new Error('Outside fixture');
    return resolved;
  });
  const store = new AgentCheckpointStore(root, filesystem, options);
  cleanups.push(async () => {
    await store.close().catch(() => {});
    await filesystem.close();
  });
  return { root, filesystem, store };
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  return { promise, release };
}
it('does not overwrite corrupt checkpoints, mismatched identities or unknown read failures', async () => {
  const f = await fixture();
  const state = snapshot();
  await f.store.save(state);
  const file = path.join(f.root, 'direct-agent-checkpoints', state.sessionId + '.json');
  await fs.writeFile(file, '{broken-private-checkpoint');
  const write = vi.spyOn(f.filesystem, 'writeFile');
  await expect(f.store.save({ ...state, elapsedMs: 1 })).rejects.toThrow('could not be saved');
  expect(write).not.toHaveBeenCalled();
  expect(await fs.readFile(file, 'utf8')).toBe('{broken-private-checkpoint');
  await fs.writeFile(file, JSON.stringify(state));
  await expect(f.store.save({ ...state, workspace: '/different' })).rejects.toThrow(
    'could not be saved'
  );
  expect(write).not.toHaveBeenCalled();
  const read = vi
    .spyOn(f.filesystem, 'pipeFile')
    .mockRejectedValueOnce(Object.assign(new Error('private IO failure'), { code: 'EIO' }));
  await expect(f.store.save({ ...state, elapsedMs: 2 })).rejects.toThrow('could not be saved');
  expect(read).toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(state);
});
it('retains ambiguous rename outcomes and blocks subsequent writes and clean-close claims', async () => {
  const f = await fixture();
  const state = snapshot();
  await f.store.save(state);
  const rename = f.filesystem.rename;
  vi.spyOn(f.filesystem, 'rename').mockImplementationOnce(async (...args) => {
    await rename(...args);
    throw Object.assign(new Error('unknown acknowledgement'), { code: 'EIO' });
  });
  const updated = { ...state, elapsedMs: 1 };
  await expect(f.store.save(updated)).rejects.toThrow('could not be saved');
  const write = vi.spyOn(f.filesystem, 'writeFile');
  await expect(f.store.save({ ...state, elapsedMs: 2 })).rejects.toThrow('unavailable');
  await expect(f.store.load(state.sessionId)).rejects.toThrow('unavailable');
  expect(write).not.toHaveBeenCalled();
  expect(
    JSON.parse(
      await fs.readFile(
        path.join(f.root, 'direct-agent-checkpoints', state.sessionId + '.json'),
        'utf8'
      )
    )
  ).toEqual(updated);
  await expect(f.store.close()).rejects.toMatchObject({
    code: 'DIRECT_CHECKPOINT_OUTCOME_UNKNOWN',
  });
  await expect(f.store.close()).rejects.toMatchObject({
    code: 'DIRECT_CHECKPOINT_OUTCOME_UNKNOWN',
  });
});
it('bounds accepted work and drains complete admitted writes before closing admission', async () => {
  const f = await fixture({ maxAccepted: 1 });
  const state = snapshot();
  const held = gate(),
    entered = gate();
  const original = f.filesystem.writeFile;
  vi.spyOn(f.filesystem, 'writeFile').mockImplementationOnce(async (...args) => {
    entered.release();
    await held.promise;
    return original(...args);
  });
  const save = f.store.save(state);
  await entered.promise;
  await expect(f.store.save(snapshot())).rejects.toThrow('unavailable');
  let closed = false;
  const closing = f.store.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  held.release();
  await save;
  await closing;
  await expect(f.store.save(state)).rejects.toThrow('unavailable');
  const file = path.join(f.root, 'direct-agent-checkpoints', state.sessionId + '.json');
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(state);
  if (process.platform !== 'win32') expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  expect(await fs.readdir(path.dirname(file))).toEqual([state.sessionId + '.json']);
});
it('keeps a timed-out owner close failed even when the original accepted write settles later', async () => {
  const f = await fixture({ drainMs: 20 });
  const state = snapshot(),
    held = gate(),
    entered = gate();
  const original = f.filesystem.writeFile;
  vi.spyOn(f.filesystem, 'writeFile').mockImplementationOnce(async (...args) => {
    entered.release();
    await held.promise;
    return original(...args);
  });
  const save = f.store.save(state);
  await entered.promise;
  try {
    await expect(f.store.close()).rejects.toMatchObject({
      code: 'DIRECT_CHECKPOINT_OUTCOME_UNKNOWN',
    });
  } finally {
    held.release();
    await save;
  }
  await expect(f.store.close()).rejects.toMatchObject({
    code: 'DIRECT_CHECKPOINT_OUTCOME_UNKNOWN',
  });
  await expect(f.store.save(state)).rejects.toThrow('unavailable');
});
