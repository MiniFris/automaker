import { spawn } from 'node:child_process';
import type { Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { randomUUID } from 'node:crypto';
import type { Client } from 'ssh2';
import type { ProjectGitEnvironment } from '@automaker/types';
import type { SettingsService } from '../settings-service.js';
import { ProjectGitService, type ProjectGitTarget } from './project-git.js';
import { DockerExecutionEnvironment } from './docker.js';
import { SSHExecutionEnvironment } from './ssh.js';
import { SSHState } from './ssh-state.js';
import { connectSSH, shellQuote } from './ssh-transport.js';
import { dockerArguments } from './docker-command.js';
import { ExecutionEnvironmentError } from './runtime.js';
import { TERMINAL_WORKER } from './terminal-worker.js';

export interface TerminalPty {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(callback: (data: string) => void): unknown;
  onExit(callback: (event: { exitCode: number }) => void): unknown;
}

/** Interactive transport only: no host shell, copied controller env, replay or auto reconnect. */
export class ManagedTerminalPty implements TerminalPty {
  private input?: Writable;
  private disconnect = () => {};
  private heartbeat?: NodeJS.Timeout;
  private closeTimer?: NodeJS.Timeout;
  private closed = false;
  private closing = false;
  private dataCallback?: (data: string) => void;
  private exitCallback?: (event: { exitCode: number }) => void;
  private buffered = '';
  private exitCode?: number;
  /** Only a target exit frame confirms session cleanup; transport loss also uses code 255. */
  exitConfirmed = false;
  /** Linux session leader, obtained from the target supervisor, never from an HTTP request. */
  runtimePid?: number;
  private readonly decoder = new StringDecoder('utf8');
  private constructor() {}

  static async open(
    target: ProjectGitTarget,
    settings: SettingsService,
    options: {
      cols: number;
      rows: number;
      shell?: string;
      command?: string;
      kind?: 'dev';
      port?: number;
    }
  ): Promise<{ pty: ManagedTerminalPty; shell: string; environment: ProjectGitEnvironment }> {
    const pty = new ManagedTerminalPty();
    const service = new ProjectGitService(settings);
    // Recheck binding/ownership/worktree before dispatch, including retired feature pins.
    await service.run(target, 'environment', {}, AbortSignal.timeout(30000));
    const args = [
      '-u',
      '-c',
      TERMINAL_WORKER,
      JSON.stringify({
        cwd: target.runtime.cwd,
        cols: options.cols,
        rows: options.rows,
        shell: options.shell,
        command: options.command,
        kind: options.kind,
        port: options.port,
        id: randomUUID(),
        jobs: target.runtime.type === 'docker' ? '/tmp/automaker-jobs' : undefined,
      }),
    ];
    return new Promise((resolve, reject) => {
      let pending = '',
        ready = false,
        shell = '',
        final = false;
      let client: Client | undefined;
      const timer = setTimeout(
        () =>
          fail(
            'Target PTY did not become ready. Install Python 3 on the selected target; no host shell was started.'
          ),
        15000
      );
      const fail = (message: string) => {
        if (pty.closed) return;
        clearTimeout(timer);
        if (!ready)
          reject(
            new ExecutionEnvironmentError(
              'TERMINAL_TARGET_FAILED',
              `${message}. Managed PTY requires Linux, Python 3 and the selected shell on the target; no controller shell was started.`
            )
          );
        else
          pty.deliver(
            `\r\n[Terminal transport lost: ${message}. Target cleanup may take up to 15 seconds; commands were not replayed.]\r\n`
          );
        pty.finish(255);
      };
      const receive = (chunk: Buffer) => {
        try {
          pending += chunk.toString('utf8');
          if (pending.length > 1024 * 1024) throw new Error('Terminal protocol overflow');
          let newline: number;
          while ((newline = pending.indexOf('\n')) !== -1) {
            const frame = JSON.parse(pending.slice(0, newline));
            pending = pending.slice(newline + 1);
            if (frame.type === 'ready' && !ready) {
              ready = true;
              if (Number.isSafeInteger(frame.pid) && frame.pid > 0) pty.runtimePid = frame.pid;
              shell = frame.shell;
              clearTimeout(timer);
              pty.heartbeat = setInterval(() => pty.send({ type: 'ping' }), 3000);
              pty.heartbeat.unref();
              resolve({ pty, shell, environment: target.environment });
            } else if (frame.type === 'data' && ready && !final) {
              if (typeof frame.data !== 'string') throw new Error('Invalid terminal data');
              pty.deliver(pty.decoder.write(Buffer.from(frame.data, 'base64')));
            } else if (
              frame.type === 'exit' &&
              ready &&
              !final &&
              Number.isInteger(frame.exitCode)
            ) {
              final = true;
              pty.exitConfirmed = true;
              pty.deliver(pty.decoder.end());
              pty.finish(frame.exitCode);
            } else if (frame.type === 'failure') fail(String(frame.message));
            else throw new Error('Invalid terminal frame');
          }
        } catch {
          fail('Invalid target terminal protocol');
        }
      };
      const ended = () => {
        if (!final && !pty.closed) fail('Connection ended without a confirmed PTY exit');
      };
      if (
        target.runtime.type === 'local' &&
        target.runtime.platform === 'linux' &&
        options.command
      ) {
        // Explicit pinned Local only, after binding verification above. This is not a remote fallback.
        const child = spawn('python3', args, {
          cwd: target.runtime.cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,
        });
        pty.input = child.stdin;
        pty.disconnect = () => {
          child.stdin.end();
          child.kill('SIGTERM');
        };
        child.stdout.on('data', receive);
        child.stderr.on('data', () => {});
        child.stdin.on('error', ended);
        child.on('error', () =>
          fail('Pinned Local supervisor could not start (Linux/Python 3 required)')
        );
        child.on('close', ended);
      } else if (target.runtime.type === 'docker') {
        const descriptor = (target.runtime as DockerExecutionEnvironment).binding;
        const child = spawn(
          'docker',
          dockerArguments(descriptor.context, [
            'exec',
            '-i',
            '--workdir',
            target.runtime.cwd,
            descriptor.containerId,
            'python3',
            ...args,
          ]),
          { stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true }
        );
        pty.input = child.stdin;
        pty.disconnect = () => {
          child.stdin.end();
          child.kill('SIGTERM');
        };
        child.stdout.on('data', receive);
        child.stderr.on('data', () => {});
        child.stdin.on('error', ended);
        child.on('error', () => fail('Docker transport could not start'));
        child.on('close', ended);
      } else if (target.runtime.type === 'ssh') {
        const descriptor = (target.runtime as SSHExecutionEnvironment).binding;
        void (async () => {
          const config = await new SSHState(settings).configuration(
            descriptor.profile,
            descriptor.fingerprint
          );
          client = await connectSSH(config, AbortSignal.timeout(10000));
          if (pty.closed) {
            client.end();
            return;
          }
          pty.disconnect = () => {
            pty.input?.end();
            client?.end();
          };
          client.on('close', ended);
          client.on('error', ended);
          client.exec(['python3', ...args].map(shellQuote).join(' '), (error, channel) => {
            if (error) {
              fail('SSH terminal channel failed');
              return;
            }
            if (pty.closed) {
              channel.end();
              return;
            }
            pty.input = channel;
            channel.on('data', receive);
            channel.stderr.on('data', () => {});
            channel.on('close', ended);
            channel.on('error', ended);
          });
        })().catch(() => fail('SSH host verification/authentication/connection failed'));
      } else {
        clearTimeout(timer);
        reject(
          new ExecutionEnvironmentError(
            'TERMINAL_RUNTIME_INVALID',
            'Managed PTY requires Docker or SSH.'
          )
        );
      }
    });
  }

  private deliver(data: string) {
    if (this.dataCallback) this.dataCallback(data);
    else this.buffered = (this.buffered + data).slice(-50000);
  }
  private finish(code: number) {
    if (this.closed) return;
    this.closed = true;
    this.exitCode = code;
    clearInterval(this.heartbeat);
    clearTimeout(this.closeTimer);
    this.disconnect();
    this.exitCallback?.({ exitCode: code });
  }
  private send(value: object) {
    if (this.closed || !this.input) return;
    if (this.input.writableLength > 2 * 1024 * 1024) {
      this.finish(255);
      return;
    }
    try {
      this.input.write(JSON.stringify(value) + '\n');
    } catch {
      this.finish(255);
    }
  }
  write(data: string) {
    if (!this.closing) this.send({ type: 'input', data: Buffer.from(data).toString('base64') });
  }
  resize(cols: number, rows: number) {
    this.send({ type: 'resize', cols, rows });
  }
  kill() {
    if (this.closed || this.closing) return;
    this.closing = true;
    this.send({ type: 'close' });
    this.closeTimer = setTimeout(() => this.finish(255), 20000);
    this.closeTimer.unref();
  }
  onData(callback: (data: string) => void) {
    this.dataCallback = callback;
    if (this.buffered) {
      callback(this.buffered);
      this.buffered = '';
    }
  }
  onExit(callback: (event: { exitCode: number }) => void) {
    this.exitCallback = callback;
    if (this.exitCode !== undefined) callback({ exitCode: this.exitCode });
  }
}
