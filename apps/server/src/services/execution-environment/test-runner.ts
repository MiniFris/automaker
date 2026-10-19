import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ProjectGitEnvironment } from '@automaker/types';
import type { EventEmitter } from '../../lib/events.js';
import type { SettingsService } from '../settings-service.js';
import type { TestRunStatus } from '../test-runner-service.js';
import type { ProjectGitTarget } from './project-git.js';
import { ExecutionEnvironmentError } from './runtime.js';
import { ManagedTerminalPty } from './terminal.js';
import { shellQuote } from './ssh-transport.js';

const PREFIX = 'managed-test-';
const MAX_HISTORY = 100;
const MAX_ACTIVE = 8;
const MAX_LOG = 50000;
const active = (session: Session) => ['pending', 'running'].includes(session.status);
function fail(code: string, message: string): never {
  throw new ExecutionEnvironmentError(code, message);
}

interface Session {
  sessionId: string;
  worktreePath: string;
  command: string;
  testFile?: string;
  status: TestRunStatus;
  executionEnvironment: ProjectGitEnvironment;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  logs: string;
  error?: string;
  pty?: ManagedTerminalPty;
  stopping: boolean;
  pending: string;
  timer?: NodeJS.Timeout;
  settled: Promise<void>;
  settle: () => void;
}

/** Manual tests are separate from bounded agent RPCs and legacy host subprocess records.
 * No reconnect/replay or implicit prepare/fallback. A live session owns its original transport.
 */
export class ManagedTestRunnerService {
  private readonly sessions = new Map<string, Session>();
  private readonly starting = new Map<string, Promise<void>>();
  private closing = false;
  constructor(
    private readonly settings: SettingsService,
    private readonly events: EventEmitter
  ) {}

  owns(id: string) {
    return id.startsWith(PREFIX);
  }

  find(worktreePath?: string, sessionId?: string) {
    if (worktreePath) worktreePath = path.resolve(worktreePath);
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (worktreePath && session?.worktreePath !== worktreePath) return undefined;
      return session;
    }
    const matches = [...this.sessions.values()].filter((s) => s.worktreePath === worktreePath);
    return matches.find(active) ?? matches.at(-1);
  }

  describe(session: Session) {
    return {
      sessionId: session.sessionId,
      worktreePath: session.worktreePath,
      command: session.command,
      status: session.status,
      testFile: session.testFile,
      logs: session.logs,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
      exitCode: session.exitCode,
      executionEnvironment: session.executionEnvironment,
      error: session.error,
    };
  }

  async start(target: ProjectGitTarget, inspectedId: unknown, testFile: unknown) {
    if (inspectedId !== target.environment.targetId)
      fail(
        'TEST_TARGET_CHANGED',
        'Inspect this workspace before starting tests; its environment target changed. No command was started.'
      );
    if (target.runtime.type === 'local' && target.runtime.platform !== 'linux')
      fail(
        'TEST_RUNTIME_UNSUPPORTED',
        'Pinned Local manual tests currently require Linux and Python 3. Ordinary Local/legacy test runs are unchanged. No command was started.'
      );
    const alias = target.environment.path;
    if (this.closing)
      fail('TEST_RUNNER_CLOSING', 'The server is shutting down; no tests were started.');
    if (
      this.starting.has(alias) ||
      [...this.sessions.values()].some((s) => s.worktreePath === alias && active(s))
    )
      fail(
        'TEST_ALREADY_RUNNING',
        'Tests are already starting or running for this workspace, including its previous environment. Stop that session first.'
      );
    if (this.starting.size + [...this.sessions.values()].filter(active).length >= MAX_ACTIVE)
      fail('TEST_SESSION_LIMIT', 'At most eight managed test runs may be active.');
    if (
      testFile !== undefined &&
      (typeof testFile !== 'string' ||
        !testFile ||
        testFile.length > 4096 ||
        testFile.includes('\0') ||
        testFile.startsWith('/') ||
        testFile.split(/[\\/]/).includes('..'))
    )
      fail(
        'TEST_FILE_INVALID',
        'The test file must be a nonempty project-relative path without parent traversal.'
      );
    let finishStarting!: () => void;
    this.starting.set(
      alias,
      new Promise<void>((resolve) => {
        finishStarting = resolve;
      })
    );
    try {
      const project = await this.settings.getProjectSettings(target.environment.projectPath);
      const command = project.testCommand?.trim();
      if (!command || command.length > 32768 || command.includes('\0'))
        fail(
          'TEST_COMMAND_MISSING',
          'Configure a test command in this project’s settings before starting tests (maximum 32768 characters).'
        );
      const finalCommand = testFile ? `${command} -- ${shellQuote(testFile as string)}` : command;
      if (finalCommand.length > 32768)
        fail('TEST_COMMAND_TOO_LONG', 'The complete test command exceeds 32768 characters.');
      if (this.closing)
        fail('TEST_RUNNER_CLOSING', 'The server is shutting down; no tests were started.');
      // open() rechecks immutable binding/ownership/cwd via ProjectGitService before dispatch.
      const { pty } = await ManagedTerminalPty.open(target, this.settings, {
        cols: 120,
        rows: 40,
        shell: '/bin/sh',
        command: finalCommand,
      });
      let settle!: () => void;
      const settled = new Promise<void>((resolve) => {
        settle = resolve;
      });
      const session: Session = {
        sessionId: PREFIX + randomUUID(),
        worktreePath: alias,
        command: finalCommand,
        testFile: testFile as string | undefined,
        status: 'running',
        executionEnvironment: { ...target.environment },
        startedAt: new Date().toISOString(),
        finishedAt: null,
        exitCode: null,
        logs: '',
        pending: '',
        stopping: false,
        pty,
        settled,
        settle,
      };
      this.sessions.set(session.sessionId, session);
      this.prune();
      this.events.emit('test-runner:started', {
        ...this.describe(session),
        timestamp: session.startedAt,
      });
      pty.onData((data) => this.output(session, data));
      pty.onExit(({ exitCode }) => {
        const confirmed = pty.exitConfirmed;
        session.status = !confirmed
          ? 'error'
          : session.stopping
            ? 'cancelled'
            : exitCode === 0
              ? 'passed'
              : 'failed';
        session.exitCode = confirmed ? exitCode : null;
        if (!confirmed)
          session.error =
            'Target connection/cleanup is unconfirmed. Inspect the target before starting another run; commands were not replayed.';
        this.finish(session);
      });
      if (this.closing) {
        session.stopping = true;
        pty.kill();
      }
      return { ...this.describe(session), message: 'Tests started in the selected environment.' };
    } finally {
      this.starting.delete(alias);
      finishStarting();
    }
  }

  private prune() {
    for (const [id, session] of this.sessions) {
      if (this.sessions.size <= MAX_HISTORY) break;
      if (!active(session)) this.sessions.delete(id);
    }
  }

  private output(session: Session, data: string) {
    session.logs = (session.logs + data).slice(-MAX_LOG);
    session.pending = (session.pending + data).slice(-MAX_LOG);
    if (!session.timer) session.timer = setTimeout(() => this.flush(session), 100);
  }

  private flush(session: Session) {
    clearTimeout(session.timer);
    session.timer = undefined;
    if (!session.pending) return;
    this.events.emit('test-runner:output', {
      sessionId: session.sessionId,
      worktreePath: session.worktreePath,
      content: session.pending,
      timestamp: new Date().toISOString(),
    });
    session.pending = '';
  }

  private finish(session: Session) {
    session.finishedAt = new Date().toISOString();
    this.flush(session);
    this.events.emit('test-runner:completed', {
      ...this.describe(session),
      duration: Date.parse(session.finishedAt) - Date.parse(session.startedAt),
      timestamp: session.finishedAt,
    });
    session.pty = undefined;
    session.settle();
  }

  async stop(id: string) {
    const session = this.sessions.get(id);
    if (!session)
      fail(
        'TEST_SESSION_GONE',
        'This managed test session is unavailable (expired or backend restarted). It was not recreated or replayed. Inspect the target if completion was not confirmed.'
      );
    if (active(session)) {
      session.stopping = true;
      session.pty?.kill();
      await session.settled;
    }
    if (session.status === 'error')
      fail('TEST_CLEANUP_UNVERIFIED', session.error ?? 'Target cleanup is unconfirmed.');
    return { sessionId: id, message: `Test run finished (${session.status}).` };
  }

  async cleanup() {
    this.closing = true;
    await Promise.all(this.starting.values());
    await Promise.all(
      [...this.sessions.values()].filter(active).map((s) => this.stop(s.sessionId).catch(() => {}))
    );
  }
}

const services = new WeakMap<SettingsService, ManagedTestRunnerService>();
export function getManagedTestRunnerService(settings: SettingsService, events: EventEmitter) {
  let service = services.get(settings);
  if (!service) {
    service = new ManagedTestRunnerService(settings, events);
    services.set(settings, service);
  }
  return service;
}
