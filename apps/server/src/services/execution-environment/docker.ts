import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { atomicWriteJson } from '@automaker/utils';
import type { DockerPreparationResult, DockerProjectBinding } from '@automaker/types';
import type { SettingsService } from '../settings-service.js';
import { WorkerStream } from './worker-stream.js';
import { dockerArguments, dockerJson, runDocker, type DockerRunner } from './docker-command.js';
import {
  DOCKER_CANCEL,
  DOCKER_INIT,
  DOCKER_WORKER,
  MANAGED_DOCKERFILE,
  WORKER_VERSION,
} from './docker-worker.js';
import {
  ExecutionEnvironmentError,
  type EnvironmentCommandResult,
  type EnvironmentEntry,
  type EnvironmentSearchOptions,
  type EnvironmentSearchResult,
  type ExecutionEnvironment,
  type EnvironmentProcessOutput,
  type EnvironmentProcessRequest,
} from './runtime.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const locks = new Map<string, Promise<unknown>>();
async function locked<T>(key: string, work: () => Promise<T>): Promise<T> {
  const next = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
  locks.set(key, next);
  try {
    return await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}
function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}
export class DockerPreflightError extends ExecutionEnvironmentError {
  constructor(message: string) {
    super('DOCKER_PREFLIGHT_UNAVAILABLE', message);
  }
}
interface Mount {
  Type: string;
  Source: string;
  Destination: string;
  Name?: string;
  RW: boolean;
}
interface Container {
  Id: string;
  Image: string;
  State: { Running: boolean };
  Config: {
    Labels: Record<string, string>;
    User: string;
    Env: string[];
    Entrypoint: string[];
    Cmd: string[];
    Volumes?: unknown;
  };
  Mounts: Mount[];
  HostConfig: {
    Privileged: boolean;
    NetworkMode: string;
    PidMode: string;
    IpcMode: string;
    CapDrop: string[];
    CapAdd?: string[];
    SecurityOpt: string[];
    Devices?: unknown[];
    PortBindings?: Record<string, unknown>;
    Binds?: string[];
    Mounts?: Array<{
      Type: string;
      Source: string;
      Target: string;
      VolumeOptions?: { Subpath?: string };
    }>;
  };
}

/** One controller per DATA_DIR. No broad prune, volumes-from, host network, or agent socket. */
export class ManagedDocker {
  private readonly directory: string;
  constructor(
    private readonly settings: SettingsService,
    readonly runner: DockerRunner = runDocker
  ) {
    this.directory = path.join(settings.getDataDirectory(), 'execution-environments', 'docker');
  }
  async owner(): Promise<string> {
    const file = path.join(this.directory, 'installation.json');
    return locked(file, async () => {
      await fs.mkdir(this.directory, { recursive: true });
      try {
        const value = JSON.parse(await fs.readFile(file, 'utf8')) as { id: string };
        if (!/^[a-f0-9]{64}$/.test(value.id)) throw new Error('invalid');
        return value.id;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new ExecutionEnvironmentError(
            'DOCKER_STATE_INVALID',
            'Docker installation state is invalid. No resources were modified.'
          );
      }
      const id = hash(randomUUID());
      await atomicWriteJson(file, { id }, { mode: 0o600 });
      return id;
    });
  }
  /** Read a previously prepared descriptor. Viewing provider setup must not create a container. */
  async existing(projectPath: string, context?: string): Promise<DockerProjectBinding | undefined> {
    projectPath = await fs.realpath(projectPath);
    let stored: DockerProjectBinding;
    try {
      stored = JSON.parse(
        await fs.readFile(path.join(this.directory, `${hash(projectPath)}.json`), 'utf8')
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    if (
      stored.projectPath !== projectPath ||
      stored.context !== context ||
      stored.owner !== (await this.owner())
    )
      throw new ExecutionEnvironmentError(
        'DOCKER_PROJECT_PINNED',
        'Prepared project container does not match the saved target. No fallback or migration was performed.'
      );
    return stored;
  }
  async preflight(projectPath: string, cwd: string, context?: string, signal?: AbortSignal) {
    if (process.platform === 'win32')
      throw new DockerPreflightError(
        'Managed Docker currently requires POSIX project paths. Use Linux/WSL, macOS or a Linux Automaker server.'
      );
    try {
      const engine = await dockerJson<{ ID: string; OSType: string }>(
        this.runner,
        context,
        ['info', '--format', '{{json .}}'],
        signal
      );
      if (!engine.ID || engine.OSType !== 'linux') throw new Error('Linux Engine required');
      if (
        !inside(projectPath, cwd) ||
        [
          '/',
          '/app',
          '/data',
          '/home',
          '/root',
          '/tmp',
          '/etc',
          '/usr',
          '/var',
          '/run',
          '/dev',
          '/proc',
          '/sys',
          '/boot',
          '/opt',
        ].includes(projectPath) ||
        projectPath === os.homedir() ||
        inside(projectPath, path.resolve(this.settings.getDataDirectory()))
      )
        throw new DockerPreflightError(
          'Mount a dedicated project directory, not a filesystem/home/data root. Worktrees must be inside that project.'
        );
      for (const directory of new Set([projectPath, cwd])) {
        const git = path.join(directory, '.git');
        const stat = await fs.lstat(git).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
        if (!stat) continue;
        const referenced = stat.isFile()
          ? path.resolve(
              directory,
              (await fs.readFile(git, 'utf8')).trim().replace(/^gitdir: /, '')
            )
          : await fs.realpath(git);
        if (!inside(projectPath, referenced))
          throw new DockerPreflightError(
            'This worktree references Git metadata outside the project. Select the main repository as project root.'
          );
        const gitPath = await fs.realpath(referenced);
        if (!inside(projectPath, gitPath))
          throw new DockerPreflightError(
            'This worktree references Git metadata outside the project. Select the main repository as project root; external worktrees are not mounted automatically.'
          );
        const common = await fs
          .readFile(path.join(gitPath, 'commondir'), 'utf8')
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error;
            return undefined;
          });
        if (common && !inside(projectPath, await fs.realpath(path.resolve(gitPath, common.trim()))))
          throw new DockerPreflightError(
            'This worktree references Git metadata outside the project. Select the main repository as project root.'
          );
      }
      let mount: DockerProjectBinding['mount'] = { type: 'bind', source: projectPath };
      if (process.env.IS_CONTAINERIZED === 'true') {
        const controller = process.env.AUTOMAKER_DOCKER_CONTROLLER || os.hostname();
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/.test(controller))
          throw new Error('Invalid controller identity');
        const mounts = await dockerJson<Mount[]>(
          this.runner,
          context,
          ['inspect', '--format', '{{json .Mounts}}', controller],
          signal
        );
        const parent = mounts
          .filter((item) => inside(item.Destination, projectPath))
          .sort((a, b) => b.Destination.length - a.Destination.length)[0];
        if (
          !parent?.RW ||
          mounts.some(
            (item) => item.Destination !== projectPath && inside(projectPath, item.Destination)
          )
        )
          throw new DockerPreflightError(
            'Project storage must be a writable bind mount or named volume of the Automaker server, without nested mounts. Projects in its disposable writable layer cannot be shared safely.'
          );
        const relative = path.relative(parent.Destination, projectPath);
        if (parent.Type === 'bind')
          mount = { type: 'bind', source: path.join(parent.Source, relative) };
        else if (parent.Type === 'volume' && parent.Name)
          mount = { type: 'volume', source: parent.Name, ...(relative && { subpath: relative }) };
        else
          throw new DockerPreflightError(
            'Unsupported project storage. Use a dedicated bind mount or named volume.'
          );
      }
      for (const value of [projectPath, mount.source, mount.subpath ?? ''])
        if (/[\x00-\x1f\x7f,]/.test(value))
          throw new DockerPreflightError(
            'Docker mount paths cannot contain commas or control characters.'
          );
      return {
        engineId: engine.ID,
        context,
        projectPath,
        mount,
        user: `${os.userInfo().uid}:${os.userInfo().gid}`,
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof DockerPreflightError) throw error;
      throw new DockerPreflightError(
        'Docker Engine or project mapping is unavailable from the Automaker server. Check Docker access and shared storage. No Local fallback was performed.'
      );
    }
  }
  private async image(context?: string, signal?: AbortSignal): Promise<string> {
    const tag = `automaker-execution:worker-${WORKER_VERSION}`;
    return locked(`image:${context ?? 'default'}`, async () => {
      let result = await this.runner(dockerArguments(context, ['image', 'inspect', tag]), {
        signal,
      });
      if (result.code !== 0) {
        result = await this.runner(dockerArguments(context, ['build', '--tag', tag, '-']), {
          input: MANAGED_DOCKERFILE,
          signal,
          timeoutMs: 600_000,
        });
        if (result.code !== 0)
          throw new ExecutionEnvironmentError(
            'DOCKER_IMAGE_FAILED',
            'Managed image preparation failed. Check Engine build permissions, registry/network access and disk space. No Local fallback was performed.'
          );
        result = await this.runner(dockerArguments(context, ['image', 'inspect', tag]), { signal });
      }
      let images: Array<{
        Id: string;
        Config: { Labels?: Record<string, string>; Volumes?: unknown };
      }>;
      try {
        images = JSON.parse(result.stdout);
      } catch {
        throw new ExecutionEnvironmentError(
          'DOCKER_IMAGE_INVALID',
          'Managed image could not be verified.'
        );
      }
      const image = images[0];
      if (
        result.code !== 0 ||
        !/^sha256:[a-f0-9]{64}$/.test(image?.Id) ||
        image.Config.Labels?.['dev.automaker.worker'] !== WORKER_VERSION ||
        image.Config.Volumes
      )
        throw new ExecutionEnvironmentError(
          'DOCKER_IMAGE_INVALID',
          'Managed image identity/version is invalid. Refusing to run an unverified image.'
        );
      return image.Id;
    });
  }
  async prepare(
    projectPath: string,
    cwd: string,
    context?: string,
    signal?: AbortSignal
  ): Promise<DockerProjectBinding> {
    const planned = await this.preflight(projectPath, cwd, context, signal);
    const owner = await this.owner();
    const file = path.join(this.directory, `${hash(projectPath)}.json`);
    return locked(file, async () => {
      let stored: DockerProjectBinding | undefined;
      try {
        stored = JSON.parse(await fs.readFile(file, 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new ExecutionEnvironmentError(
            'DOCKER_STATE_INVALID',
            'Project Docker state is unreadable. Inspect state before retrying.'
          );
      }
      if (stored) {
        if (
          stored.owner !== owner ||
          stored.engineId !== planned.engineId ||
          stored.context !== context ||
          JSON.stringify(stored.mount) !== JSON.stringify(planned.mount) ||
          stored.user !== planned.user
        )
          throw new ExecutionEnvironmentError(
            'DOCKER_PROJECT_PINNED',
            'This project already has a different pinned Docker environment. No migration or Local fallback was performed.'
          );
        await this.verify(stored, signal);
        await this.start(stored, signal);
        await this.verifyStorage(stored, signal);
        return stored;
      }
      const imageId = await this.image(context, signal);
      const descriptor = { ...planned, owner, imageId, containerId: '' };
      const name = `automaker-project-${hash(owner + projectPath).slice(0, 32)}`;
      const found = await this.runner(dockerArguments(context, ['container', 'inspect', name]), {
        signal,
      });
      if (found.code === 0) {
        const containers = JSON.parse(found.stdout) as Container[];
        descriptor.containerId = containers[0]?.Id;
        await this.verify(descriptor, signal);
      } else {
        const mount = `type=${planned.mount.type},source=${planned.mount.source},target=${projectPath}${planned.mount.subpath ? `,volume-subpath=${planned.mount.subpath}` : ''}${planned.mount.type === 'bind' ? ',bind-recursive=disabled' : ',volume-nocopy'}`;
        const result = await this.runner(
          dockerArguments(context, [
            'create',
            '--name',
            name,
            '--label',
            `dev.automaker.owner=${owner}`,
            '--label',
            `dev.automaker.project=${hash(projectPath)}`,
            '--label',
            `dev.automaker.spec=${this.spec(descriptor)}`,
            '--user',
            planned.user,
            '--cap-drop',
            'ALL',
            '--security-opt',
            'no-new-privileges:true',
            '--pids-limit',
            '512',
            '--env',
            'HOME=/tmp/automaker-home',
            '--workdir',
            projectPath,
            '--mount',
            mount,
            '--entrypoint',
            'node',
            imageId,
            '-e',
            DOCKER_INIT,
          ]),
          { signal }
        );
        if (result.code !== 0 || !/^[a-f0-9]{64}$/.test(result.stdout.trim()))
          throw new ExecutionEnvironmentError(
            'DOCKER_CREATE_FAILED',
            'Project container creation failed. Check Engine permissions, mount paths and volume-subpath support (Engine 26+). No Local fallback was performed.'
          );
        descriptor.containerId = result.stdout.trim();
        await this.verify(descriptor, signal);
      }
      await this.start(descriptor, signal);
      // Persist before testing: an interrupted preparation is recovered, not recreated elsewhere.
      await atomicWriteJson(file, descriptor, { mode: 0o600 });
      await this.verifyStorage(descriptor, signal);
      return descriptor;
    });
  }
  private spec(binding: DockerProjectBinding) {
    return hash(
      JSON.stringify([
        WORKER_VERSION,
        binding.owner,
        binding.engineId,
        binding.projectPath,
        binding.mount,
        binding.imageId,
        binding.user,
      ])
    );
  }
  async verify(binding: DockerProjectBinding, signal?: AbortSignal): Promise<Container> {
    if (binding.owner !== (await this.owner()) || !/^[a-f0-9]{64}$/.test(binding.containerId))
      throw new ExecutionEnvironmentError(
        'DOCKER_OWNERSHIP_INVALID',
        'Docker resource does not belong to this installation.'
      );
    const engine = await dockerJson<{ ID: string }>(
      this.runner,
      binding.context,
      ['info', '--format', '{{json .}}'],
      signal
    );
    if (engine.ID !== binding.engineId)
      throw new ExecutionEnvironmentError(
        'DOCKER_ENGINE_CHANGED',
        'Docker context now points to a different Engine. Pinned runs are not migrated.'
      );
    const [container] = await dockerJson<Container[]>(
      this.runner,
      binding.context,
      ['container', 'inspect', binding.containerId],
      signal
    );
    const host = container?.HostConfig;
    const mount = container?.Mounts?.[0];
    if (
      !container ||
      container.Id !== binding.containerId ||
      container.Image !== binding.imageId ||
      container.Config.Labels?.['dev.automaker.owner'] !== binding.owner ||
      container.Config.Labels?.['dev.automaker.project'] !== hash(binding.projectPath) ||
      container.Config.Labels?.['dev.automaker.spec'] !== this.spec(binding) ||
      container.Config.User !== binding.user ||
      JSON.stringify(container.Config.Entrypoint) !== JSON.stringify(['node']) ||
      JSON.stringify(container.Config.Cmd) !== JSON.stringify(['-e', DOCKER_INIT]) ||
      host.Privileged ||
      ['host', 'container'].some((mode) => host.NetworkMode.startsWith(mode)) ||
      host.PidMode ||
      !['private', ''].includes(host.IpcMode) ||
      host.CapAdd?.length ||
      !host.CapDrop?.includes('ALL') ||
      !host.SecurityOpt?.some((value) => value.startsWith('no-new-privileges')) ||
      host.Devices?.length ||
      Object.keys(host.PortBindings ?? {}).length ||
      container.Mounts.length !== 1 ||
      mount.Destination !== binding.projectPath ||
      !mount.RW ||
      mount.Type !== binding.mount.type ||
      (binding.mount.type === 'bind'
        ? mount.Source !== binding.mount.source
        : mount.Name !== binding.mount.source) ||
      (binding.mount.type === 'volume' &&
        (host.Mounts?.[0]?.VolumeOptions?.Subpath ?? '') !== (binding.mount.subpath ?? ''))
    )
      throw new ExecutionEnvironmentError(
        'DOCKER_CONFIGURATION_CHANGED',
        'Project container configuration/ownership is not the managed configuration. Refusing to use or remove it.'
      );
    return container;
  }
  async start(binding: DockerProjectBinding, signal?: AbortSignal) {
    return locked(`start:${binding.containerId}`, async () => {
      const container = await this.verify(binding, signal);
      if (!container.State.Running) {
        const result = await this.runner(
          dockerArguments(binding.context, ['start', binding.containerId]),
          { signal }
        );
        if (result.code !== 0)
          throw new ExecutionEnvironmentError(
            'DOCKER_START_FAILED',
            'Project container could not start. No commands were replayed.'
          );
      }
    });
  }
  async verifyStorage(binding: DockerProjectBinding, signal?: AbortSignal) {
    const file = path.join(binding.projectPath, `.automaker-storage-${randomUUID()}`);
    const nonce = randomUUID();
    const environment = new DockerExecutionEnvironment(this, binding, binding.projectPath);
    const active = signal ?? new AbortController().signal;
    let created = false;
    try {
      active.throwIfAborted();
      const handle = await fs.open(file, 'wx', 0o600);
      created = true;
      try {
        await handle.writeFile(nonce);
      } finally {
        await handle.close();
      }
      const observed = await environment.readFile(file, 0, 1024, active);
      if (observed.data.toString() !== nonce) throw new Error('different working copy');
      await environment.writeFile(file, Buffer.from(nonce + '-worker'), active);
      if ((await fs.readFile(file, 'utf8')) !== nonce + '-worker')
        throw new Error('write not shared');
    } catch {
      throw new ExecutionEnvironmentError(
        'DOCKER_STORAGE_UNVERIFIED',
        'Container and Automaker do not share a writable project directory. Check daemon-host mount mapping and UID/GID permissions. No Local fallback was performed.'
      );
    } finally {
      if (created) await fs.unlink(file).catch(() => {});
    }
  }
  async probe(
    context?: string,
    projectPath?: string,
    signal?: AbortSignal
  ): Promise<DockerPreparationResult> {
    const imageId = await this.image(context, signal);
    const owner = await this.owner();
    const name = `automaker-probe-${randomUUID()}`;
    let id: string | undefined;
    try {
      const created = await this.runner(
        dockerArguments(context, [
          'create',
          '--name',
          name,
          '--label',
          `dev.automaker.owner=${owner}`,
          '--label',
          'dev.automaker.probe=true',
          '--network',
          'none',
          '--read-only',
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges:true',
          '--entrypoint',
          'node',
          imageId,
          '-e',
          'setInterval(()=>{},1000)',
        ]),
        { signal }
      );
      if (created.code !== 0 || !/^[a-f0-9]{64}$/.test(created.stdout.trim()))
        throw new Error('create');
      id = created.stdout.trim();
      for (const args of [
        ['start', id],
        ['exec', id, 'node', '-e', 'process.stdout.write("automaker-probe-ok")'],
      ]) {
        const result = await this.runner(dockerArguments(context, args), { signal });
        if (result.code !== 0 || (args[0] === 'exec' && result.stdout !== 'automaker-probe-ok'))
          throw new Error('lifecycle');
      }
    } catch {
      throw new ExecutionEnvironmentError(
        'DOCKER_LIFECYCLE_FAILED',
        'Docker create/start/exec probe failed. Check Engine lifecycle permissions and image compatibility. Project storage is not verified.'
      );
    } finally {
      // Recover even if create completed at the daemon but its client was cancelled.
      // Cleanup failure deliberately takes precedence over the original probe error.
      await (async () => {
        const found = await this.runner(
          dockerArguments(context, ['container', 'inspect', id ?? name]),
          { timeoutMs: 8000 }
        );
        if (found.code === 0) {
          const [container] = JSON.parse(found.stdout) as Container[];
          if (
            container.Config.Labels?.['dev.automaker.owner'] !== owner ||
            container.Config.Labels?.['dev.automaker.probe'] !== 'true' ||
            container.Mounts.length
          )
            throw new ExecutionEnvironmentError(
              'DOCKER_PROBE_CLEANUP_FAILED',
              'Probe ownership could not be verified. No foreign resources were removed.'
            );
          const removed = await this.runner(
            dockerArguments(context, ['rm', '--force', container.Id]),
            { timeoutMs: 8000 }
          );
          if (removed.code !== 0)
            throw new ExecutionEnvironmentError(
              'DOCKER_PROBE_CLEANUP_FAILED',
              `Probe cleanup failed. Inspect the Automaker probe ${name} before retrying.`
            );
        } else {
          const remaining = await this.runner(
            dockerArguments(context, [
              'container',
              'ls',
              '--all',
              '--filter',
              `name=^/${name}$`,
              '--format',
              '{{.ID}}',
            ]),
            { timeoutMs: 8000 }
          );
          if (remaining.code !== 0 || remaining.stdout.trim())
            throw new ExecutionEnvironmentError(
              'DOCKER_PROBE_CLEANUP_FAILED',
              `Probe cleanup could not be verified. Inspect ${name} before retrying.`
            );
        }
      })();
    }
    let binding: DockerProjectBinding | undefined;
    if (projectPath) {
      binding = await this.prepare(projectPath, projectPath, context, signal);
      await this.verifyStorage(binding, signal);
    }
    return {
      connection: 'available',
      containerLifecycle: 'verified',
      projectStorage: binding ? 'verified' : 'not-tested',
      checkedAt: new Date().toISOString(),
      ...(binding && { containerId: binding.containerId }),
      message: binding
        ? 'Docker lifecycle and bidirectional project storage verified. Project container is ready.'
        : 'Docker lifecycle verified without host mounts. Select a project to verify its storage separately.',
    };
  }
}

export class DockerExecutionEnvironment implements ExecutionEnvironment {
  readonly type = 'docker' as const;
  readonly platform = 'linux' as const;
  readonly capabilities = Object.freeze({
    shell: true,
    binaryFiles: true,
    remove: true,
    sandboxed: true,
  });
  constructor(
    private readonly manager: ManagedDocker,
    readonly binding: DockerProjectBinding,
    readonly cwd: string
  ) {}
  private async call<T>(
    operation: string,
    args: object,
    signal: AbortSignal,
    output?: EnvironmentProcessOutput
  ): Promise<T> {
    signal.throwIfAborted();
    await this.manager.start(this.binding, signal);
    const id = randomUUID();
    const command = [
      'exec',
      '-i',
      '--workdir',
      this.cwd,
      this.binding.containerId,
      'node',
      '-e',
      DOCKER_WORKER,
      id,
    ];
    const client = new AbortController();
    const timeout =
      operation === 'process'
        ? Math.min((args as EnvironmentProcessRequest).timeoutMs ?? 600_000, 600_000) + 8000
        : operation === 'exec'
          ? Math.min(
              (args as { options?: { timeoutMs?: number } }).options?.timeoutMs ?? 180_000,
              600_000
            ) + 8000
          : 60_000;
    const stream = output ? new WorkerStream(output) : undefined;
    const request = this.manager.runner(dockerArguments(this.binding.context, command), {
      input: JSON.stringify({ operation, args }),
      timeoutMs: timeout,
      signal: client.signal,
      maximum: stream ? 48 * 1024 * 1024 : undefined,
      onStdout: stream?.push,
    });
    let cancellation: Promise<void> | undefined;
    const cancel = () => {
      cancellation ??= this.manager
        .runner(
          dockerArguments(this.binding.context, [
            'exec',
            this.binding.containerId,
            'node',
            '-e',
            DOCKER_CANCEL,
            id,
          ]),
          { timeoutMs: 6000 }
        )
        .then((result) => {
          if (result.code !== 0) throw new Error('unverified');
        })
        .finally(() => client.abort());
      void cancellation.catch(() => {});
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    try {
      let result;
      try {
        result = await request;
      } catch (error) {
        cancel();
        throw error;
      }
      if (signal.aborted)
        throw new ExecutionEnvironmentError(
          'PROCESS_INTERRUPTED',
          'Container operation interrupted. Effects are not rolled back; do not blindly retry.'
        );
      if (result.code !== 0) {
        cancel();
        throw new ExecutionEnvironmentError(
          'DOCKER_WORKER_FAILED',
          'Docker worker disconnected. The operation result is unknown; do not automatically repeat it.'
        );
      }
      let response: { ok: boolean; value: T; error?: { code: string; message: string } };
      try {
        response = JSON.parse(stream ? stream.finish() : result.stdout);
      } catch {
        cancel();
        throw new ExecutionEnvironmentError(
          'DOCKER_WORKER_FAILED',
          'Invalid worker response; command outcome may be unknown.'
        );
      }
      if (!response.ok)
        throw new ExecutionEnvironmentError(
          response.error?.code ?? 'ENVIRONMENT_IO_ERROR',
          response.error?.message ?? 'Container operation failed.'
        );
      return response.value;
    } finally {
      signal.removeEventListener('abort', cancel);
      await cancellation?.catch(() => {
        throw new ExecutionEnvironmentError(
          'PROCESS_CLEANUP_FAILED',
          'Container operation cleanup could not be verified. Inspect the project container before retrying. No commands were replayed.'
        );
      });
    }
  }
  async readFile(file: string, offset: number, length: number, signal: AbortSignal) {
    const result = await this.call<{ data: string; size: number }>(
      'read',
      { path: file, offset, length },
      signal
    );
    return { data: Buffer.from(result.data, 'base64'), size: result.size };
  }
  search(options: EnvironmentSearchOptions, signal: AbortSignal) {
    return this.call<EnvironmentSearchResult>('search', options, signal);
  }
  writeFile(file: string, data: Buffer, signal: AbortSignal, expectedSha256?: string | null) {
    return this.call<void>(
      'write',
      { path: file, data: data.toString('base64'), expectedSha256 },
      signal
    );
  }
  listDirectory(directory: string, maximum: number, signal: AbortSignal) {
    return this.call<{ entries: EnvironmentEntry[]; truncated: boolean }>(
      'list',
      { path: directory, maximum },
      signal
    );
  }
  mkdir(directory: string, signal: AbortSignal) {
    return this.call<void>('mkdir', { path: directory }, signal);
  }
  remove(target: string, recursive: boolean, signal: AbortSignal) {
    return this.call<void>('remove', { path: target, recursive }, signal);
  }
  exec(
    command: string,
    signal: AbortSignal,
    options?: { cwd?: string; timeoutMs?: number; maxOutputBytes?: number }
  ) {
    return this.call<EnvironmentCommandResult>('exec', { command, options }, signal);
  }
  runProcess(
    request: EnvironmentProcessRequest,
    signal: AbortSignal,
    output: EnvironmentProcessOutput
  ) {
    return this.call<{ exitCode: number }>('process', request, signal, output);
  }
}
