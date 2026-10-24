import { mkdir, mkdtemp, readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { AgentSessionRepository } from '../../src/services/agent/agent-session.repository.js';
import { AgentQueueDeliveryStore } from '../../src/services/agent/agent-queue-delivery-store.js';
import { AgentExecutionStore } from '../../src/services/agent/agent-execution-store.js';
import { AgentSessionDeletion } from '../../src/services/agent/agent-session-deletion.js';
import { AgentSessionStorageError } from '../../src/services/agent/agent-session-storage.error.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/security.module.js';
import { AgentStateModule } from '../../src/modules/agents/agent-state.module.js';
import { AutoModeServiceCompat } from '../../src/services/auto-mode/index.js';
import type { Message } from '../../src/services/agent/agent-session.types.js';

let root: string;
const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'automaker-native-agent-fs-'));
});
afterEach(async () => {
  const closed = await Promise.allSettled(apps.splice(0).map((owner) => owner.app.close()));
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
  for (const result of closed) if (result.status === 'rejected') throw result.reason;
});
async function start(name: string) {
  const directory = path.join(root, name),
    data = path.join(directory, 'data');
  await mkdir(directory, { recursive: true });
  const owner = await createNestApplication({
    workingDirectory: directory,
    dataDir: data,
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: { NODE_ENV: 'test', ALLOWED_ROOT_DIRECTORY: directory },
  });
  apps.push(owner);
  const repository = owner.app.get(AgentSessionRepository);
  await repository.initialize();
  return {
    ...owner,
    directory,
    data,
    repository,
    deliveries: owner.app.get(AgentQueueDeliveryStore),
    runs: owner.app.get(AgentExecutionStore),
    filesystem: owner.app.get(SECURE_FILESYSTEM),
  };
}
const message = (content: string): Message => ({
  id: content,
  role: 'user',
  content,
  timestamp: 'owned-fixture',
});
async function metadata(owner: Awaited<ReturnType<typeof start>>, id: string) {
  await owner.repository.addMetadata({
    id,
    name: id,
    workingDirectory: owner.directory,
    createdAt: 'owned',
    updatedAt: 'owned',
  });
}

it('injects distinct scoped owners for repository, delivery and execution storage', async () => {
  const one = await start('one'),
    two = await start('two');
  for (const owner of [one, two])
    for (const store of [owner.repository, owner.deliveries, owner.runs])
      expect((store as unknown as { filesystem: unknown }).filesystem).toBe(owner.filesystem);
  await one.repository.saveMessages('same-session', [message('one')]);
  await two.repository.saveMessages('same-session', [message('two')]);
  const foreign = new AgentSessionRepository(two.data, one.filesystem);
  await expect(foreign.loadMessages('same-session')).rejects.toBeInstanceOf(
    AgentSessionStorageError
  );
  await expect(foreign.saveMessages('same-session', [message('forbidden')])).rejects.toBeInstanceOf(
    AgentSessionStorageError
  );
  expect((await two.repository.loadMessages('same-session'))[0].content).toBe('two');
  await one.app.close();
  await expect(
    one.repository.saveMessages('same-session', [message('late')])
  ).rejects.toBeInstanceOf(AgentSessionStorageError);
  await two.repository.saveMessages('same-session', [message('still-two')]);
  expect((await two.repository.loadMessages('same-session'))[0].content).toBe('still-two');
});

it.skipIf(process.platform === 'win32')(
  'rejects cross-root symlink reads and journal directories without touching the target',
  async () => {
    const one = await start('symlink-one'),
      two = await start('symlink-two');
    await two.repository.saveMessages('target-session', [message('private target')]);
    const target = path.join(two.data, 'agent-sessions', 'target-session.json');
    const before = await readFile(target, 'utf8');
    await symlink(target, path.join(one.data, 'agent-sessions', 'linked-session.json'));
    await expect(one.repository.loadMessages('linked-session')).rejects.toBeInstanceOf(
      AgentSessionStorageError
    );
    const foreignDirectory = path.join(two.data, 'foreign-journals');
    await mkdir(foreignDirectory);
    await symlink(foreignDirectory, path.join(one.data, 'agent-executions'));
    await expect(
      one.runs.begin('linked-session', message('must not write'))
    ).rejects.toBeInstanceOf(AgentSessionStorageError);
    expect(await readdir(foreignDirectory)).toEqual([]);
    expect(await readFile(target, 'utf8')).toBe(before);
  }
);

it('preserves committed-backup, authoritative absence and cold journal no-replay semantics', async () => {
  const owner = await start('recovery');
  await metadata(owner, 'queue-session');
  await metadata(owner, 'execution-session');
  await owner.repository.saveMessages('history-session', [message('backup')]);
  await owner.repository.saveMessages('history-session', [message('current')]);
  const file = path.join(owner.data, 'agent-sessions', 'history-session.json');
  await writeFile(file, '{corrupt-main');
  expect((await owner.repository.loadMessages('history-session'))[0].content).toBe('backup');
  expect(await readFile(file, 'utf8')).toBe('{corrupt-main');
  await rm(file);
  expect(await owner.repository.loadMessages('history-session')).toEqual([]);
  const prompt = { id: 'pending-prompt', message: 'Do not replay', addedAt: 'owned' };
  await owner.repository.saveQueue('queue-session', [prompt]);
  await owner.deliveries.claim('queue-session', prompt);
  await owner.runs.begin('execution-session', message('Interrupted request'));
  await owner.app.close();
  const restarted = await start('recovery');
  await restarted.deliveries.recover('queue-session');
  await restarted.deliveries.recover('queue-session');
  expect(await restarted.repository.loadQueue('queue-session')).toMatchObject([
    { id: prompt.id, deliveryStatus: 'interrupted' },
  ]);
  await restarted.runs.recover('execution-session');
  await restarted.runs.recover('execution-session');
  const recovered = await restarted.repository.loadMessages('execution-session');
  expect(recovered.filter((item) => item.role === 'user')).toHaveLength(1);
  expect(recovered.find((item) => item.role === 'user')).toMatchObject({
    content: 'Interrupted request',
    executionStatus: 'interrupted',
  });
  expect(recovered.filter((item) => item.role === 'assistant')).toHaveLength(1);
});

it('fails closed on scoped IO/commit failures and deletes only owned tombstoned artifacts', async () => {
  const owner = await start('errors');
  const id = 'deleted-session';
  await metadata(owner, id);
  await owner.repository.saveMessages(id, [message('first')]);
  await owner.repository.saveMessages(id, [message('second')]);
  const file = path.join(owner.data, 'agent-sessions', id + '.json'),
    before = await readFile(file, 'utf8');
  const read = owner.filesystem.readFile.bind(owner.filesystem);
  const io = vi
    .spyOn(owner.filesystem, 'readFile')
    .mockImplementation((candidate, ...args) =>
      candidate === file
        ? Promise.reject(Object.assign(new Error('private IO fixture'), { code: 'EIO' }))
        : read(candidate, ...args)
    );
  await expect(owner.repository.loadMessages(id)).rejects.toBeInstanceOf(AgentSessionStorageError);
  io.mockRestore();
  const rename = owner.filesystem.rename.bind(owner.filesystem);
  const failed = vi
    .spyOn(owner.filesystem, 'rename')
    .mockImplementation((from, to) =>
      to === file
        ? Promise.reject(Object.assign(new Error('private commit fixture'), { code: 'EIO' }))
        : rename(from, to)
    );
  await expect(
    owner.repository.saveMessages(id, [message('must not commit')])
  ).rejects.toBeInstanceOf(AgentSessionStorageError);
  failed.mockRestore();
  expect(await readFile(file, 'utf8')).toBe(before);
  const lookalike = path.join(owner.data, 'agent-sessions', id + '-other.json');
  await writeFile(lookalike, 'preserve unrelated fixture');
  await owner.app.get(AgentSessionDeletion).remove(id);
  expect((await owner.repository.deletionState(id))?.phase).toBe('deleted');
  expect(await owner.repository.loadMessages(id)).toEqual([]);
  expect(await readFile(lookalike, 'utf8')).toBe('preserve unrelated fixture');
  expect(
    (await readdir(path.dirname(file))).some(
      (name) =>
        name === id + '.json' ||
        name.startsWith(id + '.json.bak') ||
        name.startsWith(id + '.json.tmp.')
    )
  ).toBe(false);
  await expect(owner.repository.saveMessages(id, [message('resurrection')])).rejects.toThrow(
    'deleted'
  );
});

it('orders producer final journal settlement and downstream drain before scoped filesystem close', async () => {
  const owner = await start('shutdown');
  const id = 'shutdown-session';
  await metadata(owner, id);
  const run = await owner.runs.begin(id, message('owned final request'));
  const order: string[] = [];
  const runtime = owner.app.get(AutoModeServiceCompat),
    mark = runtime.markAllRunningFeaturesInterrupted.bind(runtime);
  vi.spyOn(runtime, 'markAllRunningFeaturesInterrupted').mockImplementation(async (reason) => {
    await mark(reason);
    await owner.runs.complete(run, [run.userMessage!], 'cancelled');
    order.push('producer-final');
  });
  const storage = owner.app.get(AgentStateModule),
    drain = storage.beforeApplicationShutdown.bind(storage);
  vi.spyOn(storage, 'beforeApplicationShutdown').mockImplementation(async () => {
    expect(order).toEqual(['producer-final']);
    await drain();
    order.push('stores-drained');
  });
  const close = owner.filesystem.close.bind(owner.filesystem);
  vi.spyOn(owner.filesystem, 'close').mockImplementation(async () => {
    expect(order).toEqual(['producer-final', 'stores-drained']);
    const journal = JSON.parse(
      await readFile(path.join(owner.data, 'agent-executions', id + '.json'), 'utf8')
    );
    expect(journal).toMatchObject({ phase: 'settled', status: 'cancelled' });
    order.push('filesystem-close');
    return close();
  });
  await owner.app.close();
  expect(order).toEqual(['producer-final', 'stores-drained', 'filesystem-close']);
  const messages = JSON.parse(
    await readFile(path.join(owner.data, 'agent-sessions', id + '.json'), 'utf8')
  );
  expect(messages).toMatchObject([{ executionStatus: 'cancelled' }]);
});

it('keeps downstream repository storage open while an accepted terminal journal commit drains', async () => {
  const owner = await start('accepted-drain'),
    id = 'accepted-session';
  await metadata(owner, id);
  const run = await owner.runs.begin(id, message('accepted request'));
  const journal = path.join(owner.data, 'agent-executions', id + '.json');
  const rename = owner.filesystem.rename.bind(owner.filesystem);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const renameSpy = vi.spyOn(owner.filesystem, 'rename').mockImplementation(async (from, to) => {
    if (to === journal) await held;
    return rename(from, to);
  });
  const accepted = owner.runs.complete(run, [run.userMessage!], 'completed');
  await vi.waitFor(() => expect(renameSpy).toHaveBeenCalled());
  const module = owner.app.get(AgentStateModule),
    drain = module.beforeApplicationShutdown.bind(module);
  let draining = false;
  vi.spyOn(module, 'beforeApplicationShutdown').mockImplementation(async () => {
    draining = true;
    await drain();
  });
  const repositoryDrain = vi.spyOn(owner.repository, 'drain');
  const close = vi.spyOn(owner.filesystem, 'close');
  const closing = owner.app.close();
  await vi.waitFor(() => expect(draining).toBe(true));
  expect(repositoryDrain).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  release();
  await accepted;
  await closing;
  expect(repositoryDrain).toHaveBeenCalled();
  expect(JSON.parse(await readFile(journal, 'utf8'))).toMatchObject({
    phase: 'settled',
    status: 'completed',
  });
  expect(
    JSON.parse(await readFile(path.join(owner.data, 'agent-sessions', id + '.json'), 'utf8'))
  ).toMatchObject([{ executionStatus: 'completed' }]);
});
