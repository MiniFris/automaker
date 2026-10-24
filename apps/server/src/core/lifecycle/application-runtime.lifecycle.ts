import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { createLogger, LogLevel, setLogLevel } from '@automaker/utils';
import { RUNTIME_CONFIG, type RuntimeConfig } from '../config/index.js';
import { APPLICATION_EVENTS } from '../eventing/application-events.js';
import type { EventEmitter } from '../../lib/events.js';
import { setRequestLoggingEnabled } from '../../lib/request-logging-state.js';
import {
  createCorrelationId,
  runWithCorrelationContext,
} from '../observability/request-context.js';
import { ReadinessStateService } from './readiness-state.service.js';
import { SettingsService } from '../../services/settings-service.js';
import { AgentService } from '../../services/agent-service.js';
import { AutoModeServiceCompat } from '../../services/auto-mode/index.js';
import { DevServerService } from '../../services/dev-server-service.js';
import { TestRunnerService } from '../../services/test-runner-service.js';
import { TerminalService } from '../../services/terminal-service.js';
import { ManagedDevServerService } from '../../services/execution-environment/dev-server.js';
import { ManagedTestRunnerService } from '../../services/execution-environment/test-runner.js';

export const APPLICATION_STARTUP_TASKS = Symbol('APPLICATION_STARTUP_TASKS');
const logger = createLogger('ApplicationRuntime');
const LOG_LEVELS: Record<string, LogLevel> = {
  error: LogLevel.ERROR,
  warn: LogLevel.WARN,
  info: LogLevel.INFO,
  debug: LogLevel.DEBUG,
};

/** Coordinates native owners; never constructs services or installs process-global policy. */
@Injectable()
export class ApplicationRuntimeLifecycle implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly resumes = new Set<Promise<void>>();
  private readonly startup = new Set<Promise<void>>();
  private stopping = false;
  private shutdown?: Promise<void>;

  constructor(
    @Inject(APPLICATION_STARTUP_TASKS) private readonly enabled: boolean,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    @Inject(APPLICATION_EVENTS) private readonly events: EventEmitter,
    @Inject(ReadinessStateService) private readonly readiness: ReadinessStateService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AgentService) private readonly agents: AgentService,
    @Inject(AutoModeServiceCompat) private readonly autoMode: AutoModeServiceCompat,
    @Inject(DevServerService) private readonly devServer: DevServerService,
    @Inject(TestRunnerService) private readonly tests: TestRunnerService,
    @Inject(TerminalService) private readonly terminal: TerminalService,
    @Inject(ManagedDevServerService) private readonly managedDev: ManagedDevServerService,
    @Inject(ManagedTestRunnerService) private readonly managedTests: ManagedTestRunnerService
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      if (this.enabled) {
        await this.startupTask('application-initialization', () => this.initialize(), true);
        if (this.stopping) return;
        await this.startupTask(
          'dev-server-state-recovery',
          () => this.devServer.initialize(this.config.storage.dataDirectory, this.events),
          false
        );
      }
      if (!this.stopping) this.readiness.markReady();
    } catch (error) {
      this.stopping = true;
      this.readiness.markFailed(error);
      throw error;
    }
  }

  private async initialize(): Promise<void> {
    try {
      const result = await this.settings.migrateFromLegacyElectronPath();
      if (result.migrated) logger.info('Settings migrated from the previous Electron location.');
      if (result.errors.length) logger.warn('Settings migration reported errors.');
    } catch {
      logger.warn('Failed to check for legacy settings migration.');
    }
    if (this.stopping) return;
    let settings: Awaited<ReturnType<SettingsService['getGlobalSettings']>> | undefined;
    try {
      settings = await this.settings.getGlobalSettings();
    } catch {
      logger.warn('Failed to load global settings, using defaults.');
    }
    if (this.stopping) return;
    if (settings) {
      const level = settings.serverLogLevel && LOG_LEVELS[settings.serverLogLevel];
      if (level !== undefined) setLogLevel(level);
      setRequestLoggingEnabled(settings.enableRequestLogging ?? true);
    }
    await this.agents.initialize();
    if (this.stopping || !settings?.projects?.length) return;
    try {
      for (const project of settings.projects) {
        if (this.stopping) return;
        await this.autoMode.reconcileFeatureStates(project.path);
      }
      for (const project of settings.projects) this.resume(project.path);
    } catch {
      logger.warn('Failed to reconcile feature states.');
    }
  }

  private resume(projectPath: string): void {
    const task = Promise.resolve()
      .then(async () => {
        if (!this.stopping) await this.autoMode.resumeInterruptedFeatures(projectPath);
      })
      .catch(() => {
        logger.warn('Failed to resume interrupted features.');
      });
    this.resumes.add(task);
    void task.finally(() => this.resumes.delete(task));
  }

  private async startupTask(
    name: string,
    task: () => Promise<void>,
    required: boolean
  ): Promise<void> {
    if (this.stopping) return;
    let timer: NodeJS.Timeout | undefined;
    let timedOut = false;
    const actual = Promise.resolve().then(async () => {
      if (!this.stopping)
        await runWithCorrelationContext(createCorrelationId(`startup:${name}:${Date.now()}`), task);
    });
    this.startup.add(actual);
    void actual.then(
      () => this.startup.delete(actual),
      () => this.startup.delete(actual)
    );
    try {
      await Promise.race([
        actual,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            this.stopping = true;
            reject(new Error(`Startup task "${name}" timed out`));
          }, 120_000);
          timer.unref();
        }),
      ]);
    } catch (error) {
      if (required || timedOut) throw error;
      logger.warn(`Startup task "${name}" failed.`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.readiness.markStopping();
    return (this.shutdown ??= this.stop());
  }

  private async stop(): Promise<void> {
    const failures: unknown[] = [];
    // Close admission synchronously, before draining startup or persisting interruption.
    // This does not abort active work until its interruption state has been saved.
    try {
      this.autoMode.closeAdmission();
    } catch (error) {
      failures.push(error);
    }
    const attempt = async (task: () => unknown | Promise<unknown>) => {
      try {
        await task();
      } catch (error) {
        failures.push(error);
      }
    };
    // A timeout stops admission, not the underlying I/O. Keep ownership until it settles.
    await attempt(() => this.drain(this.startup, 'Startup initialization has not stopped.'));
    await attempt(() => this.agents.interruptActiveSessions('Application shutdown'));
    await attempt(() => this.autoMode.markAllRunningFeaturesInterrupted('Application shutdown'));
    await attempt(() => this.autoMode.interruptForShutdown());
    // A resume may own a full feature execution: abort first, then confirm it settled.
    await attempt(() => this.drain(this.resumes, 'Startup recovery has not stopped.'));
    await attempt(() => this.terminal.cleanup());
    await attempt(() => this.tests.cleanup());
    await attempt(() => this.devServer.stopAll());
    await attempt(() => this.managedTests.cleanup());
    await attempt(() => this.managedDev.cleanup());
    if (failures.length) throw new AggregateError(failures, 'Application runtime cleanup failed.');
  }

  private async drain(tasks: ReadonlySet<Promise<void>>, message: string): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.allSettled([...tasks]),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(message)), 5000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
