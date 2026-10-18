import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { TextDecoder } from 'node:util';
import type { DirectAgentOptions } from '@automaker/types';
import type { LocalTool } from './local-tool.js';
import { ReadOnlyWorkspace, MAX_FILE_BYTES, textHash } from './workspace.js';
import { checkAbort, ToolError } from './runtime.js';

type Snapshot = { files: Map<string, string>; directories: string[] };
const MAX_ENTRIES = 2000;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_CHANGED = 100;
const OUTPUT_BYTES = 8000;

function snapshotLimit(): never {
  throw new ToolError(
    'SNAPSHOT_LIMIT',
    'Shell snapshots support at most 2000 entries, depth 16, 16 MiB total, and UTF-8 files up to 1 MiB.'
  );
}

async function sourceSnapshot(
  workspace: ReadOnlyWorkspace,
  signal: AbortSignal
): Promise<Snapshot> {
  const files = new Map<string, string>();
  const directories: string[] = [];
  const queue = ['.'];
  let count = 0;
  let bytes = 0;
  for (let index = 0; index < queue.length; index++) {
    const parent = queue[index];
    const listing = await workspace.list(parent, MAX_ENTRIES, signal);
    if (listing.truncated) snapshotLimit();
    for (const entry of listing.entries) {
      checkAbort(signal);
      const name = path.posix.join(parent, entry.name);
      if (++count > MAX_ENTRIES || name.split('/').length > 16) snapshotLimit();
      if (entry.type === 'directory') {
        directories.push(name);
        queue.push(name);
      } else {
        const file = await workspace.read(name, signal);
        bytes += file.bytes;
        if (bytes > MAX_BYTES) snapshotLimit();
        files.set(name, file.text);
      }
    }
  }
  return { files, directories };
}

/** Parse a bounded tar stream without extracting any paths to the host. */
function resultSnapshot(
  archive: Buffer,
  workspace: ReadOnlyWorkspace,
  signal: AbortSignal
): Snapshot {
  const files = new Map<string, string>();
  const directories: string[] = [];
  let count = 0;
  let bytes = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const seen = new Set<string>();
  let paxPath: string | undefined;
  const invalid = (): never => {
    throw new ToolError(
      'UNSAFE_SNAPSHOT',
      'Shell snapshot contains an unsupported archive entry; no changes imported.'
    );
  };
  const field = (buffer: Buffer) =>
    decoder.decode(buffer.subarray(0, buffer.indexOf(0) < 0 ? buffer.length : buffer.indexOf(0)));
  if (archive.length < 1024 || archive.length % 512 !== 0) invalid();
  let terminated = false;
  // Read the bounded tar in memory; never extract model-controlled archive paths to the host.
  for (let offset = 0; offset + 512 <= archive.length; ) {
    checkAbort(signal);
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      if (offset + 1024 > archive.length || !archive.subarray(offset).every((byte) => byte === 0))
        invalid();
      terminated = true;
      break;
    }
    const checksum = field(header.subarray(148, 156)).trim();
    const sum = header.reduce(
      (total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte),
      0
    );
    if (!/^[0-7]+$/.test(checksum) || Number.parseInt(checksum, 8) !== sum) invalid();
    const octal = field(header.subarray(124, 136)).trim();
    if (!/^[0-7]+$/.test(octal)) invalid();
    const size = Number.parseInt(octal, 8);
    if (
      !Number.isSafeInteger(size) ||
      size > MAX_FILE_BYTES ||
      offset + 512 + size > archive.length
    )
      snapshotLimit();
    const contents = archive.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    const type = String.fromCharCode(header[156]);
    if (++count > MAX_ENTRIES * 2) snapshotLimit();
    if (type === 'x') {
      let position = 0;
      while (position < contents.length) {
        const space = contents.indexOf(32, position);
        if (space < position || !/^\d+$/.test(contents.subarray(position, space).toString('ascii')))
          invalid();
        const length = Number(contents.subarray(position, space).toString('ascii'));
        if (
          !Number.isSafeInteger(length) ||
          length <= space - position + 1 ||
          position + length > contents.length
        )
          invalid();
        const record = decoder.decode(contents.subarray(space + 1, position + length - 1));
        const equals = record.indexOf('=');
        const key = record.slice(0, equals);
        if (key === 'path') paxPath = record.slice(equals + 1);
        else if (!['mtime', 'atime', 'ctime', 'uid', 'gid', 'uname', 'gname'].includes(key))
          invalid();
        position += length;
      }
      continue;
    }
    const prefix = field(header.subarray(345, 500));
    const raw = paxPath ?? (prefix ? `${prefix}/` : '') + field(header.subarray(0, 100));
    paxPath = undefined;
    if (path.posix.isAbsolute(raw) || raw.split('/').includes('..')) invalid();
    const name = path.posix.normalize(raw).replace(/\/$/, '');
    if (name === '.' && type === '5') continue;
    workspace.assertAllowedPath(name);
    if (seen.has(name) || name.split('/').length > 16 || seen.size >= MAX_ENTRIES) invalid();
    seen.add(name);
    if (type === '5' && size === 0) directories.push(name);
    else if (type === '0' || type === '\0') {
      bytes += size;
      if (bytes > MAX_BYTES || contents.includes(0)) snapshotLimit();
      files.set(name, decoder.decode(contents));
    } else invalid();
  }
  if (paxPath || !terminated) invalid();
  return { files, directories };
}

/** No shell interpolation and no inherited process environment (including Docker/endpoint secrets). */
function docker(
  args: string[],
  archive = false
): {
  child: ReturnType<typeof spawn>;
  done: Promise<{ code: number; output: string; truncated: boolean; archive: Buffer }>;
} {
  const child = spawn('/usr/bin/docker', ['--host', 'unix:///var/run/docker.sock', ...args], {
    env: { PATH: '/usr/bin:/bin' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let size = 0;
  let truncated = false;
  const chunks: Buffer[] = [];
  const archiveChunks: Buffer[] = [];
  let archiveSize = 0;
  let oversized = false;
  const consume = (chunk: Buffer) => {
    const remaining = OUTPUT_BYTES - size;
    if (chunk.length > remaining) truncated = true;
    if (remaining > 0) {
      chunks.push(chunk.subarray(0, remaining));
      size += Math.min(chunk.length, remaining);
    }
  };
  child.stdout!.on(
    'data',
    archive
      ? (chunk: Buffer) => {
          archiveSize += chunk.length;
          if (archiveSize > MAX_BYTES + MAX_ENTRIES * 2048) {
            oversized = true;
            child.kill('SIGKILL');
          } else archiveChunks.push(chunk);
        }
      : consume
  );
  child.stderr!.on('data', consume);
  const done = new Promise<{ code: number; output: string; truncated: boolean; archive: Buffer }>(
    (resolve, reject) => {
      child.once('error', () =>
        reject(
          new ToolError(
            'SANDBOX_UNAVAILABLE',
            'Docker sandbox is unavailable. No host shell fallback is allowed.'
          )
        )
      );
      child.once('close', (code) => {
        if (oversized)
          reject(new ToolError('SNAPSHOT_LIMIT', 'Shell snapshot exceeded the export limit.'));
        else
          resolve({
            code: code ?? 125,
            output: Buffer.concat(chunks).toString('utf8'),
            truncated,
            archive: Buffer.concat(archiveChunks),
          });
      });
    }
  );
  return { child, done };
}

async function removeContainer(name: string): Promise<void> {
  const cleanup = docker(['rm', '--force', name]);
  const timer = setTimeout(() => cleanup.child.kill('SIGKILL'), 5000);
  try {
    const result = await cleanup.done;
    if (result.code !== 0 && !result.output.includes('No such container'))
      throw new ToolError(
        'SANDBOX_CLEANUP_FAILED',
        `Could not confirm sandbox removal: ${name}. Check the local Docker daemon.`
      );
  } finally {
    clearTimeout(timer);
  }
}

export function createShellTool(
  workspace: ReadOnlyWorkspace,
  config: NonNullable<DirectAgentOptions['shell']>,
  writable: boolean,
  timeoutMs = 65_000
): LocalTool {
  const executable = config.executable ?? 'sh';
  return {
    effect: 'shell',
    definition: {
      type: 'function',
      function: {
        name: executable === 'pwsh' ? 'PowerShell' : 'Bash',
        description: `Run ${executable} in an offline Docker snapshot, never the host. Only bounded UTF-8 projects are supported; no symlinks, metadata, dependencies/binaries or deletions. ${writable ? 'Text additions/edits (max 100) are conflict-checked and imported even after a nonzero exit. Cancellation before import discards the snapshot. Import is atomic per file, NOT per batch; on interruption inspect source files before retrying.' : 'Workspace is mounted read-only; changes are never imported.'} Output is bounded. Git metadata is intentionally absent.`,
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['command'],
          properties: {
            command: { type: 'string', minLength: 1, maxLength: 16384 },
            cwd: { type: 'string', minLength: 1, maxLength: 4096 },
          },
        },
      },
    },
    async execute(args, signal) {
      checkAbort(signal);
      const before = await sourceSnapshot(workspace, signal);
      const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'automaker-direct-shell-'));
      const stage = path.join(temporary, 'workspace');
      const name = `automaker-direct-${randomUUID()}`;
      let running: ReturnType<typeof docker> | undefined;
      let aborted = false;
      let removal: Promise<void> | undefined;
      let runtimeTimer: ReturnType<typeof setTimeout> | undefined;
      const cancel = () => {
        aborted = true;
        // Kill the container first, not just its client: descendants may detach from their shell.
        removal ??= removeContainer(name);
        void removal.finally(() => running?.child.kill('SIGKILL')).catch(() => {});
      };
      const invoke = async (command: string[], archive = false) => {
        checkAbort(signal);
        running = docker(command, archive);
        const result = await running.done;
        await removal;
        checkAbort(signal);
        if (aborted) throw new ToolError('SANDBOX_TIMEOUT', 'Sandbox exceeded its runtime limit.');
        return result;
      };
      try {
        await fs.mkdir(stage, { mode: 0o755 });
        for (const directory of before.directories) {
          checkAbort(signal);
          await fs.mkdir(path.join(stage, directory), { mode: 0o755 });
        }
        for (const [file, text] of before.files) {
          checkAbort(signal);
          await fs.writeFile(path.join(stage, file), text, { mode: 0o644, flag: 'wx' });
        }
        const cwd = (args.cwd as string | undefined) ?? '.';
        if (
          /[\x00-\x1f\x7f\\]/.test(cwd) ||
          path.posix.isAbsolute(cwd) ||
          cwd.split('/').includes('..')
        )
          throw new ToolError('PATH_DENIED', 'Shell cwd must be a directory inside the snapshot.');
        if (!(await fs.stat(path.join(stage, cwd))).isDirectory())
          throw new ToolError('PATH_DENIED', 'Shell cwd must be a directory inside the snapshot.');
        if (stage.includes(','))
          throw new ToolError(
            'SANDBOX_UNAVAILABLE',
            'Unsupported temporary directory for Docker mounts.'
          );
        checkAbort(signal);
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
        runtimeTimer = setTimeout(() => {
          cancel();
          running?.child.kill('SIGKILL');
        }, timeoutMs);
        const imageConfig = await invoke([
          'image',
          'inspect',
          '--format',
          '{{json .Config.Volumes}}',
          config.image,
        ]);
        if (imageConfig.code !== 0 || !['null', '{}'].includes(imageConfig.output.trim()))
          throw new ToolError(
            'SANDBOX_UNAVAILABLE',
            'The pinned local image is unavailable or declares writable Docker volumes.'
          );
        const commandArgs =
          executable === 'pwsh'
            ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', args.command as string]
            : ['-c', args.command as string];
        const runtimeArgs = [
          'run',
          '--detach',
          '--name',
          name,
          '--label',
          `automaker.direct.workspace=${textHash(workspace.root)}`,
          '--pull',
          'never',
          '--rm',
          '--network',
          'none',
          '--read-only',
          '--no-healthcheck',
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges',
          '--pids-limit',
          '64',
          '--memory',
          '256m',
          '--cpus',
          '1',
          '--ulimit',
          'nofile=256:256',
          '--user',
          `${process.getuid!() || 65534}:${process.getgid!() || 65534}`,
          '--tmpfs',
          '/tmp:rw,nosuid,nodev,noexec,size=32m,mode=1777',
          '--tmpfs',
          '/home/agent:rw,nosuid,nodev,noexec,size=8m,mode=1777',
          '--env',
          'HOME=/home/agent',
          '--env',
          'PATH=/usr/local/bin:/usr/bin:/bin',
          '--env',
          'LANG=C.UTF-8',
          '--mount',
          `type=bind,src=${stage},dst=${writable ? '/input' : '/workspace'},readonly`,
          ...(writable ? ['--tmpfs', '/workspace:rw,nosuid,nodev,size=32m,mode=1777'] : []),
          '--entrypoint',
          '/bin/sh',
          config.image,
          '-c',
          'while :; do sleep 3600; done',
        ];
        const started = await invoke(runtimeArgs);
        if (started.code !== 0)
          throw new ToolError(
            'SANDBOX_UNAVAILABLE',
            'Docker image/runtime or shell is unavailable. No host fallback was executed.'
          );
        const result = await invoke([
          'exec',
          name,
          '/bin/sh',
          '-c',
          writable
            ? 'cp -R /input/. /workspace/ || exit 125; cd "$1" || exit 125; shift; exec "$@"'
            : 'cd "$1" || exit 125; shift; exec "$@"',
          'agent-shell',
          path.posix.join('/workspace', cwd),
          executable,
          ...commandArgs,
        ]);
        const changed: string[] = [];
        if (writable) {
          // docker cp does not export the live contents of this tmpfs mount. Execute
          // the trusted image's tar, without dereferencing links; parse bytes, never extract.
          const exported = await invoke(
            ['exec', name, '/bin/tar', '-c', '-f', '-', '-C', '/workspace', '.'],
            true
          );
          if (exported.code !== 0)
            throw new ToolError('SANDBOX_UNAVAILABLE', 'Could not export sandbox changes.');
          const after = resultSnapshot(exported.archive, workspace, signal);
          // No container processes are left running while importing the detached snapshot.
          await removeContainer(name);
          checkAbort(signal);
          if ([...before.files.keys()].some((file) => !after.files.has(file)))
            throw new ToolError(
              'DELETION_UNSUPPORTED',
              'Shell deleted a file; no snapshot changes imported.'
            );
          for (const [file, text] of after.files)
            if (before.files.get(file) !== text) changed.push(file);
          if (changed.length > MAX_CHANGED)
            throw new ToolError(
              'SNAPSHOT_LIMIT',
              'Shell changed more than 100 files; no changes imported.'
            );
          // Preflight the original source before any import, then recheck each file at publication.
          for (const file of changed) {
            const original = before.files.get(file);
            if (
              original !== undefined &&
              textHash((await workspace.read(file, signal)).text) !== textHash(original)
            )
              throw new ToolError(
                'FILE_CONFLICT',
                'Workspace changed during shell execution; no changes imported.'
              );
          }
          for (const file of changed) {
            checkAbort(signal);
            await workspace.ensureDirectory(path.posix.dirname(file), signal);
            await workspace.write(
              file,
              after.files.get(file)!,
              before.files.has(file) ? textHash(before.files.get(file)!) : null,
              signal
            );
          }
        }
        return {
          exitCode: result.code,
          output: result.output,
          truncated: result.truncated,
          changedFiles: changed,
        };
      } finally {
        clearTimeout(runtimeTimer);
        signal.removeEventListener('abort', cancel);
        try {
          // Also covers cancellation racing container creation or a failed Docker client.
          if (running) await removeContainer(name);
        } finally {
          // Explicit, task-owned mkdtemp path; the command never sees its parent.
          await fs.rm(temporary, { recursive: true, force: true });
        }
      }
    },
  };
}
