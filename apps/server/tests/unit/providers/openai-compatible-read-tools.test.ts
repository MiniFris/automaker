import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as platform from '@automaker/platform';
import { ReadOnlyWorkspace } from '@/providers/openai-compatible/workspace.js';
import { READ_TOOL_NAMES, ToolRegistry } from '@/providers/openai-compatible/tool-registry.js';

describe.skipIf(process.platform !== 'linux')(
  'direct agent read tools / descriptor boundary',
  () => {
    let fixture: string;
    let root: string;
    let outside: string;
    let workspace: ReadOnlyWorkspace;
    let registry: ToolRegistry;
    const signal = () => new AbortController().signal;

    async function call(name: string, args: unknown) {
      const result = await registry.execute(
        { id: 'call-test', type: 'function', function: { name, arguments: JSON.stringify(args) } },
        signal()
      );
      expect(result.content.length).toBeLessThanOrEqual(16384);
      return JSON.parse(result.content);
    }

    beforeEach(async () => {
      fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'direct-read-test-'));
      root = path.join(fixture, 'workspace');
      outside = path.join(fixture, 'outside');
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.mkdir(outside);
      await fs.writeFile(path.join(root, 'file.txt'), 'first\nsecond\nTHIRD');
      await fs.writeFile(path.join(root, 'index.ts'), 'export const root = true;');
      await fs.writeFile(
        path.join(root, 'src', 'main.ts'),
        'const answer = 42;\nexport { answer };'
      );
      await fs.writeFile(path.join(root, 'src', 'note.md'), 'Literal .* marker');
      await fs.writeFile(path.join(outside, 'secret.txt'), 'outside-sensitive-data');
      workspace = await ReadOnlyWorkspace.create(root);
      registry = new ToolRegistry(workspace, READ_TOOL_NAMES, true);
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      await fs.rm(fixture, { recursive: true, force: true });
    });

    it('registers only schema-validated reading tools in read-only mode', () => {
      expect(registry.definitions().map((tool) => tool.function.name)).toEqual(READ_TOOL_NAMES);
      expect(() => new ToolRegistry(workspace, ['Bash'], true)).toThrow('unavailable');
      expect(() => new ToolRegistry(workspace, ['Write'], false)).toThrow('unavailable');
      expect(new ToolRegistry(workspace, ['Read'], true).definitions()).toHaveLength(1);
    });

    it('reads bounded, 1-based line ranges without changing files', async () => {
      expect(await call('Read', { path: 'file.txt', startLine: 2, maxLines: 1 })).toEqual({
        ok: true,
        result: {
          path: 'file.txt',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          startLine: 2,
          content: 'second',
          truncated: true,
          nextLine: 3,
        },
      });
      expect(await fs.readFile(path.join(root, 'file.txt'), 'utf8')).toBe('first\nsecond\nTHIRD');
    });

    it('handles empty files and line ranges beyond EOF', async () => {
      await fs.writeFile(path.join(root, 'empty.txt'), '');
      expect((await call('Read', { path: 'empty.txt' })).result.content).toBe('');
      expect((await call('Read', { path: 'file.txt', startLine: 999 })).result.content).toBe('');
    });

    it.each([
      { path: 'file.txt', maxLines: '1' },
      { path: 'file.txt', startLine: 0 },
      { path: 'file.txt', extra: true },
      { path: 42 },
      {},
      null,
    ])('rejects invalid arguments without coercion or raw values (%#)', async (args) => {
      expect(await call('Read', args)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENTS' },
      });
    });

    it('handles malformed JSON and unknown tool names as tool results, not host execution', async () => {
      const malformed = await registry.execute(
        { id: 'x', type: 'function', function: { name: 'Read', arguments: '{' } },
        signal()
      );
      expect(JSON.parse(malformed.content)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENTS' },
      });
      expect(await call('Bash', { command: 'must-not-run' })).toMatchObject({
        ok: false,
        error: { code: 'UNKNOWN_TOOL' },
      });
    });

    it('lists sorted entries and reports truncated listings', async () => {
      const result = await call('LS', { path: '.', maxEntries: 2 });
      expect(result.result.entries).toHaveLength(2);
      expect(result.result.truncated).toBe(true);
      const names = result.result.entries.map((entry: { name: string }) => entry.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    });

    it('finds root and nested glob matches without invoking a shell', async () => {
      expect((await call('Glob', { pattern: '**/*.ts' })).result.files.sort()).toEqual([
        'index.ts',
        'src/main.ts',
      ]);
      expect((await call('Glob', { pattern: 'src/ma?n.ts' })).result.files).toEqual([
        'src/main.ts',
      ]);
      expect((await call('Glob', { pattern: '**/*.ts', maxResults: 1 })).result.truncated).toBe(
        true
      );
    });

    it('matches Unicode literals and single-character wildcards', async () => {
      await fs.writeFile(path.join(root, '😀.ts'), 'unicode');
      expect((await call('Glob', { pattern: '😀.ts' })).result.files).toEqual(['😀.ts']);
      expect((await call('Glob', { pattern: '?.ts' })).result.files).toEqual(['😀.ts']);
    });

    it('stops recursive content scanning at its byte budget', async () => {
      for (let i = 0; i < 9; i++)
        await fs.writeFile(path.join(root, `large-${i}.txt`), 'x'.repeat(1024 * 1024));
      const result = await call('Grep', { pattern: 'not-found', glob: 'large-*.txt' });
      expect(result.result.truncated).toBe(true);
      expect(result.result.scannedFiles).toBe(8);
    });

    it.each(['../**', '/etc/*', '**.{ts,js}', 'src/**x', 'src/[a-z].ts', 'src\\*.ts'])(
      'rejects unsupported glob pattern %s',
      async (pattern) => {
        expect(await call('Glob', { pattern })).toMatchObject({
          ok: false,
          error: { code: 'INVALID_PATTERN' },
        });
      }
    );

    it('searches literal substrings, supports case-insensitive search and bounds matches', async () => {
      const result = await call('Grep', {
        pattern: 'ANSWER',
        caseSensitive: false,
        glob: '**/*.ts',
        maxResults: 1,
      });
      expect(result.result.matches).toEqual([
        { path: 'src/main.ts', line: 1, text: 'const answer = 42;' },
      ]);
      expect(result.result.truncated).toBe(true);
      expect((await call('Grep', { pattern: '.*' })).result.matches).toEqual([
        { path: 'src/note.md', line: 1, text: 'Literal .* marker' },
      ]);
    });

    it('skips dependency/build trees in recursive searches', async () => {
      await fs.mkdir(path.join(root, 'node_modules', 'dependency'), { recursive: true });
      await fs.writeFile(path.join(root, 'node_modules', 'dependency', 'hidden.ts'), 'SECRET');
      expect((await call('Glob', { pattern: '**/*.ts' })).result.files).not.toContain(
        'node_modules/dependency/hidden.ts'
      );
      expect((await call('Grep', { pattern: 'SECRET' })).result.matches).toEqual([]);
    });

    it.each([
      '../outside/secret.txt',
      '/etc/passwd',
      '..\\outside\\secret.txt',
      'C:\\secret',
      'bad\u0000name',
    ])('rejects traversal and foreign paths (%#)', async (name) => {
      const result = await call('Read', { path: name });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toMatch(/outside-sensitive-data|\/etc\/passwd/);
    });

    it('allows names beginning with .. when they are not traversal', async () => {
      await fs.writeFile(path.join(root, '..inside'), 'inside');
      expect((await call('Read', { path: '..inside' })).result.content).toBe('inside');
    });

    it('rejects sibling-prefix escapes and absolute external paths', async () => {
      const sibling = root + '-other';
      await fs.mkdir(sibling);
      await fs.writeFile(path.join(sibling, 'secret'), 'outside-sensitive-data');
      expect((await call('Read', { path: path.join(sibling, 'secret') })).ok).toBe(false);
      expect((await call('LS', { path: outside })).ok).toBe(false);
    });

    it('denies both internal and external symlinks, including symlink directories', async () => {
      await fs.symlink(path.join(root, 'file.txt'), path.join(root, 'inside-link'));
      await fs.symlink(path.join(outside, 'secret.txt'), path.join(root, 'secret-link'));
      await fs.symlink(outside, path.join(root, 'dir-link'));
      for (const name of ['inside-link', 'secret-link', 'dir-link/secret.txt'])
        expect((await call('Read', { path: name })).ok).toBe(false);
      expect(
        (await call('LS', {})).result.entries.map((entry: { name: string }) => entry.name)
      ).not.toContain('dir-link');
      expect(
        JSON.stringify(await call('Grep', { pattern: 'outside-sensitive-data' }))
      ).not.toContain('outside-sensitive-data');
    });

    it('denies hard-linked files rather than leaking external inode contents', async () => {
      await fs.link(path.join(outside, 'secret.txt'), path.join(root, 'hard-link'));
      expect((await call('Read', { path: 'hard-link' })).ok).toBe(false);
    });

    it('does not expose worktree .git pointers or protected metadata', async () => {
      await fs.writeFile(path.join(root, '.git'), `gitdir: ${outside}\n`);
      await fs.mkdir(path.join(root, '.automaker'));
      await fs.writeFile(path.join(root, '.automaker', 'credentials.json'), 'protected-secret');
      expect((await call('Read', { path: '.git' })).error.code).toBe('PATH_DENIED');
      expect((await call('Read', { path: '.automaker/credentials.json' })).error.code).toBe(
        'PATH_DENIED'
      );
      const result = await call('Glob', { pattern: '**/*' });
      expect(JSON.stringify(result)).not.toMatch(/\.git|credentials/);
      expect((await call('Read', { path: 'src/main.ts' })).ok).toBe(true);
    });

    it('denies DATA_DIR even when it is nested in the selected workspace', async () => {
      const dataDir = path.join(root, 'server-data');
      await fs.mkdir(dataDir);
      await fs.writeFile(path.join(dataDir, 'key.txt'), 'server-secret');
      vi.stubEnv('DATA_DIR', dataDir);
      const restricted = await ReadOnlyWorkspace.create(root);
      const tools = new ToolRegistry(restricted, READ_TOOL_NAMES, true);
      const result = await tools.execute(
        {
          id: 'x',
          type: 'function',
          function: { name: 'Read', arguments: '{"path":"server-data/key.txt"}' },
        },
        signal()
      );
      expect(JSON.parse(result.content)).toMatchObject({
        ok: false,
        error: { code: 'PATH_DENIED' },
      });
      await expect(ReadOnlyWorkspace.create(dataDir)).rejects.toThrow();
    });

    it('honors the main ALLOWED_ROOT_DIRECTORY, without using the app-data exception', async () => {
      vi.spyOn(platform, 'getAllowedRootDirectory').mockReturnValue(outside);
      await expect(ReadOnlyWorkspace.create(root)).rejects.toThrow('protected');
    });

    it('does not release contents if the root is replaced during descriptor acquisition', async () => {
      const open = fs.open.bind(fs);
      let replaced = false;
      vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
        const handle = await open(...args);
        if (args[0] === root && !replaced) {
          replaced = true;
          await fs.rename(root, root + '-original');
          await fs.symlink(outside, root);
        }
        return handle;
      });
      const result = await call('Read', { path: 'secret.txt' });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain('outside-sensitive-data');
    });

    it('does not follow a directory swapped for a symlink between component opens', async () => {
      const open = fs.open.bind(fs);
      let replaced = false;
      vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
        if (String(args[0]).endsWith('/src') && !replaced) {
          replaced = true;
          await fs.rename(path.join(root, 'src'), path.join(root, 'old-src'));
          await fs.symlink(outside, path.join(root, 'src'));
        }
        return open(...args);
      });
      expect((await call('Read', { path: 'src/secret.txt' })).ok).toBe(false);
    });

    it('rejects oversized, binary and invalid UTF-8 files', async () => {
      await fs.writeFile(path.join(root, 'large'), Buffer.alloc(1024 * 1024 + 1));
      await fs.writeFile(path.join(root, 'binary'), Buffer.from([1, 0, 2]));
      await fs.writeFile(path.join(root, 'utf8'), Buffer.from([0xff, 0xff]));
      expect((await call('Read', { path: 'large' })).error.code).toBe('FILE_TOO_LARGE');
      expect((await call('Read', { path: 'binary' })).error.code).toBe('BINARY_FILE');
      expect((await call('Read', { path: 'utf8' })).error.code).toBe('BINARY_FILE');
      expect(
        (await call('Grep', { pattern: 'nonexistent' })).result.skippedFiles
      ).toBeGreaterThanOrEqual(3);
    });

    it('bounds even escaped tool output while preserving valid JSON and a truncation marker', async () => {
      await fs.writeFile(path.join(root, 'quotes.txt'), '"\\'.repeat(20000));
      const result = await call('Read', { path: 'quotes.txt' });
      expect(result.truncated).toBe(true);
      expect(typeof result.output).toBe('string');
    });

    it('returns a bounded excerpt around a grep match on a long line', async () => {
      await fs.writeFile(
        path.join(root, 'long.txt'),
        'a'.repeat(3000) + 'MATCH' + 'b'.repeat(3000)
      );
      const result = await call('Grep', { pattern: 'MATCH' });
      expect(result.result.matches).toHaveLength(1);
      expect(result.result.matches[0].text).toContain('MATCH');
      expect(result.result.matches[0].text.length).toBeLessThanOrEqual(1000);
      expect(result.result.matches[0].truncated).toBe(true);
    });

    it('releases file descriptors after repeated reads and listing operations', async () => {
      const before = (await fs.readdir('/proc/self/fd')).length;
      for (let i = 0; i < 20; i++) {
        await call('Read', { path: 'src/main.ts' });
        await call('LS', { path: 'src' });
      }
      expect((await fs.readdir('/proc/self/fd')).length).toBeLessThanOrEqual(before + 1);
    });

    it('stops on cancellation without releasing filesystem error details', async () => {
      const controller = new AbortController();
      controller.abort('sensitive-cause');
      await expect(workspace.read('file.txt', controller.signal)).rejects.toThrow('cancelled');
      expect((await call('Read', { path: 'missing-private-name' })).error.message).not.toContain(
        'missing-private-name'
      );
    });
  }
);
