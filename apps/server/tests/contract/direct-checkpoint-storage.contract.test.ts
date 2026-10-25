import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { secureFs } from '@automaker/platform';
import type { DirectAgentCheckpoint, ExecuteOptions } from '@automaker/types';
import { toDirectModelId } from '@automaker/types';
import { createNestApplication } from '../../src/main.js';
import { DirectCheckpointRepository } from '../../src/modules/providers/direct-checkpoint.repository.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/security.module.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { SimpleContextQueryAdapter } from '../../src/modules/context/simple-context-query.adapter.js';
import { MockProvider } from '../helpers/mock-provider.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';

const owners: Array<{
  owner: Awaited<ReturnType<typeof createNestApplication>>;
  expectedCloseFailure?: boolean;
}> = [];
const roots: string[] = [];
const releases: Array<() => void> = [];
afterEach(async () => {
  releases.splice(0).forEach((release) => release());
  const results = await Promise.allSettled(
    owners.splice(0).map(async (entry) => {
      try {
        await entry.owner.app.close();
      } catch (error) {
        if (!entry.expectedCloseFailure) throw error;
      }
    })
  );
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
});
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  return { promise, release };
}
function snapshot(sessionId: string, workspace: string, content: string): DirectAgentCheckpoint {
  return {
    version: 1,
    sessionId,
    endpointId: 'offline',
    modelId: 'fixture',
    workspace,
    requestHash: 'a'.repeat(64),
    tools: [],
    status: 'interrupted',
    turns: 0,
    toolCalls: 0,
    outputChars: 0,
    elapsedMs: 0,
    messages: [{ role: 'user', content }],
  };
}
async function fixture(
  name: string,
  execute?: (
    options: ExecuteOptions
  ) => AsyncGenerator<import('../../src/providers/types.js').ProviderMessage>
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `native-checkpoint-${name}-`));
  roots.push(root);
  class OfflineProvider extends MockProvider {
    protected execute(options: ExecuteOptions) {
      return execute ? execute(options) : super.execute(options);
    }
  }
  const owner = await createNestApplication({
    workingDirectory: root,
    dataDir: path.join(root, 'data'),
    environment: {
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: '0',
      HOME: root,
      PATH: '/usr/bin:/bin',
      ALLOWED_ROOT_DIRECTORY: root,
      AUTOMAKER_API_KEY: 'fixture-secret',
      ENABLE_REQUEST_LOGGING: 'false',
    },
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [
      { name: 'openai-compatible', create: () => new OfflineProvider('openai-compatible') },
    ],
  });
  const entry = { owner, expectedCloseFailure: false };
  owners.push(entry);
  await owner.start();
  await owner.app.get(SettingsService).updateGlobalSettings({
    openaiCompatibleEndpoints: [
      {
        id: 'offline',
        name: 'Offline',
        enabled: true,
        baseUrl: 'http://127.0.0.1:9/v1',
        protocol: 'chat-completions',
        auth: { type: 'none' },
        models: [
          {
            id: 'fixture',
            displayName: 'Offline fixture',
            capabilities: { tools: false, streaming: false },
          },
        ],
      },
    ],
  });
  return {
    root,
    owner,
    entry,
    repository: owner.app.get(DirectCheckpointRepository),
    filesystem: owner.app.get<ReturnType<typeof secureFs.createSecureFs>>(SECURE_FILESYSTEM),
  };
}
const query = (f: Awaited<ReturnType<typeof fixture>>) =>
  f.owner.app.get(SimpleContextQueryAdapter).execute({
    prompt: 'Offline fixture',
    cwd: f.root,
    model: toDirectModelId('fixture'),
    providerId: 'offline',
    settingsService: f.owner.app.get(SettingsService),
    allowedTools: [],
  });

it('keeps same-session checkpoints isolated between native apps despite hostile global filesystem functions', async () => {
  const sessionId = randomUUID();
  let firstState!: DirectAgentCheckpoint, secondState!: DirectAgentCheckpoint;
  const first = await fixture('first', async function* (options) {
    await options.openaiCompatibleAgent!.onCheckpoint!(firstState);
    yield {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'first' }] },
    };
  });
  const second = await fixture('second', async function* (options) {
    await options.openaiCompatibleAgent!.onCheckpoint!(secondState);
    yield {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'second' }] },
    };
  });
  firstState = snapshot(sessionId, first.root, 'first');
  secondState = snapshot(sessionId, second.root, 'second');
  // Mutate only the global adapter, not either app's independently created filesystem.
  const globalMkdir = vi
    .spyOn(secureFs, 'mkdir')
    .mockRejectedValue(new Error('Hostile global filesystem policy'));
  await expect(secureFs.mkdir(path.join(first.root, 'global-probe'))).rejects.toThrow(
    'Hostile global'
  );
  expect((await query(first)).text).toBe('first');
  expect((await query(second)).text).toBe('second');
  expect(await first.repository.load(sessionId)).toEqual(firstState);
  expect(await second.repository.load(sessionId)).toEqual(secondState);
  expect(globalMkdir).toHaveBeenCalledTimes(1);
});

it('admits a provider final checkpoint during app.close and drains its held native write before the filesystem barrier', async () => {
  const running = gate(),
    writeEntered = gate(),
    writeRelease = gate();
  const sessionId = randomUUID();
  let state!: DirectAgentCheckpoint;
  let finalized = false;
  let finalizations = 0;
  const f = await fixture('final-save', async function* (options) {
    try {
      running.release();
      await new Promise<void>((resolve) => {
        if (options.abortController!.signal.aborted) resolve();
        else
          options.abortController!.signal.addEventListener('abort', () => resolve(), {
            once: true,
          });
      });
    } finally {
      await options.openaiCompatibleAgent!.onCheckpoint!(state);
      finalized = true;
      finalizations++;
    }
    yield {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'cancelled' }] },
    };
  });
  state = snapshot(sessionId, f.root, 'accepted-final-save');
  const original = f.filesystem.writeFile;
  vi.spyOn(f.filesystem, 'writeFile').mockImplementation(async (...args) => {
    if (String(args[0]).includes('direct-agent-checkpoints')) {
      writeEntered.release();
      await writeRelease.promise;
    }
    return original(...args);
  });
  const barrier = vi.spyOn(f.filesystem, 'close');
  const registry = f.owner.app.get(ProviderRegistry);
  const providerHook = vi.spyOn(registry, 'onApplicationShutdown');
  const scopeDisposal = vi.spyOn(
    (registry as unknown as { executions: { dispose(): Promise<void> } }).executions,
    'dispose'
  );
  const pending = query(f);
  void pending.catch(() => {});
  await running.promise;
  let closed = false;
  const close = f.owner.app.close().then(() => {
    closed = true;
  });
  await writeEntered.promise;
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(closed).toBe(false);
  expect(finalized).toBe(false);
  expect(barrier).not.toHaveBeenCalled();
  writeRelease.release();
  await close;
  await pending.catch(() => {});
  expect(finalized).toBe(true);
  expect(finalizations).toBe(1);
  expect(providerHook).toHaveBeenCalledOnce();
  expect(scopeDisposal).toHaveBeenCalledOnce();
  expect(scopeDisposal.mock.invocationCallOrder[0]).toBeLessThan(
    barrier.mock.invocationCallOrder[0]
  );
  const drained = registry.close();
  expect(registry.close()).toBe(drained);
  await drained;
  await registry.onApplicationShutdown();
  expect(scopeDisposal).toHaveBeenCalledOnce();
  expect(finalizations).toBe(1);
  expect(barrier).toHaveBeenCalledOnce();
  expect(
    JSON.parse(
      await fs.readFile(
        path.join(f.root, 'data/direct-agent-checkpoints', sessionId + '.json'),
        'utf8'
      )
    )
  ).toEqual(state);
  await expect(f.repository.save(state)).rejects.toThrow('unavailable');
});

it('fails closed after an ambiguous native rename and still executes the application filesystem barrier', async () => {
  const f = await fixture('ambiguous');
  const state = snapshot(randomUUID(), f.root, 'original');
  await f.repository.save(state);
  const original = f.filesystem.rename;
  vi.spyOn(f.filesystem, 'rename').mockImplementationOnce(async (...args) => {
    await original(...args);
    throw Object.assign(new Error('private unknown acknowledgement'), { code: 'EIO' });
  });
  const updated = { ...state, elapsedMs: 1 };
  await expect(f.repository.save(updated)).rejects.toThrow('could not be saved');
  const write = vi.spyOn(f.filesystem, 'writeFile');
  await expect(f.repository.save({ ...state, elapsedMs: 2 })).rejects.toThrow('unavailable');
  expect(write).not.toHaveBeenCalled();
  const barrier = vi.spyOn(f.filesystem, 'close');
  f.entry.expectedCloseFailure = true;
  await expect(f.owner.app.close()).rejects.toMatchObject({ code: 'APPLICATION_CLEANUP_FAILED' });
  expect(barrier).toHaveBeenCalledOnce();
  await expect(f.owner.app.close()).rejects.toMatchObject({ code: 'APPLICATION_CLEANUP_FAILED' });
  expect(
    JSON.parse(
      await fs.readFile(
        path.join(f.root, 'data/direct-agent-checkpoints', state.sessionId + '.json'),
        'utf8'
      )
    )
  ).toEqual(updated);
});

it('drains already accepted checkpoint writes even if provider shutdown fails', async () => {
  const f = await fixture('provider-failure');
  const state = snapshot(randomUUID(), f.root, 'accepted-before-failure');
  const entered = gate(),
    release = gate();
  const original = f.filesystem.writeFile;
  vi.spyOn(f.filesystem, 'writeFile').mockImplementationOnce(async (...args) => {
    entered.release();
    await release.promise;
    return original(...args);
  });
  const saving = f.repository.save(state);
  await entered.promise;
  const providerClose = vi
    .spyOn(f.owner.app.get(ProviderRegistry), 'close')
    .mockRejectedValue(new Error('offline provider close uncertainty'));
  const barrier = vi.spyOn(f.filesystem, 'close');
  f.entry.expectedCloseFailure = true;
  const close = f.owner.app.close();
  void close.catch(() => {});
  await vi.waitFor(() => expect(providerClose).toHaveBeenCalled());
  expect(barrier).not.toHaveBeenCalled();
  release.release();
  await saving;
  await expect(close).rejects.toMatchObject({ code: 'APPLICATION_CLEANUP_FAILED' });
  expect(barrier).toHaveBeenCalledOnce();
  expect(
    JSON.parse(
      await fs.readFile(
        path.join(f.root, 'data/direct-agent-checkpoints', state.sessionId + '.json'),
        'utf8'
      )
    )
  ).toEqual(state);
});
