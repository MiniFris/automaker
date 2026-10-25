import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/security.module.js';
import { IssueValidationRepository } from '../../src/modules/github/issue-validation.repository.js';
import { IssueValidationRegistry } from '../../src/modules/github/issue-validation-registry.service.js';
import { IssueValidationService } from '../../src/modules/github/issue-validation.service.js';
import { EVENT_BUS } from '../../src/core/eventing/event-bus.js';
import type { StoredValidation } from '../../src/lib/validation-storage.js';

let root: string;
const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'validation-native-fs-'));
});
afterEach(async () => {
  const closed = await Promise.allSettled(apps.splice(0).map((owner) => owner.app.close()));
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
  for (const result of closed) if (result.status === 'rejected') throw result.reason;
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const value = (issueTitle = 'Original'): StoredValidation => ({
  issueNumber: 12,
  issueTitle,
  validatedAt: new Date().toISOString(),
  model: 'haiku',
  result: { verdict: 'valid', confidence: 'high', reasoning: 'Offline storage fixture' },
});
const file = (project: string) =>
  path.join(project, '.automaker', 'validations', '12', 'validation.json');
async function start(name: string) {
  const project = path.join(root, name);
  await mkdir(project);
  const owner = await createNestApplication({
    workingDirectory: project,
    dataDir: path.join(project, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      NODE_ENV: 'test',
      AUTOMAKER_API_KEY: 'fixture',
      ALLOWED_ROOT_DIRECTORY: project,
    },
  });
  apps.push(owner);
  return {
    ...owner,
    project,
    repository: owner.app.get(IssueValidationRepository),
    registry: owner.app.get(IssueValidationRegistry),
    filesystem: owner.app.get(SECURE_FILESYSTEM),
  };
}

it('isolates native roots and serializes aliases with read/mutation transactions', async () => {
  const one = await start('one'),
    two = await start('two');
  expect((one.repository as unknown as { filesystem: unknown }).filesystem).toBe(one.filesystem);
  await one.repository.write(one.project, 12, value());
  expect(await two.repository.get(two.project, 12)).toBeNull();
  await expect(one.repository.get(two.project, 12)).rejects.toThrow();
  const alias = path.join(one.project, 'alias');
  await symlink(one.project, alias, 'dir');
  const held = deferred(),
    entered = deferred();
  const rename = one.filesystem.rename.bind(one.filesystem);
  const fault = vi.spyOn(one.filesystem, 'rename').mockImplementation(async (from, to) => {
    if (to === file(one.project)) {
      entered.resolve();
      await held.promise;
    }
    return rename(from, to);
  });
  const write = one.repository.write(one.project, 12, value('Updated'));
  await entered.promise;
  let viewed = false;
  const mark = one.repository.markViewed(alias, 12).then((result) => {
    viewed = true;
    return result;
  });
  await Promise.resolve();
  expect(viewed).toBe(false);
  held.resolve();
  await write;
  expect(await mark).toBe(true);
  fault.mockRestore();
  expect((await one.repository.get(alias, 12))?.validation).toMatchObject({
    issueTitle: 'Updated',
    viewedAt: expect.any(String),
  });
  await one.app.close();
  await two.repository.write(two.project, 12, value('Other application'));
  expect((await two.repository.list(two.project))[0]?.issueTitle).toBe('Other application');
});

it('rejects escaped symlinks, corrupt state and EIO without false absence or partial commits', async () => {
  const one = await start('errors'),
    two = await start('outside');
  await symlink(two.project, path.join(one.project, 'escape'), 'dir');
  await expect(
    one.repository.write(path.join(one.project, 'escape'), 12, value())
  ).rejects.toThrow();
  await one.repository.write(one.project, 12, value());
  const original = await readFile(file(one.project), 'utf8');
  await writeFile(file(one.project), 'null');
  await expect(one.repository.markViewed(one.project, 12)).rejects.toThrow('malformed');
  await expect(one.repository.list(one.project)).rejects.toThrow('malformed');
  expect(await readFile(file(one.project), 'utf8')).toBe('null');
  await writeFile(file(one.project), original);
  const error = Object.assign(new Error('Owned EIO fixture'), { code: 'EIO' });
  const events: unknown[] = [];
  one.app
    .get(EVENT_BUS)
    .subscribe('issue-validation:event', (event: unknown) => events.push(event));
  const service = one.app.get(IssueValidationService);
  for (const method of ['readFile', 'readdir', 'rm', 'rename'] as const) {
    const fault = vi.spyOn(one.filesystem, method).mockRejectedValue(error);
    const operation =
      method === 'readFile'
        ? one.repository.markViewed(one.project, 12)
        : method === 'readdir'
          ? one.repository.list(one.project)
          : method === 'rm'
            ? one.repository.delete(one.project, 12)
            : service.markViewed({ projectPath: one.project, issueNumber: 12 });
    await expect(operation).rejects.toMatchObject({ code: 'EIO' });
    fault.mockRestore();
    expect(await readFile(file(one.project), 'utf8')).toBe(original);
    expect(events).toEqual([]);
  }
  expect(await service.markViewed({ projectPath: one.project, issueNumber: 12 })).toEqual({
    success: true,
  });
  expect(events).toEqual([
    { type: 'issue_validation_viewed', projectPath: one.project, issueNumber: 12 },
  ]);
});

it('allows a registry producer final commit, then drains repository before native filesystem close', async () => {
  const owner = await start('shutdown');
  const producer = deferred(),
    entered = deferred(),
    commit = deferred(),
    writing = deferred();
  const order: string[] = [];
  const rename = owner.filesystem.rename.bind(owner.filesystem);
  vi.spyOn(owner.filesystem, 'rename').mockImplementation(async (from, to) => {
    if (to === file(owner.project)) {
      writing.resolve();
      await commit.promise;
    }
    return rename(from, to);
  });
  let signal!: AbortSignal;
  owner.registry.start(owner.project, 12, async (controller) => {
    signal = controller.signal;
    entered.resolve();
    await producer.promise;
    await owner.repository.write(owner.project, 12, value('Final accepted result'));
    order.push('producer-committed');
  });
  await entered.promise;
  const drain = owner.repository.beforeApplicationShutdown.bind(owner.repository);
  vi.spyOn(owner.repository, 'beforeApplicationShutdown').mockImplementation(async () => {
    await drain();
    order.push('repository-drained');
  });
  const close = owner.filesystem.close.bind(owner.filesystem);
  const filesystemClosed = vi.spyOn(owner.filesystem, 'close').mockImplementation(async () => {
    expect(order).toEqual(['producer-committed', 'repository-drained']);
    order.push('filesystem-closed');
    return close();
  });
  const closing = owner.app.close();
  await vi.waitFor(() => expect(signal.aborted).toBe(true));
  producer.resolve();
  await writing.promise;
  expect(filesystemClosed).not.toHaveBeenCalled();
  commit.resolve();
  await closing;
  expect(order.at(-1)).toBe('filesystem-closed');
  expect(JSON.parse(await readFile(file(owner.project), 'utf8')).issueTitle).toBe(
    'Final accepted result'
  );
  await expect(owner.repository.get(owner.project, 12)).rejects.toMatchObject({ statusCode: 503 });
  await expect(owner.repository.write(owner.project, 12, value())).rejects.toThrow();
});
