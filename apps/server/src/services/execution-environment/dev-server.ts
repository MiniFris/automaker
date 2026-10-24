import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SettingsService } from '../settings-service.js';
import type { EventEmitter } from '../../lib/events.js';
import type { ProjectGitTarget } from './project-git.js';
import { ProjectGitService } from './project-git.js';
import { ExecutionEnvironmentError } from './runtime.js';
import { ManagedTerminalPty } from './terminal.js';
import { shellQuote } from './ssh-transport.js';
import { PreviewGateway } from './preview-gateway.js';
import { PREVIEW_PORT_FIRST, PREVIEW_PORT_LAST } from './preview-policy.js';
import { openPreviewTunnel } from './preview-tunnel.js';

function fail(code: string, message: string): never {
  throw new ExecutionEnvironmentError(code, message);
}
interface DevSession {
  sessionId: string;
  target: ProjectGitTarget;
  command: string;
  pty: ManagedTerminalPty;
  gateway: PreviewGateway;
  startedAt: string;
  logs: string;
  pending: string;
  timer?: NodeJS.Timeout;
  readyTimer?: NodeJS.Timeout;
  ready: boolean;
  finished: boolean;
  error?: string;
  exitCode: number | null;
  settled: Promise<void>;
  settle: () => void;
}
const PORT_PROBE = `const net=require('node:net');const s=net.createServer();s.on('error',()=>process.exit(1));s.listen(Number(process.argv[1]),'127.0.0.1',()=>s.close());`;

export class ManagedDevServerService {
  private readonly sessions = new Map<string, DevSession>();
  private readonly starting = new Map<string, Promise<void>>();
  private closing = false;
  constructor(
    private readonly settings: SettingsService,
    private readonly events: EventEmitter
  ) {}
  owns(id: string) {
    return id.startsWith('managed-dev-');
  }
  find(alias?: string, id?: string) {
    if (id) return this.sessions.get(id);
    const matches = [...this.sessions.values()].filter(
      (s) => s.target.environment.path === path.resolve(alias ?? '.')
    );
    return matches.find((s) => !s.finished) ?? matches.at(-1);
  }
  describe(s: DevSession) {
    return {
      sessionId: s.sessionId,
      worktreePath: s.target.environment.path,
      port: s.gateway.port,
      targetPort: s.gateway.port + 1000,
      url: s.gateway.url,
      urlDetected: s.ready,
      preserveUrlHost: !!process.env.AUTOMAKER_PREVIEW_PUBLIC_URL,
      executionEnvironment: s.target.environment,
      command: s.command,
      startedAt: s.startedAt,
      logs: s.logs,
      isRunning: !s.finished,
      error: s.error,
      exitCode: s.exitCode,
    };
  }
  list() {
    return [...this.sessions.values()].filter((s) => !s.finished).map((s) => this.describe(s));
  }
  private async command(target: ProjectGitTarget, port: number) {
    const configured = (await this.settings.getProjectSettings(target.environment.projectPath))
      .devCommand;
    if (typeof configured === 'string' && configured.trim())
      return configured.trim().replaceAll('{{port}}', String(port));
    const raw = await target.runtime.readFile(
      'package.json',
      0,
      262145,
      AbortSignal.timeout(15000)
    );
    if (raw.size > 262144)
      fail(
        'DEV_PACKAGE_TOO_LARGE',
        'package.json exceeds the dev command detection budget. Configure Dev Command explicitly.'
      );
    const pkg = JSON.parse(raw.data.toString()) as { scripts?: { dev?: string } };
    if (!pkg.scripts?.dev)
      fail(
        'DEV_COMMAND_MISSING',
        'Configure Dev Command in Project Settings or a package.json dev script on the target.'
      );
    const entries = (await target.runtime.listDirectory('.', 5000, AbortSignal.timeout(15000)))
      .entries;
    const has = (file: string) => entries.some((entry) => entry.name === file);
    const manager =
      has('bun.lockb') || has('bun.lock')
        ? 'bun'
        : has('pnpm-lock.yaml')
          ? 'pnpm'
          : has('yarn.lock')
            ? 'yarn'
            : 'npm';
    const vite = /(?:^|[ /])vite(?:\s|$)/.test(pkg.scripts.dev);
    const next = /(?:^|[ /])next\s+dev(?:\s|$)/.test(pkg.scripts.dev);
    const args = vite
      ? ` --port ${port} --host 127.0.0.1 --strictPort`
      : next
        ? ` --port ${port} --hostname 127.0.0.1`
        : '';
    return `${manager} run dev${args ? (manager === 'npm' ? ' --' + args : args) : ''}`;
  }
  async start(target: ProjectGitTarget, inspected: unknown) {
    if (inspected !== target.environment.targetId)
      fail(
        'DEV_TARGET_CHANGED',
        'Inspect the workspace before starting its dev server. No command was dispatched.'
      );
    if (target.runtime.platform !== 'linux')
      fail(
        'DEV_PLATFORM_UNSUPPORTED',
        'Managed dev servers currently require a Linux target with Python 3. No host fallback was used.'
      );
    const alias = target.environment.path;
    if (this.closing) fail('DEV_SERVICE_CLOSING', 'Server is shutting down.');
    if (this.starting.has(alias) || (this.find(alias) && !this.find(alias)!.finished))
      fail(
        'DEV_ALREADY_RUNNING',
        'Stop the existing dev session before starting another, including after changing its environment.'
      );
    if (this.starting.size + this.list().length >= 8)
      fail('DEV_SESSION_LIMIT', 'At most eight managed dev sessions may be active.');
    let done!: () => void;
    this.starting.set(
      alias,
      new Promise<void>((resolve) => {
        done = resolve;
      })
    );
    let gateway: PreviewGateway | undefined, pty: ManagedTerminalPty | undefined;
    try {
      await new ProjectGitService(this.settings).run(
        target,
        'environment',
        {},
        AbortSignal.timeout(30000)
      );
      for (let port = PREVIEW_PORT_FIRST; port <= PREVIEW_PORT_LAST; port++) {
        const candidate = new PreviewGateway();
        try {
          await candidate.listen(port);
        } catch (error) {
          await candidate.close();
          if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') continue;
          throw error;
        }
        gateway = candidate;
        const probe = await target.runtime.exec(
          ['node', '-e', PORT_PROBE, String(port + 1000)].map(shellQuote).join(' '),
          AbortSignal.timeout(10000),
          { timeoutMs: 8000 }
        );
        if (probe.exitCode === 0) {
          gateway = candidate;
          break;
        }
        await candidate.close();
        gateway = undefined;
      }
      if (!gateway)
        fail(
          'DEV_PORTS_UNAVAILABLE',
          'No free preview/target port pair is available. Existing listeners were not killed.'
        );
      const command = await this.command(target, gateway.port + 1000);
      if (!command || command.length > 32768 || command.includes('\0'))
        fail(
          'DEV_COMMAND_INVALID',
          'Dev Command must be nonempty, at most 32768 characters, without NUL.'
        );
      if (this.closing)
        fail('DEV_SERVICE_CLOSING', 'Server is shutting down; no dev command started.');
      const opened = await ManagedTerminalPty.open(target, this.settings, {
        cols: 120,
        rows: 40,
        shell: '/bin/sh',
        command,
        kind: 'dev',
        port: gateway.port + 1000,
      });
      pty = opened.pty;
      if (!pty.runtimePid) {
        pty.kill();
        fail(
          'DEV_SUPERVISOR_INVALID',
          'Target supervisor did not report its Linux session identity. No preview was attached.'
        );
      }
      const leader = pty.runtimePid,
        capturedGateway = gateway;
      gateway.attach(() =>
        openPreviewTunnel(target, this.settings, capturedGateway.port + 1000, leader)
      );
      let settle!: () => void;
      const settled = new Promise<void>((resolve) => {
        settle = resolve;
      });
      const session: DevSession = {
        sessionId: 'managed-dev-' + randomUUID(),
        target,
        command,
        pty,
        gateway,
        startedAt: new Date().toISOString(),
        logs: '',
        pending: '',
        ready: false,
        finished: false,
        exitCode: null,
        settled,
        settle,
      };
      this.sessions.set(session.sessionId, session);
      for (const [id, previous] of this.sessions)
        if (this.sessions.size > 100 && previous.finished) this.sessions.delete(id);
      this.events.emit('dev-server:started', {
        ...this.describe(session),
        timestamp: session.startedAt,
      });
      pty.onData((data) => {
        session.logs = (session.logs + data).slice(-50000);
        session.pending = (session.pending + data).slice(-50000);
        if (!session.timer) session.timer = setTimeout(() => this.flush(session), 100);
      });
      const capturedPty = pty;
      pty.onExit(({ exitCode }) => {
        session.finished = true;
        session.exitCode = capturedPty.exitConfirmed ? exitCode : null;
        if (!capturedPty.exitConfirmed)
          session.error =
            'Target dev process cleanup is unconfirmed. Inspect it before restarting; commands were not replayed.';
        clearTimeout(session.readyTimer);
        this.flush(session);
        void session.gateway.close().finally(() => {
          this.events.emit('dev-server:stopped', {
            ...this.describe(session),
            timestamp: new Date().toISOString(),
          });
          session.settle();
        });
      });
      if (this.closing) pty.kill();
      else void this.detect(session);
      return {
        ...this.describe(session),
        message:
          'Dev server started on its captured target. Preview waits for a verified owned HTTP listener.',
      };
    } catch (error) {
      pty?.kill();
      await gateway?.close();
      throw error;
    } finally {
      this.starting.delete(alias);
      done();
    }
  }
  private async detect(s: DevSession) {
    if (s.finished || s.ready || this.closing) return;
    if ((await s.gateway.probe()) && !s.finished) {
      s.ready = true;
      this.events.emit('dev-server:url-detected', {
        ...this.describe(s),
        timestamp: new Date().toISOString(),
      });
    } else if (!s.finished && !this.closing)
      s.readyTimer = setTimeout(() => void this.detect(s), 1000);
  }
  private flush(s: DevSession) {
    clearTimeout(s.timer);
    s.timer = undefined;
    if (s.pending)
      this.events.emit('dev-server:output', {
        sessionId: s.sessionId,
        worktreePath: s.target.environment.path,
        content: s.pending,
        timestamp: new Date().toISOString(),
      });
    s.pending = '';
  }
  async stop(id: string) {
    const session = this.sessions.get(id);
    if (!session)
      fail(
        'DEV_SESSION_GONE',
        'Managed dev session expired or backend restarted. It was not recreated or replayed.'
      );
    if (!session.finished) {
      session.pty.kill();
      await session.settled;
    } else await session.settled;
    if (session.error) fail('DEV_CLEANUP_UNVERIFIED', session.error);
    return {
      sessionId: id,
      worktreePath: session.target.environment.path,
      message: 'Dev process stopped and preview access revoked.',
    };
  }
  async cleanup() {
    this.closing = true;
    await Promise.all(this.starting.values());
    await Promise.all(
      [...this.sessions.values()].map((s) => this.stop(s.sessionId).catch(() => {}))
    );
  }
}
