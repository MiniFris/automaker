import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { ExecutionEnvironmentBinding } from '@automaker/types';
import { parseFrontmatter } from '@automaker/utils';
import { LocalExecutionEnvironment } from '@/services/execution-environment/local.js';
import { RuntimeMemoryStore } from '@/services/execution-environment/memory.js';
import { MEMORY_WORKER } from '@/services/execution-environment/memory-worker.js';
import { nodeCommand } from '@/services/execution-environment/ssh-transport.js';
import { FeatureWorkspaceService } from '@/services/execution-environment/feature-workspace.js';
import { SettingsService } from '@/services/settings-service.js';

describe.skipIf(process.platform !== 'linux')('pinned runtime project memory on real files', () => {
  let root: string, cwd: string, environment: LocalExecutionEnvironment;
  let store: RuntimeMemoryStore, binding: ExecutionEnvironmentBinding;
  const active = () => new AbortController().signal;
  const learning = {
    category: 'Architecture',
    type: 'decision' as const,
    content: 'Prefer immutable workspace bindings',
    context: 'Concurrent feature processes',
    why: 'Prevent accidental controller writes',
  };
  const file = () => path.join(root, '.automaker', 'memory', 'architecture.md');
  const stat = async () => parseFrontmatter(await fs.readFile(file(), 'utf8')).metadata.usageStats;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-memory-'quoted-"));
    cwd = path.join(root, '.worktrees', 'feature');
    await fs.mkdir(cwd, { recursive: true });
    environment = await LocalExecutionEnvironment.create(cwd);
    binding = {
      version: 1,
      id: 'a'.repeat(64),
      type: 'local',
      projectPath: root,
      cwd: root,
      runtimeCwd: cwd,
      createdAt: new Date().toISOString(),
      serverIdentity: 'fixture',
      selection: { mode: 'auto' },
      source: 'global',
      fallbackReason: 'docker-preflight-unavailable',
    };
    store = new RuntimeMemoryStore(environment, binding);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });
  it('reads absent memory without side effects, creates learnings in the project root, not the feature worktree', async () => {
    expect(await store.load(active())).toEqual([]);
    await expect(fs.stat(path.join(root, '.automaker'))).rejects.toThrow();
    await store.writer(active()).appendLearning(learning);
    const loaded = await store.load(active());
    expect(loaded).toEqual([
      expect.objectContaining({ name: 'architecture.md', path: file(), category: 'architecture' }),
    ]);
    expect(loaded[0].content).toContain(learning.why);
    expect(loaded[0].content).not.toContain('usageStats:');
    await expect(fs.stat(path.join(cwd, '.automaker'))).rejects.toThrow();
  });
  it('keeps metadata/body/mode and updates referenced and successful counts in one file replacement', async () => {
    await store.appendLearning(learning, active());
    await fs.chmod(file(), 0o660);
    const loaded = await store.load(active());
    await store.recordLoaded([...loaded, ...loaded], active());
    await store.recordUsage(loaded, learning.content, true, active());
    await store.recordUsage(loaded, learning.content, false, active());
    await store.recordUsage(loaded, 'Unrelated response', true, active());
    expect(await stat()).toEqual({ loaded: 1, referenced: 2, successfulFeatures: 1 });
    expect((await fs.stat(file())).mode & 0o777).toBe(0o660);
    expect(await fs.readFile(file(), 'utf8')).toContain(learning.content);
    expect(await fs.readdir(path.dirname(file()))).toEqual(['architecture.md']);
  });
  it('serializes simultaneous writers from separate store instances sharing a root', async () => {
    const second = new RuntimeMemoryStore(environment, binding);
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        (i % 2 ? second : store).appendLearning({ ...learning, content: `Learning ${i}` }, active())
      )
    );
    const content = await fs.readFile(file(), 'utf8');
    for (let i = 0; i < 8; i++) expect(content).toContain(`Learning ${i}`);
    const loaded = await store.load(active());
    await Promise.all([
      store.recordLoaded(loaded, active()),
      second.recordLoaded(loaded, active()),
    ]);
    expect((await stat()).loaded).toBe(2);
  });
  it('does not resurrect memory removed after context loading', async () => {
    await store.appendLearning(learning, active());
    const loaded = await store.load(active());
    await fs.unlink(file());
    await store.recordLoaded(loaded, active());
    await store.recordUsage(loaded, learning.content, true, active());
    await expect(fs.stat(file())).rejects.toThrow();
  });
  it('refuses stale compare-and-write without overwriting or retrying', async () => {
    await store.appendLearning(learning, active());
    const run = async (request: object) => {
      const result = await environment.exec(
        nodeCommand(MEMORY_WORKER, [JSON.stringify({ ...request, root })]),
        active()
      );
      return JSON.parse(result.output);
    };
    const snapshot = (await run({ action: 'read', name: 'architecture.md' })).result;
    await fs.writeFile(file(), 'Changed by another writer');
    expect(
      await run({ action: 'write', name: 'architecture.md', expected: snapshot.sha256, data: '' })
    ).toMatchObject({ ok: false, code: 'MEMORY_CONFLICT' });
    expect(await fs.readFile(file(), 'utf8')).toBe('Changed by another writer');
    expect(await fs.readdir(path.dirname(file()))).toEqual(['architecture.md']);
  });
  it('blocks a target-side writer lock and never clears someone else’s or an interrupted lock', async () => {
    await store.appendLearning(learning, active());
    const lock = path.join(path.dirname(file()), '.automaker-memory.lock');
    await fs.writeFile(lock, 'other writer');
    const previous = await fs.readFile(file());
    await expect(store.appendLearning(learning, active())).rejects.toMatchObject({
      code: 'MEMORY_BUSY',
    });
    expect(await fs.readFile(lock, 'utf8')).toBe('other writer');
    expect(await fs.readFile(file())).toEqual(previous);
  });
  it.each([
    '../outside.md',
    '/tmp/outside.md',
    'nested/file.md',
    '_index.md',
    'index.txt',
    'bad\\path.md',
  ])('refuses a non-category memory path %s', async (name) => {
    await expect(store.recordLoaded([{ name, content: '' }], active())).rejects.toMatchObject({
      code: 'MEMORY_PATH_INVALID',
    });
  });
  it('sanitizes model category names without interpreting shell/path content', async () => {
    await store.appendLearning(
      {
        ...learning,
        category: '../../$(touch escaped)',
        content: 'Literal `$(touch leaked)` content',
      },
      active()
    );
    const loaded = await store.load(active());
    expect(loaded[0].name).toBe('touch-escaped.md');
    expect(loaded[0].content).toContain('$(touch leaked)');
    await expect(fs.stat(path.join(cwd, 'leaked'))).rejects.toThrow();
    await expect(fs.stat(path.join(cwd, 'escaped'))).rejects.toThrow();
  });
  it.each(['category', 'file'] as const)(
    'refuses %s symlinks without touching their destination',
    async (kind) => {
      const outside = path.join(root, 'outside');
      await fs.mkdir(outside);
      await fs.writeFile(path.join(outside, 'architecture.md'), 'do not touch');
      await fs.mkdir(path.join(root, '.automaker'), { recursive: true });
      if (kind === 'category') await fs.symlink(outside, path.dirname(file()));
      else {
        await fs.mkdir(path.dirname(file()));
        await fs.symlink(path.join(outside, 'architecture.md'), file());
      }
      await expect(store.appendLearning(learning, active())).rejects.toMatchObject({
        code: 'MEMORY_PATH_INVALID',
      });
      expect(await fs.readFile(path.join(outside, 'architecture.md'), 'utf8')).toBe('do not touch');
    }
  );
  it('refuses invalid UTF-8 and oversized memory without replacing it', async () => {
    await fs.mkdir(path.dirname(file()), { recursive: true });
    await fs.writeFile(file(), Buffer.from([255, 128]));
    await expect(store.load(active())).rejects.toThrow('UTF-8');
    await fs.writeFile(file(), 'x'.repeat(32769));
    await expect(store.load(active())).rejects.toMatchObject({ code: 'MEMORY_BUDGET' });
    await expect(store.appendLearning(learning, active())).rejects.toMatchObject({
      code: 'MEMORY_BUDGET',
    });
    expect((await fs.stat(file())).size).toBe(32769);
  });
  it('applies the shared context budget before writing any loaded statistics', async () => {
    await store.appendLearning(learning, active());
    await fs.writeFile(path.join(cwd, 'AGENTS.md'), 'x'.repeat(32768));
    await fs.writeFile(path.join(cwd, 'CLAUDE.md'), 'x'.repeat(32768));
    const service = new FeatureWorkspaceService(new SettingsService(path.join(root, 'data')));
    await expect(service.context({ binding, environment }, active())).rejects.toMatchObject({
      code: 'MEMORY_BUDGET',
    });
    expect((await stat()).loaded).toBe(0);
  });
  it('propagates transport/protocol failure once without a retry or fallback', async () => {
    const exec = vi
      .spyOn(environment, 'exec')
      .mockRejectedValueOnce(new Error('unknown remote outcome'));
    await expect(store.load(active())).rejects.toThrow('unknown remote outcome');
    expect(exec).toHaveBeenCalledTimes(1);
    exec.mockResolvedValueOnce({ exitCode: 0, output: '{partial', truncated: false });
    await expect(store.load(active())).rejects.toMatchObject({ code: 'MEMORY_PROTOCOL_FAILED' });
    expect(exec).toHaveBeenCalledTimes(2);
    exec.mockResolvedValueOnce({ exitCode: 0, output: '{"ok":true}', truncated: true });
    await expect(store.load(active())).rejects.toMatchObject({ code: 'MEMORY_PROTOCOL_FAILED' });
    expect(exec).toHaveBeenCalledTimes(3);
  });
  it('honors cancellation before touching storage', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(store.appendLearning(learning, controller.signal)).rejects.toThrow();
    await expect(fs.stat(path.join(root, '.automaker'))).rejects.toThrow();
  });
  it('does not replay an append after losing the acknowledgement of a completed write', async () => {
    const actual = environment.exec.bind(environment);
    const exec = vi.spyOn(environment, 'exec').mockImplementation(async (...args) => {
      const result = await actual(...args);
      if (exec.mock.calls.length === 2) throw new Error('unknown write outcome');
      return result;
    });
    await expect(store.appendLearning(learning, active())).rejects.toThrow('unknown write outcome');
    expect(exec).toHaveBeenCalledTimes(2);
    expect((await fs.readFile(file(), 'utf8')).split(learning.content)).toHaveLength(2);
  });
  it.each([
    { ...learning, category: '' },
    { ...learning, content: '' },
    { ...learning, why: 'x'.repeat(8193) },
    { ...learning, type: 'invalid' },
  ])('rejects malformed learning entries before issuing commands', async (entry) => {
    const exec = vi.spyOn(environment, 'exec');
    await expect(store.appendLearning(entry as typeof learning, active())).rejects.toMatchObject({
      code: 'MEMORY_LEARNING_INVALID',
    });
    expect(exec).not.toHaveBeenCalled();
  });
});
