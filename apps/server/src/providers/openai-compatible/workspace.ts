import fs, { type FileHandle } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { getAllowedRootDirectory, getDataDirectory, validatePath } from '@automaker/platform';
import { OpenAICompatibleError } from './errors.js';
import { checkAbort, ToolError } from './runtime.js';

const BLOCKED = new Set([
  '.git',
  '.automaker',
  '.codex',
  '.claude',
  '.ssh',
  '.aws',
  'direct-agent-checkpoints',
]);
export const MAX_FILE_BYTES = 1024 * 1024;
const writes = new Map<string, Promise<unknown>>();

export function textHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative.split(path.sep)[0] !== '..');
}

function denied(): never {
  throw new ToolError('PATH_DENIED', 'Path is outside the workspace or is protected.');
}

/**
 * Descriptor-guarded workspace (historical class name retained). Components are opened relative to a pinned parent
 * with O_NOFOLLOW, and the resulting descriptor is checked through procfs before
 * and after use. Writes publish one private temporary file atomically, with a digest precondition.
 * Fail closed where this backend is unavailable; this is not a shell sandbox.
 */
export class ReadOnlyWorkspace {
  private constructor(
    readonly root: string,
    private readonly protectedPaths: string[]
  ) {}

  static async create(cwd: string, signal?: AbortSignal): Promise<ReadOnlyWorkspace> {
    checkAbort(signal);
    if (process.platform !== 'linux')
      throw new OpenAICompatibleError('Read tools currently require the Linux descriptor backend.');
    try {
      await fs.access('/proc/self/fd');
      const root = validatePath(await fs.realpath(validatePath(cwd)));
      if (root === path.parse(root).root || !(await fs.stat(root)).isDirectory()) denied();
      if (
        root.split(path.sep).some((part) => part.toLowerCase() === '.git') ||
        BLOCKED.has(path.basename(root).toLowerCase())
      )
        denied();
      const allowed = getAllowedRootDirectory();
      // The app DATA_DIR exception must not grant the model access to server data.
      if (allowed && !within(path.resolve(allowed), root)) denied();
      const dataDirectory =
        getDataDirectory() ?? process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
      const protectedPaths = [path.resolve(dataDirectory)];
      protectedPaths.push(
        await fs.realpath(dataDirectory).catch(() => path.resolve(dataDirectory))
      );
      const workspace = new ReadOnlyWorkspace(root, protectedPaths);
      workspace.checkPath(root);
      checkAbort(signal);
      return workspace;
    } catch (error) {
      if (error instanceof ToolError)
        throw new OpenAICompatibleError('Workspace is unavailable or protected.');
      if (error instanceof OpenAICompatibleError) throw error;
      throw new OpenAICompatibleError('Workspace is unavailable or not allowed.');
    }
  }

  private checkPath(target: string): void {
    if (!within(this.root, target) || this.protectedPaths.some((root) => within(root, target)))
      denied();
    const parts = path.relative(this.root, target).split(path.sep);
    if (
      parts.some(
        (part) =>
          BLOCKED.has(part.toLowerCase()) ||
          /^credentials\.json(?:\.|$)/i.test(part) ||
          /^\.env(?:\.|$)/i.test(part) ||
          part.startsWith('.direct-write-')
      )
    )
      denied();
    validatePath(target);
  }

  private resolve(input: string): string {
    if (
      !input ||
      /[\x00-\x1f\x7f\\]/.test(input) ||
      (path.win32.isAbsolute(input) && !path.isAbsolute(input))
    )
      denied();
    const target = path.resolve(this.root, input);
    this.checkPath(target);
    return target;
  }

  assertAllowedPath(input: string): void {
    this.resolve(input);
  }

  private async verify(handle: FileHandle): Promise<void> {
    const actual = await fs.realpath(`/proc/self/fd/${handle.fd}`);
    this.checkPath(actual);
  }

  private async withHandle<T>(
    input: string,
    directory: boolean,
    signal: AbortSignal,
    action: (handle: FileHandle) => Promise<T>
  ): Promise<T> {
    checkAbort(signal);
    const target = this.resolve(input);
    const handles: FileHandle[] = [];
    try {
      const root = await fs.open(
        this.root,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      );
      handles.push(root);
      if ((await fs.realpath(`/proc/self/fd/${root.fd}`)) !== this.root) denied();
      await this.verify(root);
      let current = root;
      const parts = path.relative(this.root, target).split(path.sep).filter(Boolean);
      for (const [index, part] of parts.entries()) {
        checkAbort(signal);
        const isDirectory = directory || index < parts.length - 1;
        current = await fs.open(
          `/proc/self/fd/${current.fd}/${part}`,
          constants.O_RDONLY |
            constants.O_NOFOLLOW |
            constants.O_NONBLOCK |
            (isDirectory ? constants.O_DIRECTORY : 0)
        );
        handles.push(current);
        await this.verify(current);
      }
      const stat = await current.stat();
      if (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) denied();
      checkAbort(signal);
      const result = await action(current);
      await this.verify(current);
      await this.verify(root);
      checkAbort(signal);
      return result;
    } catch (error) {
      checkAbort(signal);
      if (error instanceof ToolError || error instanceof OpenAICompatibleError) throw error;
      throw new ToolError(
        'FILE_UNAVAILABLE',
        'File or directory is unavailable, protected, or changed during access.'
      );
    } finally {
      for (const handle of handles.reverse()) await handle.close().catch(() => {});
    }
  }

  async read(
    input: string,
    signal: AbortSignal,
    maxBytes = MAX_FILE_BYTES
  ): Promise<{ text: string; bytes: number }> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_FILE_BYTES)
      throw new ToolError('INVALID_ARGUMENTS', 'Invalid file read limit.');
    return this.withHandle(input, false, signal, async (handle) => {
      const before = await handle.stat();
      if (before.size > maxBytes)
        throw new ToolError('FILE_TOO_LARGE', 'File exceeds the permitted read limit.');
      const buffer = Buffer.alloc(Math.min(maxBytes + 1, before.size + 1));
      let total = 0;
      while (total < buffer.length) {
        checkAbort(signal);
        const { bytesRead } = await handle.read(
          buffer,
          total,
          Math.min(65536, buffer.length - total),
          total
        );
        if (!bytesRead) break;
        total += bytesRead;
      }
      if (total > maxBytes)
        throw new ToolError('FILE_TOO_LARGE', 'File exceeds the permitted read limit.');
      const after = await handle.stat();
      if (before.mtimeMs !== after.mtimeMs || before.size !== after.size || after.nlink !== 1) {
        throw new ToolError('FILE_CHANGED', 'File changed during access; retry the read.');
      }
      const contents = buffer.subarray(0, total);
      if (contents.includes(0))
        throw new ToolError('BINARY_FILE', 'Only UTF-8 text files can be read.');
      try {
        return { text: new TextDecoder('utf-8', { fatal: true }).decode(contents), bytes: total };
      } catch {
        throw new ToolError('BINARY_FILE', 'Only UTF-8 text files can be read.');
      }
    });
  }

  /** Create only ordinary directories through pinned parent descriptors. */
  async ensureDirectory(input: string, signal: AbortSignal): Promise<void> {
    const target = this.resolve(input);
    const parts = path.relative(this.root, target).split(path.sep).filter(Boolean);
    for (let index = 0; index < parts.length; index++) {
      const parent = parts.slice(0, index).join('/') || '.';
      await this.withHandle(parent, true, signal, async (handle) => {
        await this.verify(handle);
        checkAbort(signal);
        try {
          await fs.mkdir(`/proc/self/fd/${handle.fd}/${parts[index]}`, { mode: 0o755 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
      });
      // EEXIST is not sufficient: verify it is a real, allowed directory.
      await this.withHandle(parts.slice(0, index + 1).join('/'), true, signal, async () => {});
    }
  }

  /** Atomic single-file replacement, optimistic conflict guard, process-local serialization. */
  async write(
    input: string,
    text: string,
    expectedSha256: string | null,
    signal: AbortSignal
  ): Promise<{ sha256: string; bytes: number }> {
    const target = this.resolve(input);
    if (
      typeof text !== 'string' ||
      text.includes('\0') ||
      Buffer.byteLength(text) > MAX_FILE_BYTES ||
      Buffer.from(text, 'utf8').toString('utf8') !== text
    )
      throw new ToolError('INVALID_CONTENT', 'Only UTF-8 text up to 1 MiB can be written.');
    if (expectedSha256 !== null && !/^[a-f0-9]{64}$/.test(expectedSha256))
      throw new ToolError(
        'INVALID_ARGUMENTS',
        'A SHA-256 from Read or null for a new file is required.'
      );
    const previous = writes.get(target) ?? Promise.resolve();
    const operation = previous
      .catch(() => {})
      .then(async () => {
        checkAbort(signal);
        return this.withHandle(path.dirname(target), true, signal, async (parent) => {
          const destination = `/proc/self/fd/${parent.fd}/${path.basename(target)}`;
          let mode = 0o644;
          const inspect = async () => {
            let file: FileHandle | undefined;
            try {
              file = await fs.open(
                destination,
                constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
              );
              await this.verify(file);
              const stat = await file.stat();
              if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_FILE_BYTES) denied();
              mode = stat.mode & 0o777;
              const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
              let length = 0;
              while (length < buffer.length) {
                checkAbort(signal);
                const { bytesRead } = await file.read(
                  buffer,
                  length,
                  Math.min(65536, buffer.length - length),
                  length
                );
                if (!bytesRead) break;
                length += bytesRead;
              }
              if (length > MAX_FILE_BYTES) denied();
              const bytes = buffer.subarray(0, length);
              if (
                expectedSha256 === null ||
                createHash('sha256').update(bytes).digest('hex') !== expectedSha256
              )
                throw new ToolError('FILE_CONFLICT', 'File changed; Read it again before editing.');
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT' && expectedSha256 === null)
                return;
              if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                throw new ToolError('FILE_CONFLICT', 'File no longer exists; Read it again.');
              throw error;
            } finally {
              await file?.close();
            }
          };
          await inspect();
          const temporary = `/proc/self/fd/${parent.fd}/.direct-write-${randomUUID()}`;
          let handle: FileHandle | undefined;
          try {
            handle = await fs.open(
              temporary,
              constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
              mode
            );
            await handle.writeFile(text, 'utf8');
            await handle.chmod(mode);
            await handle.sync();
            await handle.close();
            handle = undefined;
            await this.verify(parent);
            await inspect();
            checkAbort(signal);
            if (expectedSha256 === null) {
              // link is an exclusive publication; unlike rename it cannot overwrite a racing creator.
              try {
                await fs.link(temporary, destination);
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'EEXIST')
                  throw new ToolError('FILE_CONFLICT', 'File was created concurrently.');
                throw error;
              }
            } else await fs.rename(temporary, destination);
            await parent.sync();
            return { sha256: textHash(text), bytes: Buffer.byteLength(text) };
          } finally {
            await handle?.close().catch(() => {});
            await fs.unlink(temporary).catch(() => {});
          }
        });
      });
    writes.set(target, operation);
    try {
      return await operation;
    } finally {
      if (writes.get(target) === operation) writes.delete(target);
    }
  }

  async list(
    input: string,
    limit: number,
    signal: AbortSignal
  ): Promise<{ entries: Array<{ name: string; type: 'file' | 'directory' }>; truncated: boolean }> {
    return this.withHandle(input, true, signal, async (handle) => {
      const directory = await fs.opendir(`/proc/self/fd/${handle.fd}`);
      const entries: Array<{ name: string; type: 'file' | 'directory' }> = [];
      let truncated = false;
      let inspected = 0;
      try {
        for await (const entry of directory) {
          checkAbort(signal);
          if (++inspected > Math.max(limit * 4, 256)) {
            truncated = true;
            break;
          }
          if ((!entry.isDirectory() && !entry.isFile()) || /[\x00-\x1f\x7f\\]/.test(entry.name))
            continue;
          try {
            this.checkPath(path.join(this.resolve(input), entry.name));
          } catch {
            continue;
          }
          if (entries.length === limit) {
            truncated = true;
            break;
          }
          entries.push({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' });
        }
      } finally {
        await directory.close().catch(() => {});
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      return { entries, truncated };
    });
  }
}
