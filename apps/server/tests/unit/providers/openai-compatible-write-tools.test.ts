import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadOnlyWorkspace, textHash } from '@/providers/openai-compatible/workspace.js';
import { ToolRegistry, toolPolicy } from '@/providers/openai-compatible/tool-registry.js';
import type { DirectAgentOptions } from '@automaker/types';
import { ToolError } from '@/providers/openai-compatible/runtime.js';

describe.skipIf(process.platform !== 'linux')('direct agent mutation boundary', () => {
  let temporary: string;
  let root: string;
  let workspace: ReadOnlyWorkspace;
  let registry: ToolRegistry;
  const signal = () => new AbortController().signal;
  const original = 'one\ntwo\nthree\n';
  async function call(name: string, args: unknown, abort = signal()) {
    const result = await registry.execute(
      { id: 'write-call', type: 'function', function: { name, arguments: JSON.stringify(args) } },
      abort
    );
    return JSON.parse(result.content);
  }
  beforeEach(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'direct-write-test-'));
    root = path.join(temporary, 'project');
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, 'main.txt'), original, { mode: 0o755 });
    workspace = await ReadOnlyWorkspace.create(root);
    registry = new ToolRegistry(workspace, ['Read', 'Write', 'Edit', 'TodoWrite'], false, {
      access: 'workspace-write',
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(temporary, { recursive: true, force: true });
  });

  it('never derives write authority from readOnly:false or allowed tool names', () => {
    expect(() => new ToolRegistry(workspace, ['Write'], false)).toThrow('unavailable');
    expect(
      () => new ToolRegistry(workspace, ['Edit'], true, { access: 'workspace-write' })
    ).toThrow('unavailable');
    expect(toolPolicy({ access: 'workspace-write' }, true).access).toBe('read-only');
    expect(() => toolPolicy({ access: 'full-access' })).toThrow('intentionally unavailable');
  });

  it.each([
    { access: 'anything' },
    { shell: { backend: 'host', image: 'sha256:' + 'a'.repeat(64) } },
    { shell: { backend: 'docker', image: 'alpine:latest' } },
    { shell: { backend: 'docker', image: 'sha256:' + 'a'.repeat(64), executable: '/host/bash' } },
    { shell: { backend: 'docker', image: 'sha256:' + 'a'.repeat(64), privileged: true } },
  ])('rejects invalid policy before execution (%#)', (value) => {
    expect(() => toolPolicy(value as DirectAgentOptions)).toThrow();
  });

  it('Read provides a whole-file digest even for a limited line range', async () => {
    const read = await call('Read', { path: 'main.txt', maxLines: 1 });
    expect(read.result).toMatchObject({
      sha256: textHash(original),
      content: 'one',
      truncated: true,
    });
  });

  it('creates a new file exclusively and atomically replaces an existing file', async () => {
    expect(
      await call('Write', { path: 'new.txt', content: 'новый файл', expectedSha256: null })
    ).toMatchObject({ ok: true, result: { sha256: textHash('новый файл') } });
    expect(
      await call('Write', {
        path: 'main.txt',
        content: 'replaced',
        expectedSha256: textHash(original),
      })
    ).toMatchObject({ ok: true });
    expect(await fs.readFile(path.join(root, 'main.txt'), 'utf8')).toBe('replaced');
    expect((await fs.stat(path.join(root, 'main.txt'))).mode & 0o777).toBe(0o755);
    expect((await fs.readdir(root)).some((name) => name.startsWith('.direct-write-'))).toBe(false);
  });

  it.each([
    { path: 'main.txt', content: 'bad', expectedSha256: null },
    { path: 'main.txt', content: 'bad', expectedSha256: '0'.repeat(64) },
    { path: 'missing.txt', content: 'bad', expectedSha256: textHash(original) },
  ])('rejects optimistic conflicts without overwriting (%#)', async (args) => {
    expect(await call('Write', args)).toMatchObject({
      ok: false,
      error: { code: 'FILE_CONFLICT' },
    });
    expect(await fs.readFile(path.join(root, 'main.txt'), 'utf8')).toBe(original);
  });

  it('serializes concurrent writes with the same expected hash', async () => {
    const results = await Promise.all(
      ['first', 'second'].map((content) =>
        call('Write', { path: 'main.txt', content, expectedSha256: textHash(original) })
      )
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)[0].error.code).toBe('FILE_CONFLICT');
  });

  it('Edit replaces exactly one match and supports deletion of that text', async () => {
    expect(
      await call('Edit', {
        path: 'main.txt',
        oldText: 'two\n',
        newText: '',
        expectedSha256: textHash(original),
      })
    ).toMatchObject({ ok: true });
    expect(await fs.readFile(path.join(root, 'main.txt'), 'utf8')).toBe('one\nthree\n');
  });

  it.each(['absent', '\n'])('Edit refuses absent or ambiguous matches (%s)', async (oldText) => {
    expect(
      await call('Edit', {
        path: 'main.txt',
        oldText,
        newText: 'bad',
        expectedSha256: textHash(original),
      })
    ).toMatchObject({ ok: false, error: { code: 'EDIT_CONFLICT' } });
    expect(await fs.readFile(path.join(root, 'main.txt'), 'utf8')).toBe(original);
  });

  it.each([
    '../outside.txt',
    '.env',
    '.env.local',
    '.git/config',
    '.automaker/settings.json',
    'credentials.json',
    '.ssh/id_rsa',
    'src\\bad.txt',
  ])('denies protected paths (%s)', async (file) => {
    expect(await call('Write', { path: file, content: 'bad', expectedSha256: null })).toMatchObject(
      { ok: false }
    );
  });

  it('refuses symlinks, parent links, and hardlinks without changing their targets', async () => {
    const outside = path.join(temporary, 'outside.txt');
    await fs.writeFile(outside, 'outside');
    await fs.symlink(outside, path.join(root, 'symlink.txt'));
    await fs.symlink(temporary, path.join(root, 'linked-dir'));
    await fs.link(outside, path.join(root, 'hardlink.txt'));
    for (const file of ['symlink.txt', 'hardlink.txt', 'linked-dir/outside.txt'])
      expect(
        await call('Write', { path: file, content: 'bad', expectedSha256: textHash('outside') })
      ).toMatchObject({ ok: false });
    expect(await fs.readFile(outside, 'utf8')).toBe('outside');
  });

  it('rejects invalid UTF-8 text, NUL and oversized files', async () => {
    for (const content of ['nul\0byte', '\ud800', 'x'.repeat(1024 * 1024 + 1)])
      expect(await call('Write', { path: 'new.txt', content, expectedSha256: null })).toMatchObject(
        { ok: false }
      );
    await expect(fs.stat(path.join(root, 'new.txt'))).rejects.toThrow();
  });

  it('checks cancellation before publication and cleans its private temporary file', async () => {
    const controller = new AbortController();
    const realRename = fs.rename.bind(fs);
    const realOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      if (String(args[0]).includes('.direct-write-')) {
        const realSync = handle.sync.bind(handle);
        vi.spyOn(handle, 'sync').mockImplementation(async () => {
          await realSync();
          controller.abort();
        });
      }
      return handle;
    });
    const rename = vi.spyOn(fs, 'rename').mockImplementation(realRename);
    await expect(
      call(
        'Write',
        { path: 'main.txt', content: 'bad', expectedSha256: textHash(original) },
        controller.signal
      )
    ).rejects.toThrow('cancelled');
    expect(rename).not.toHaveBeenCalled();
    expect(await fs.readdir(root)).toEqual(['main.txt']);
    expect(await fs.readFile(path.join(root, 'main.txt'), 'utf8')).toBe(original);
  });

  it('does not hide sandbox cleanup failures behind generic cancellation', async () => {
    const controller = new AbortController();
    vi.spyOn(workspace, 'write').mockImplementation(async () => {
      controller.abort();
      throw new ToolError(
        'SANDBOX_CLEANUP_FAILED',
        'Could not confirm sandbox removal: automaker-direct-test.'
      );
    });
    await expect(
      call('Write', { path: 'new.txt', content: 'text', expectedSha256: null }, controller.signal)
    ).rejects.toThrow('Could not confirm sandbox removal: automaker-direct-test');
  });

  it('TodoWrite validates state and records the list in checkpointable tool results', async () => {
    const todos = [{ content: 'Run tests', status: 'in_progress' }];
    expect(await call('TodoWrite', { todos })).toEqual({ ok: true, result: { todos } });
    expect(await call('TodoWrite', { todos: [...todos, ...todos] })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENTS' },
    });
    expect(
      await call('TodoWrite', { todos: [{ content: 'Bad', status: 'unknown' }] })
    ).toMatchObject({ ok: false });
    expect(await call('TodoWrite', { todos: [] })).toEqual({ ok: true, result: { todos: [] } });
  });
});
