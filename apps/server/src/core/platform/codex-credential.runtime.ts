import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Inject, Injectable } from '@nestjs/common';
import { HOST_ENVIRONMENT, RuntimePathsService } from '../config/index.js';
import { UnavailableDomainError } from '../errors/index.js';

export interface CodexCredential {
  kind: 'api-key' | 'chatgpt' | 'not-detected';
  token?: string;
}
export abstract class CodexCredentialRuntime {
  abstract read(includeToken: boolean, controller: AbortController): Promise<CodexCredential>;
}
export const CODEX_CREDENTIAL_PROCESS = Symbol('CODEX_CREDENTIAL_PROCESS');
export type CodexCredentialProcess = (
  cwd: string,
  environment: NodeJS.ProcessEnv
) => ChildProcessWithoutNullStreams;

export function bundledCodexPath(): string {
  const targets: Readonly<Record<string, string>> = {
    'linux-x64': 'x86_64-unknown-linux-musl',
    'linux-arm64': 'aarch64-unknown-linux-musl',
    'darwin-x64': 'x86_64-apple-darwin',
    'darwin-arm64': 'aarch64-apple-darwin',
    'win32-x64': 'x86_64-pc-windows-msvc',
    'win32-arm64': 'aarch64-pc-windows-msvc',
  };
  const target = targets[`${process.platform}-${process.arch}`];
  if (!target) throw new UnavailableDomainError('Bundled Codex credential runtime is unavailable.');
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.resolve('@openai/codex-sdk'))),
    '..',
    'vendor',
    target,
    'codex',
    process.platform === 'win32' ? 'codex.exe' : 'codex'
  );
}
export const spawnCodexCredentialProcess: CodexCredentialProcess = (cwd, environment) =>
  spawn(
    bundledCodexPath(),
    [
      'app-server',
      '-c',
      'features.remote_models=false',
      '-c',
      'notify=[]',
      '-c',
      'mcp_servers={}',
      '-c',
      'model_provider="openai"',
    ],
    { cwd, env: environment, shell: false, stdio: ['pipe', 'pipe', 'pipe'] }
  );

/** Pinned CLI auth RPC only: never creates a thread, starts a turn, or runs tools. */
@Injectable()
export class NodeCodexCredentialRuntime extends CodexCredentialRuntime {
  private closing: Promise<void> | undefined;
  private readonly active = new Map<Promise<unknown>, AbortController>();
  constructor(
    @Inject(HOST_ENVIRONMENT) private readonly environment: Readonly<NodeJS.ProcessEnv>,
    @Inject(RuntimePathsService) private readonly paths: RuntimePathsService,
    @Inject(CODEX_CREDENTIAL_PROCESS) private readonly launch: CodexCredentialProcess
  ) {
    super();
  }

  async read(includeToken: boolean, parent: AbortController): Promise<CodexCredential> {
    if (this.closing || parent.signal.aborted)
      throw new UnavailableDomainError('Codex credential runtime is unavailable.');
    if (this.active.size >= 4)
      throw new UnavailableDomainError('Codex credential runtime is busy.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    parent.signal.addEventListener('abort', abort, { once: true });
    const pending = this.execute(includeToken, controller);
    this.active.set(pending, controller);
    try {
      return await pending;
    } finally {
      this.active.delete(pending);
      parent.signal.removeEventListener('abort', abort);
    }
  }

  private async execute(
    includeToken: boolean,
    controller: AbortController
  ): Promise<CodexCredential> {
    const environment: NodeJS.ProcessEnv = { ...this.environment, TERM: 'dumb' };
    delete environment.OPENAI_API_KEY;
    delete environment.CODEX_API_KEY;
    const child = this.launch(this.paths.resolveFromWorkingDirectory(), environment);
    let closed = false;
    const exited = new Promise<void>((resolve) => {
      child.once('close', () => {
        closed = true;
        resolve();
      });
      child.once('error', () => {
        if (!child.pid) {
          closed = true;
          resolve();
        }
      });
    });
    let rejectPending: (error: Error) => void = () => undefined;
    const abort = () => rejectPending(new Error('Codex credential query cancelled.'));
    const timer = setTimeout(() => controller.abort(), 10000);
    controller.signal.addEventListener('abort', abort, { once: true });
    try {
      return await new Promise<CodexCredential>((resolve, reject) => {
        rejectPending = reject;
        let buffer = '',
          bytes = 0,
          messages = 0,
          ready = false;
        const fail = () => reject(new Error('Codex credential protocol failed.'));
        child.once('error', fail);
        child.once('close', fail);
        child.stdin.on('error', fail);
        child.stderr.on('data', () => {
          /* Drain without retaining or logging credentials/diagnostics. */
        });
        child.stdout.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 262144) {
            fail();
            return;
          }
          buffer += chunk.toString('utf8');
          if (buffer.length > 131072) {
            fail();
            return;
          }
          let newline: number;
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            if (!line.trim()) continue;
            if (++messages > 100) {
              fail();
              return;
            }
            try {
              const message = JSON.parse(line);
              if (message.id === 1 && !ready) {
                if (message.error || !message.result) {
                  fail();
                  return;
                }
                ready = true;
                child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
                child.stdin.write(
                  JSON.stringify({
                    id: 2,
                    method: 'getAuthStatus',
                    params: { includeToken, refreshToken: includeToken },
                  }) + '\n'
                );
              } else if (message.id === 2 && ready) {
                const result = message.result;
                if (
                  message.error ||
                  !result ||
                  ![null, 'apikey', 'chatgpt', 'chatgptAuthTokens'].includes(result.authMethod)
                ) {
                  fail();
                  return;
                }
                const token = result.authToken;
                if (
                  includeToken &&
                  result.authMethod &&
                  (typeof token !== 'string' ||
                    !token ||
                    token.length > 16384 ||
                    /[\x00-\x20\x7f]/.test(token))
                ) {
                  fail();
                  return;
                }
                resolve({
                  kind:
                    result.authMethod === 'apikey'
                      ? 'api-key'
                      : result.authMethod
                        ? 'chatgpt'
                        : 'not-detected',
                  ...(includeToken && result.authMethod ? { token } : {}),
                });
              } else if ('id' in message && 'method' in message) {
                fail();
                return;
              }
            } catch {
              fail();
              return;
            }
          }
        });
        if (controller.signal.aborted) {
          abort();
          return;
        }
        child.stdin.write(
          JSON.stringify({
            id: 1,
            method: 'initialize',
            params: {
              clientInfo: { name: 'automaker-auth-probe', version: '1.0.0' },
              capabilities: null,
            },
          }) + '\n'
        );
      });
    } catch {
      throw new UnavailableDomainError('Codex CLI credentials could not be read.');
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', abort);
      child.stdin.end();
      if (!closed) child.kill('SIGTERM');
      const kill = setTimeout(() => {
        if (!closed) child.kill('SIGKILL');
      }, 500);
      try {
        await exited;
      } finally {
        clearTimeout(kill);
      }
    }
  }
  onApplicationShutdown(): Promise<void> {
    if (!this.closing) {
      let finish!: () => void;
      this.closing = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const pending = [...this.active];
      for (const [, controller] of pending) controller.abort();
      void Promise.allSettled(pending.map(([task]) => task)).then(finish);
    }
    return this.closing;
  }
}
