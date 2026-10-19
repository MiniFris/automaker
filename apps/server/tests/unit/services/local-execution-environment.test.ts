import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalExecutionEnvironment } from '@/services/execution-environment/local.js';
import { issueEnvironment } from '@/services/execution-environment/runtime.js';
import { ToolRegistry } from '@/providers/openai-compatible/tool-registry.js';

const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
const node = (script: string) => `${quote(process.execPath)} -e ${quote(script)}`;
describe('Local execution environment / real temporary files and subprocesses', () => {
  let temporary: string;
  let cwd: string;
  let environment: LocalExecutionEnvironment;
  const signal = () => new AbortController().signal;
  beforeEach(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'local-runtime-test-'));
    cwd = path.join(temporary, 'project');
    await fs.mkdir(cwd);
    environment = issueEnvironment(await LocalExecutionEnvironment.create(cwd));
  });
  afterEach(async () => {
    await fs.rm(temporary, { recursive: true, force: true });
  });
  const invoke = async (registry: ToolRegistry, name: string, args: unknown) =>
    JSON.parse(
      (
        await registry.execute(
          { id: 'call', type: 'function', function: { name, arguments: JSON.stringify(args) } },
          signal()
        )
      ).content
    );
  it('reads and writes outside cwd with ordinary OS permissions, not workspace confinement', async () => {
    const file = path.join(temporary, 'outside.txt');
    await environment.writeFile(file, Buffer.from('outside'), signal());
    expect((await environment.readFile('../outside.txt', 0, 100, signal())).data.toString()).toBe(
      'outside'
    );
    expect(environment.capabilities.sandboxed).toBe(false);
  });
  it('supports large binary files without copying a dependency tree', async () => {
    await environment.writeFile(
      'node_modules/pkg/large.bin',
      Buffer.alloc(18 * 1024 * 1024, 177),
      signal()
    );
    const read = await environment.readFile(
      'node_modules/pkg/large.bin',
      17 * 1024 * 1024,
      16,
      signal()
    );
    expect(read.size).toBe(18 * 1024 * 1024);
    expect([...read.data]).toEqual(Array(16).fill(177));
  });
  it('creates parents, preserves permissions, and applies optional digest preconditions', async () => {
    await environment.writeFile('a/file.txt', Buffer.from('old'), signal(), null);
    await fs.chmod(path.join(cwd, 'a/file.txt'), 0o700);
    await expect(
      environment.writeFile('a/file.txt', Buffer.from('bad'), signal(), '0'.repeat(64))
    ).rejects.toMatchObject({ code: 'FILE_CONFLICT' });
    await environment.writeFile(
      'a/file.txt',
      Buffer.from('new'),
      signal(),
      createHash('sha256').update('old').digest('hex')
    );
    expect(await fs.readFile(path.join(cwd, 'a/file.txt'), 'utf8')).toBe('new');
    if (process.platform !== 'win32')
      expect((await fs.stat(path.join(cwd, 'a/file.txt'))).mode & 0o777).toBe(0o700);
  });
  it('does not mutate after a pre-cancelled call', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      environment.writeFile('cancelled.txt', Buffer.from('no'), controller.signal)
    ).rejects.toThrow();
    await expect(fs.stat(path.join(cwd, 'cancelled.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('deletes files and explicit directory trees', async () => {
    await environment.mkdir('nested', signal());
    await environment.writeFile('nested/file', Buffer.from('x'), signal());
    await expect(environment.remove('nested', false, signal())).rejects.toThrow();
    await environment.remove('nested', true, signal());
    await expect(fs.stat(path.join(cwd, 'nested'))).rejects.toThrow();
  });
  it('lists binary files, dependency directories, and symlinks without traversing them automatically', async () => {
    await environment.mkdir('node_modules', signal());
    await environment.writeFile('data.bin', Buffer.from([0, 255]), signal());
    if (process.platform !== 'win32') await fs.symlink('node_modules', path.join(cwd, 'link'));
    const list = await environment.listDirectory('.', 100, signal());
    expect(list.entries).toEqual(
      expect.arrayContaining([
        { name: 'node_modules', type: 'directory' },
        { name: 'data.bin', type: 'file' },
      ])
    );
  });
  it('supports base64 binary tools and directory/removal tools', async () => {
    const registry = new ToolRegistry(environment, ['Read', 'Write', 'Mkdir', 'Delete'], false);
    expect(
      (
        await invoke(registry, 'Write', {
          path: 'binary/data',
          content: 'AP8BAg==',
          encoding: 'base64',
        })
      ).ok
    ).toBe(true);
    expect(
      (await invoke(registry, 'Read', { path: 'binary/data', encoding: 'base64' })).result.content
    ).toBe('AP8BAg==');
    expect((await invoke(registry, 'Read', { path: 'binary/data' })).error.code).toBe(
      'BINARY_FILE'
    );
    expect((await invoke(registry, 'Delete', { path: 'binary', recursive: true })).ok).toBe(true);
  });
  it('paginates UTF-8 without losing a character at a byte boundary', async () => {
    await environment.writeFile('unicode.txt', Buffer.from('abc😀xyz'), signal());
    const registry = new ToolRegistry(environment, ['Read'], true);
    const first = (await invoke(registry, 'Read', { path: 'unicode.txt', maxBytes: 5 })).result;
    expect(first.content).toBe('abc');
    expect(first.nextOffset).toBe(3);
    const second = (
      await invoke(registry, 'Read', { path: 'unicode.txt', offset: first.nextOffset })
    ).result;
    expect(first.content + second.content).toBe('abc😀xyz');
  });
  it('keeps read metadata usable for control-heavy files instead of truncating the result JSON', async () => {
    await environment.writeFile('controls.txt', Buffer.alloc(6000, 1), signal());
    const result = await invoke(new ToolRegistry(environment, ['Read'], true), 'Read', {
      path: 'controls.txt',
      maxBytes: 262144,
    });
    expect(result.result.truncated).toBe(true);
    expect(result.result.nextOffset).toBeGreaterThan(0);
    expect(result.result.content.length).toBeLessThan(6000);
  });
  it('reports line truncation and rejects malformed base64 without writing', async () => {
    await environment.writeFile('lines.txt', Buffer.from('one\ntwo\nthree'), signal());
    const registry = new ToolRegistry(environment, ['Read', 'Write'], false);
    expect(
      (await invoke(registry, 'Read', { path: 'lines.txt', maxLines: 1 })).result
    ).toMatchObject({ content: 'one', truncated: true, nextLine: 2 });
    expect(
      (
        await invoke(registry, 'Write', {
          path: 'bad.bin',
          content: 'bad-base64!',
          encoding: 'base64',
        })
      ).error.code
    ).toBe('INVALID_BASE64');
    await expect(fs.stat(path.join(cwd, 'bad.bin'))).rejects.toThrow();
  });
  it('edits exactly one match, detects conflicts and never coerces tool arguments', async () => {
    await environment.writeFile('edit.txt', Buffer.from('hello hello'), signal());
    const registry = new ToolRegistry(environment, ['Edit', 'Read'], false);
    expect(
      (await invoke(registry, 'Edit', { path: 'edit.txt', oldText: 'hello', newText: 'world' }))
        .error.code
    ).toBe('EDIT_CONFLICT');
    expect(
      (
        await invoke(registry, 'Edit', {
          path: 'edit.txt',
          oldText: 'hello hello',
          newText: 'world',
          expectedSha256: '0'.repeat(64),
        })
      ).error.code
    ).toBe('FILE_CONFLICT');
    expect(
      (
        await invoke(registry, 'Edit', {
          path: 'edit.txt',
          oldText: 'hello hello',
          newText: 'world',
        })
      ).ok
    ).toBe(true);
    expect((await invoke(registry, 'Read', { path: 'edit.txt', offset: '0' })).error.code).toBe(
      'INVALID_ARGUMENTS'
    );
  });
  it('keeps read-only tool registries genuinely free of shell and mutation tools', async () => {
    const registry = new ToolRegistry(environment, ['Read', 'LS', 'Grep', 'Glob'], true);
    expect((await invoke(registry, 'Write', { path: 'no', content: 'no' })).error.code).toBe(
      'UNKNOWN_TOOL'
    );
    expect(() => new ToolRegistry(environment, ['Bash'], true)).toThrow();
  });
  it('searches literal text and globs with optional dependency traversal', async () => {
    await environment.writeFile('src/a.ts', Buffer.from('Needle\nOther'), signal());
    await environment.writeFile('node_modules/pkg/b.ts', Buffer.from('Needle'), signal());
    const registry = new ToolRegistry(environment, ['Grep', 'Glob'], true);
    expect((await invoke(registry, 'Glob', { pattern: '**/*.ts' })).result.files).toEqual([
      path.join('src', 'a.ts'),
    ]);
    expect(
      (
        await invoke(registry, 'Grep', {
          pattern: 'needle',
          caseSensitive: false,
          includeDependencies: true,
        })
      ).result.matches
    ).toHaveLength(2);
  });
  it.skipIf(process.platform === 'win32')(
    'executes a real command with cwd, exit status and bounded output',
    async () => {
      const result = await environment.exec(
        node("console.log(process.cwd());console.log('x'.repeat(20000));process.exitCode=3"),
        signal(),
        { maxOutputBytes: 100 }
      );
      expect(result.exitCode).toBe(3);
      expect(result.output).toContain(cwd);
      expect(result.truncated).toBe(true);
      expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(100);
    }
  );
  it.skipIf(process.platform === 'win32')(
    'preserves filesystem effects when a command times out',
    async () => {
      await expect(
        environment.exec(
          node("require('fs').writeFileSync('effect.txt','persisted');setInterval(()=>{},1000)"),
          signal(),
          { timeoutMs: 1000 }
        )
      ).rejects.toMatchObject({ code: 'PROCESS_INTERRUPTED' });
      expect(await fs.readFile(path.join(cwd, 'effect.txt'), 'utf8')).toBe('persisted');
    }
  );
  it.skipIf(process.platform !== 'linux')(
    'cancels the shell and ordinary child/grandchild processes before returning',
    async () => {
      const controller = new AbortController();
      const operation = environment.exec(
        node(
          "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});require('fs').writeFileSync('pids.json',JSON.stringify([process.pid,c.pid]));setInterval(()=>{},1000)"
        ),
        controller.signal
      );
      let pids: number[] = [];
      try {
        for (let attempt = 0; attempt < 200; attempt++) {
          try {
            pids = JSON.parse(await fs.readFile(path.join(cwd, 'pids.json'), 'utf8'));
            break;
          } catch {
            await delay(10);
          }
        }
        expect(pids).toHaveLength(2);
      } finally {
        controller.abort();
      }
      await expect(operation).rejects.toMatchObject({ code: 'PROCESS_INTERRUPTED' });
      for (const pid of pids) {
        const status = await fs.readFile(`/proc/${pid}/status`, 'utf8').catch(() => 'State:\tZ');
        expect(status).toMatch(/State:\s+[ZX]/);
      }
    }
  );
  it.skipIf(process.platform === 'win32')(
    'cleans background descendants if their parent exits first',
    async () => {
      const start = Date.now();
      expect((await environment.exec('sleep 20 & exit 0', signal())).exitCode).toBe(0);
      expect(Date.now() - start).toBeLessThan(3000);
    }
  );
});
