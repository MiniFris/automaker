import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { HOST_ENVIRONMENT } from '../../core/config/index.js';
import { waitForLinuxProcessGroupExit } from '../../core/platform/linux-process-group.js';
import { UnavailableDomainError } from '../../core/errors/domain-errors.js';
import {
  GithubRepositoryBoundary,
  type GithubRepositoryContext,
} from './github-repository-boundary.js';

export type GithubCommandFailureKind =
  | 'spawn'
  | 'exit'
  | 'limit'
  | 'deadline'
  | 'cancel'
  | 'cleanup';
export class GithubCommandError extends Error {
  constructor(
    readonly kind: GithubCommandFailureKind,
    readonly rateLimited = false,
    readonly absent = false
  ) {
    super('GitHub command could not be completed.');
  }
}
export class GithubCommandCleanupError extends Error {
  readonly code = 'GITHUB_COMMAND_CLEANUP_FAILED';
  constructor() {
    super('GitHub command cleanup could not be confirmed.');
  }
}
export interface GithubCommand {
  program: 'git' | 'gh';
  args: readonly string[];
  cwd: string;
  input?: string;
  signal: AbortSignal;
}
export abstract class GithubCommandRuntime {
  abstract run(command: GithubCommand): Promise<{ stdout: string }>;
}

// Repository-local state must come from the requested cwd, not from the shell
// that launched this application (including when launched inside a Git hook).
// Keep host authentication/global configuration; this is not a Git sandbox.
const repositoryEnvironment = new Set([
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
]);

export function githubCommandEnvironment(
  source: Readonly<NodeJS.ProcessEnv>,
  platform = process.platform
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      platform === 'win32' ? key.toUpperCase() : key,
      value,
    ])
  );
  const inheritedPath = environment.PATH;
  environment.PATH = [
    inheritedPath ?? (platform === 'win32' ? undefined : '/usr/bin:/bin'),
    ...(platform === 'win32'
      ? []
      : [
          '/opt/homebrew/bin',
          '/usr/local/bin',
          '/home/linuxbrew/.linuxbrew/bin',
          path.join(environment.HOME || os.homedir(), '.local/bin'),
        ]),
  ]
    .filter(Boolean)
    .join(platform === 'win32' ? ';' : ':');
  if (platform === 'win32' && inheritedPath === undefined) delete environment.PATH;
  delete environment.GH_REPO;
  for (const key of Object.keys(environment)) {
    if (repositoryEnvironment.has(key) || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key))
      delete environment[key];
  }
  return Object.assign(environment, {
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C',
  });
}

/** Host argv transport. It owns only child processes it spawned, never discovered PIDs. */
@Injectable()
export class NodeGithubCommandRuntime extends GithubCommandRuntime implements OnModuleDestroy {
  private readonly active = new Map<Promise<unknown>, AbortController>();
  private shutdown?: Promise<void>;
  private cleanupFailed = false;
  private readonly unconfirmed = new Set<number>();
  constructor(
    @Inject(HOST_ENVIRONMENT) private readonly environment: Readonly<NodeJS.ProcessEnv>,
    @Inject(GithubRepositoryBoundary) private readonly boundary: GithubRepositoryBoundary
  ) {
    super();
  }

  run(command: GithubCommand): Promise<{ stdout: string }> {
    if (
      (command.input && Buffer.byteLength(command.input) > 256 * 1024) ||
      !['git', 'gh'].includes(command.program)
    )
      throw new UnavailableDomainError('GitHub command request is invalid.');
    if (this.shutdown || this.cleanupFailed)
      throw new UnavailableDomainError('GitHub command runtime is not accepting requests.');
    if (this.active.size >= 16) throw new UnavailableDomainError('GitHub command runtime is busy.');
    // Synchronous policy refusal precedes CLI dispatch (also for mutation callers).
    const context = this.boundary.resolve(command.cwd);
    if (context === null) throw new GithubCommandError('exit', false, true);
    const request = { ...command, cwd: context?.cwd ?? command.cwd, args: [...command.args] };
    const controller = new AbortController();
    const task = Promise.resolve()
      .then(() => this.execute(request, controller.signal, context))
      .catch((error) => {
        if (error instanceof GithubCommandError && error.kind === 'cleanup')
          this.cleanupFailed = true;
        throw error;
      })
      .finally(() => this.active.delete(task));
    this.active.set(task, controller);
    return task;
  }

  private execute(
    command: GithubCommand,
    ownerSignal: AbortSignal,
    context?: GithubRepositoryContext
  ): Promise<{ stdout: string }> {
    const signal = AbortSignal.any([command.signal, ownerSignal]);
    if (signal.aborted) return Promise.reject(new GithubCommandError('cancel'));
    const environment = githubCommandEnvironment(this.environment);
    if (context) {
      environment.GIT_DIR = context.gitDirectory;
      environment.GIT_COMMON_DIR = context.commonDirectory;
      if (context.workTree) environment.GIT_WORK_TREE = context.workTree;
    }
    return new Promise((resolve, reject) => {
      const windows = process.platform === 'win32';
      const child = spawn(command.program, [...command.args], {
        cwd: command.cwd,
        env: environment,
        shell: false,
        detached: !windows,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = [],
        stderr: Buffer[] = [];
      let bytes = 0,
        stderrBytes = 0;
      let failure: GithubCommandFailureKind | undefined;
      let cleanup: Promise<void> | undefined;
      let cleanupTimer: NodeJS.Timeout | undefined;
      let cleanupDeadline: number | undefined;
      const observation = new AbortController();
      let settled = false;
      const stop = () => {
        if (cleanup) return;
        cleanupDeadline = performance.now() + 2000;
        cleanupTimer = setTimeout(() => {
          observation.abort();
          child.stdout.destroy();
          child.stderr.destroy();
          child.stdin.destroy();
          child.unref();
          if (child.pid) this.unconfirmed.add(child.pid);
          if (!settled) {
            settled = true;
            reject(new GithubCommandError('cleanup'));
          }
          clearTimeout(timeout);
          signal.removeEventListener('abort', cancel);
        }, 2000);
        cleanup = Promise.resolve().then(async () => {
          if (!child.pid) return;
          if (windows) {
            if (child.exitCode !== null || child.signalCode !== null)
              throw new GithubCommandError('cleanup');
            await new Promise<void>((done, failed) => {
              const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
                windowsHide: true,
                stdio: 'ignore',
                timeout: 1500,
              });
              killer.once('error', () => failed(new GithubCommandError('cleanup')));
              killer.once('close', (code) =>
                code === 0 ? done() : failed(new GithubCommandError('cleanup'))
              );
            });
          } else {
            try {
              process.kill(-child.pid, 'SIGKILL');
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
            }
            if (process.platform === 'linux')
              await waitForLinuxProcessGroupExit(child.pid, observation.signal);
          }
        });
        void cleanup.catch(() => {});
      };
      const cancel = () => {
        failure ??= 'cancel';
        stop();
      };
      const timeout = setTimeout(() => {
        failure ??= 'deadline';
        stop();
      }, 30_000);
      child.stdout.on('data', (data: Buffer) => {
        bytes += data.length;
        if (bytes > 10 * 1024 * 1024) {
          failure ??= 'limit';
          stop();
        } else stdout.push(data);
      });
      child.stderr.on('data', (data: Buffer) => {
        const remaining = Math.max(0, 32 * 1024 - stderrBytes);
        if (remaining) stderr.push(data.subarray(0, remaining));
        stderrBytes += Math.min(remaining, data.length);
      });
      child.stdin.on('error', () => {});
      child.once('error', () => {
        failure = 'spawn';
      });
      child.once('exit', () => {
        if (!windows) stop();
      });
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
      child.stdin.end(command.input || '');
      child.once('close', (code) => {
        void (async () => {
          try {
            await cleanup;
            if (cleanupDeadline !== undefined && performance.now() >= cleanupDeadline)
              throw new GithubCommandError('cleanup');
            if (settled) return;
            settled = true;
            if (failure) {
              reject(new GithubCommandError(failure));
              return;
            }
            if (code !== 0) {
              const detail = Buffer.concat(stderr).toString('utf8');
              reject(
                new GithubCommandError(
                  'exit',
                  /(?:API rate limit exceeded|HTTP 429)/i.test(detail),
                  /(?:No such remote|not a git repository|no git remotes found)/i.test(detail)
                )
              );
            } else resolve({ stdout: Buffer.concat(stdout).toString('utf8') });
          } catch {
            if (child.pid) this.unconfirmed.add(child.pid);
            if (!settled) {
              settled = true;
              reject(new GithubCommandError('cleanup'));
            }
          } finally {
            clearTimeout(timeout);
            clearTimeout(cleanupTimer);
            signal.removeEventListener('abort', cancel);
            observation.abort();
          }
        })();
      });
    });
  }

  onModuleDestroy(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    const tasks = [...this.active.keys()];
    for (const controller of this.active.values()) controller.abort();
    this.shutdown = Promise.allSettled(tasks).then(() => {
      if (this.cleanupFailed) throw new GithubCommandCleanupError();
    });
    return this.shutdown;
  }
}
