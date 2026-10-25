import { spawn as nodeSpawn, execFile, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { DEFAULT_INHERITED_ENV_VARS } from '@modelcontextprotocol/sdk/client/stdio.js';
import { deserializeMessage, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { MCPServerConfig } from '@automaker/types';
import { captureNativeLocalEnvironment } from '../execution-environment/local.js';
import { localComspec } from '../execution-environment/local.js';
import {
  nodeOwnedLocalChildRuntime,
  type OwnedLocalChildRuntime,
  type OwnedLocalChildTarget,
} from '../../core/platform/owned-local-child.runtime.js';
import {
  bounded,
  MCPCleanupError,
  MCPOperationError,
  MCPByteBudget,
  MCP_FRAME_BYTES,
  MCP_STDERR_BYTES,
} from './operation.js';
const spawn: typeof nodeSpawn = createRequire(import.meta.url)('cross-spawn');
const exec = promisify(execFile);

/** SDK protocol serialization over bounded pipes; authority starts with the original ChildProcess. */
export class MCPBoundedStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: Transport['onmessage'];
  private child?: ChildProcess;
  private target?: OwnedLocalChildTarget;
  private closed?: Promise<void>;
  private exited?: Promise<void>;
  private started = false;
  private pending = Buffer.alloc(0);
  private stderrBytes = 0;
  private readonly environment: NodeJS.ProcessEnv;
  constructor(
    private readonly config: MCPServerConfig,
    environment: Readonly<NodeJS.ProcessEnv>,
    private readonly cwd: string,
    private readonly owner: AbortController,
    private readonly budget: MCPByteBudget,
    private readonly runtime: OwnedLocalChildRuntime = nodeOwnedLocalChildRuntime
  ) {
    const snapshot = captureNativeLocalEnvironment(environment);
    this.environment = {};
    for (const name of DEFAULT_INHERITED_ENV_VARS) {
      const value =
        process.platform === 'win32'
          ? Object.entries(snapshot).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
          : snapshot[name];
      if (value !== undefined && !value.startsWith('()')) this.environment[name] = value;
    }
    for (const [name, value] of Object.entries(config.env ?? {})) {
      if (process.platform === 'win32')
        for (const existing of Object.keys(this.environment))
          if (existing.toLowerCase() === name.toLowerCase()) delete this.environment[existing];
      this.environment[name] = value;
    }
    // cross-spawn's Windows command resolution also needs the captured shell path.
    const comspec = localComspec(snapshot);
    if (comspec && !Object.keys(config.env ?? {}).some((name) => name.toLowerCase() === 'comspec'))
      this.environment.ComSpec = comspec;
  }
  async start(): Promise<void> {
    if (this.started || this.closed || this.owner.signal.aborted)
      throw new MCPOperationError('MCP transport is not accepting work');
    this.started = true;
    const child = (this.child = spawn(this.config.command!, this.config.args ?? [], {
      cwd: this.cwd,
      env: this.environment,
      shell: false,
      detached: process.platform === 'linux',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }));
    this.exited = new Promise((resolve) =>
      child.once('close', () => {
        this.onclose?.();
        resolve();
      })
    );
    // Observe error before any awaited event, including affirmative ENOENT/no-spawn.
    child.on('error', () => this.fail(new MCPOperationError('MCP command could not be started')));
    child.stdout!.on('data', (chunk: Buffer) => this.receive(chunk));
    child.stderr!.on('data', (chunk: Buffer) => {
      try {
        this.stderrBytes += chunk.length;
        this.budget.consume(chunk.length);
        if (this.stderrBytes > MCP_STDERR_BYTES)
          throw new MCPOperationError('MCP stderr exceeds the allowed size');
      } catch (error) {
        this.fail(error as Error);
      }
    });
    child.stdin!.on('error', () =>
      this.fail(new MCPOperationError('MCP process input is unavailable'))
    );
    child.stdout!.on('error', () =>
      this.fail(new MCPOperationError('MCP process output is unavailable'))
    );
    if (child.pid && process.platform === 'linux') this.target = this.runtime.capture(child);
    await once(child, 'spawn');
  }
  private fail(error: Error): void {
    this.onerror?.(error);
    this.owner.abort(error);
  }
  private receive(chunk: Buffer): void {
    if (this.owner.signal.aborted) return;
    try {
      this.budget.consume(chunk.length);
      // Process bounded pieces; never allocate a growing newline-less buffer beyond the cap.
      let start = 0;
      for (let index = 0; index < chunk.length; index++)
        if (chunk[index] === 10) {
          const end = chunk.subarray(start, index);
          if (this.pending.length + end.length > MCP_FRAME_BYTES)
            throw new MCPOperationError('MCP response exceeds the allowed size');
          const line = Buffer.concat([this.pending, end]);
          this.pending = Buffer.alloc(0);
          start = index + 1;
          const message = deserializeMessage(line.toString('utf8').replace(/\r$/, ''));
          this.onmessage?.(message);
        }
      const tail = chunk.subarray(start);
      if (this.pending.length + tail.length > MCP_FRAME_BYTES)
        throw new MCPOperationError('MCP response exceeds the allowed size');
      if (tail.length) this.pending = Buffer.concat([this.pending, tail]);
    } catch (error) {
      this.fail(
        error instanceof MCPOperationError
          ? error
          : new MCPOperationError('MCP response is malformed')
      );
    }
  }
  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed || this.owner.signal.aborted || !this.child?.stdin)
      throw new MCPOperationError('MCP operation cancelled');
    await new Promise<void>((resolve, reject) =>
      this.child!.stdin!.write(serializeMessage(message), (error) =>
        error ? reject(error) : resolve()
      )
    );
  }
  close(): Promise<void> {
    return (this.closed ??= this.cleanup());
  }
  private async cleanup(): Promise<void> {
    const child = this.child;
    if (!child) return;
    if (!child.pid) {
      await bounded(this.exited!, 1000, new MCPCleanupError());
      return;
    }
    if (process.platform === 'linux') {
      if (!this.target) throw new MCPCleanupError();
      await bounded(this.target.prepare(), 1000, new MCPCleanupError());
      child.stdin?.end();
      const quiet = async (milliseconds: number) => {
        await Promise.all([
          this.target!.waitForQuiescence(AbortSignal.timeout(milliseconds)),
          bounded(this.exited!, milliseconds, new MCPCleanupError()),
        ]);
      };
      try {
        await quiet(250);
        return;
      } catch {
        /* Escalate only through the captured continuity authority. */
      }
      this.target.signal('SIGTERM');
      try {
        await quiet(500);
        return;
      } catch {
        /* A TERM-resistant owned group requires escalation. */
      }
      this.target.signal('SIGKILL');
      await quiet(3000);
    } else {
      // Preserve legacy Windows tree termination; no cross-platform tree-proof claim.
      if (process.platform === 'win32' && child.exitCode === null && child.signalCode === null) {
        const systemRoot = this.environment.SYSTEMROOT ?? this.environment.SystemRoot;
        await exec(
          systemRoot ? path.win32.join(systemRoot, 'System32', 'taskkill.exe') : 'taskkill.exe',
          ['/f', '/t', '/pid', String(child.pid)],
          { env: this.environment, timeout: 3000, windowsHide: true }
        ).catch(() => {});
      }
      child.stdin?.end();
      try {
        await bounded(this.exited!, 250, new MCPCleanupError());
        return;
      } catch {
        child.kill('SIGTERM');
      }
      try {
        await bounded(this.exited!, 500, new MCPCleanupError());
        return;
      } catch {
        child.kill('SIGKILL');
      }
      await bounded(this.exited!, 3000, new MCPCleanupError());
    }
    this.pending = Buffer.alloc(0);
  }
}
