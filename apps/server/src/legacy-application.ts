/**
 * Transitional startup and shutdown tasks for the Nest application
 *
 * Stateful dependencies are supplied by Nest; this adapter only coordinates lifecycle tasks.
 */

import type { Server } from 'node:http';
import dotenv from 'dotenv';

import type { EventEmitter } from './lib/events.js';
import { initAllowedPaths, getClaudeAuthIndicators } from '@automaker/platform';
import { createLogger, setLogLevel, LogLevel } from '@automaker/utils';

const logger = createLogger('Server');

/**
 * Map server log level string to LogLevel enum
 */
const LOG_LEVEL_MAP: Record<string, LogLevel> = {
  error: LogLevel.ERROR,
  warn: LogLevel.WARN,
  info: LogLevel.INFO,
  debug: LogLevel.DEBUG,
};
import { setRequestLoggingEnabled } from './lib/request-logging-state.js';
import type { LoginAttemptStore } from './core/auth/login-attempt.store.js';
import {
  createCorrelationId,
  runWithCorrelationContext,
} from './core/observability/request-context.js';
import type { AgentService } from './services/agent-service.js';
import type { FeatureLoader } from './services/feature-loader.js';
import type { AutoModeServiceCompat } from './services/auto-mode/index.js';
import type { TerminalService } from './services/terminal-service.js';
import type { SettingsService } from './services/settings-service.js';
import type { MCPTestService } from './services/mcp-test-service.js';
import type { PipelineService } from './services/pipeline-service.js';
import type { IdeationService } from './services/ideation-service.js';
import type { DevServerService } from './services/dev-server-service.js';
import type { EventHookService } from './services/event-hook-service.js';
import type { NotificationService } from './services/notification-service.js';
import type { EventHistoryService } from './services/event-history-service.js';
import type { TestRunnerService } from './services/test-runner-service.js';
import { getManagedTestRunnerService } from './services/execution-environment/test-runner.js';
import { getManagedDevServerService } from './services/execution-environment/dev-server.js';

// Load environment variables
dotenv.config();

const DATA_DIR = process.env.DATA_DIR || './data';
const BOX_CONTENT_WIDTH = 67;
logger.info('[SERVER_STARTUP] process.env.DATA_DIR:', process.env.DATA_DIR);
logger.info('[SERVER_STARTUP] Resolved DATA_DIR:', DATA_DIR);
logger.info('[SERVER_STARTUP] process.cwd():', process.cwd());
// Check for Claude authentication (async - runs in background)
// The Claude Agent SDK can use either ANTHROPIC_API_KEY or Claude Code CLI authentication
async function checkClaudeAuthentication(): Promise<void> {
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
  const hasEnvOAuthToken = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;

  logger.debug('[CREDENTIAL_CHECK] Starting credential detection...');
  logger.debug('[CREDENTIAL_CHECK] Environment variables:', {
    hasAnthropicKey,
    hasEnvOAuthToken,
  });

  if (hasAnthropicKey) {
    logger.info('✓ ANTHROPIC_API_KEY detected');
    return;
  }

  if (hasEnvOAuthToken) {
    logger.info('✓ CLAUDE_CODE_OAUTH_TOKEN detected');
    return;
  }

  // Check for Claude Code CLI authentication
  // Store indicators outside the try block so we can use them in the warning message
  let cliAuthIndicators: Awaited<ReturnType<typeof getClaudeAuthIndicators>> | null = null;

  try {
    cliAuthIndicators = await getClaudeAuthIndicators();
    const indicators = cliAuthIndicators;

    // Log detailed credential detection results
    const { checks, ...indicatorSummary } = indicators;
    logger.debug('[CREDENTIAL_CHECK] Claude CLI auth indicators:', indicatorSummary);

    logger.debug('[CREDENTIAL_CHECK] File check details:', checks);

    const hasCliAuth =
      indicators.hasStatsCacheWithActivity ||
      (indicators.hasSettingsFile && indicators.hasProjectsSessions) ||
      (indicators.hasCredentialsFile &&
        (indicators.credentials?.hasOAuthToken || indicators.credentials?.hasApiKey));

    logger.debug('[CREDENTIAL_CHECK] Auth determination:', {
      hasCliAuth,
      reason: hasCliAuth
        ? indicators.hasStatsCacheWithActivity
          ? 'stats cache with activity'
          : indicators.hasSettingsFile && indicators.hasProjectsSessions
            ? 'settings file + project sessions'
            : indicators.credentials?.hasOAuthToken
              ? 'credentials file with OAuth token'
              : 'credentials file with API key'
        : 'no valid credentials found',
    });

    if (hasCliAuth) {
      logger.info('✓ Claude Code CLI authentication detected');
      return;
    }
  } catch (error) {
    // Ignore errors checking CLI auth - will fall through to warning
    logger.warn('Error checking for Claude Code CLI authentication:', error);
  }

  // No authentication found - show warning with paths that were checked
  const wHeader = '⚠️  WARNING: No Claude authentication configured'.padEnd(BOX_CONTENT_WIDTH);
  const w1 = 'The Claude Agent SDK requires authentication to function.'.padEnd(BOX_CONTENT_WIDTH);
  const w2 = 'Options:'.padEnd(BOX_CONTENT_WIDTH);
  const w3 = '1. Install Claude Code CLI and authenticate with subscription'.padEnd(
    BOX_CONTENT_WIDTH
  );
  const w4 = '2. Set your Anthropic API key:'.padEnd(BOX_CONTENT_WIDTH);
  const w5 = '   export ANTHROPIC_API_KEY="sk-ant-..."'.padEnd(BOX_CONTENT_WIDTH);
  const w6 = '3. Use the setup wizard in Settings to configure authentication.'.padEnd(
    BOX_CONTENT_WIDTH
  );

  // Build paths checked summary from the indicators (if available)
  let pathsCheckedInfo = '';
  if (cliAuthIndicators) {
    const pathsChecked: string[] = [];

    // Collect paths that were checked (paths are always populated strings)
    pathsChecked.push(`Settings: ${cliAuthIndicators.checks.settingsFile.path}`);
    pathsChecked.push(`Stats cache: ${cliAuthIndicators.checks.statsCache.path}`);
    pathsChecked.push(`Projects dir: ${cliAuthIndicators.checks.projectsDir.path}`);
    for (const credFile of cliAuthIndicators.checks.credentialFiles) {
      pathsChecked.push(`Credentials: ${credFile.path}`);
    }

    if (pathsChecked.length > 0) {
      pathsCheckedInfo = `
║                                                                     ║
║  ${'Paths checked:'.padEnd(BOX_CONTENT_WIDTH)}║
${pathsChecked
  .map((p) => {
    const maxLen = BOX_CONTENT_WIDTH - 4;
    const display = p.length > maxLen ? '...' + p.slice(-(maxLen - 3)) : p;
    return `║    ${display.padEnd(maxLen)}  ║`;
  })
  .join('\n')}`;
    }
  }

  logger.warn(`
╔═════════════════════════════════════════════════════════════════════╗
║  ${wHeader}║
╠═════════════════════════════════════════════════════════════════════╣
║                                                                     ║
║  ${w1}║
║                                                                     ║
║  ${w2}║
║  ${w3}║
║  ${w4}║
║  ${w5}║
║  ${w6}║${pathsCheckedInfo}
║                                                                     ║
╚═════════════════════════════════════════════════════════════════════╝
`);
}

export interface LegacyServiceOverrides {
  events: EventEmitter;
  settingsService: SettingsService;
  featureLoader: FeatureLoader;
  autoModeService: AutoModeServiceCompat;
  mcpTestService: MCPTestService;
  ideationService: IdeationService;
  devServerService: DevServerService;
  notificationService: NotificationService;
  eventHistoryService: EventHistoryService;
  testRunnerService: TestRunnerService;
  terminalService: TerminalService;
  pipelineService: PipelineService;
  eventHookService: EventHookService;
  loginAttemptStore: LoginAttemptStore;
}

export interface LegacyApplicationOptions {
  dataDir?: string;
  runStartupTasks?: boolean;
  httpServer: Server;
  workingDirectory?: string;
  services?: Partial<LegacyServiceOverrides>;
}

export interface LegacyShutdownOptions {
  exitProcess?: boolean;
}

export interface LegacyApplication {
  server: Server;
  events: EventEmitter;
  services: LegacyServiceOverrides;
  initialize(): Promise<void>;
  shutdown(signal?: string, options?: LegacyShutdownOptions): Promise<void>;
  installExceptionHandlers(): void;
}

export function createLegacyApplication(
  options: Omit<LegacyApplicationOptions, 'services'> & {
    services: LegacyServiceOverrides;
    /** Transitional lifecycle bridge, not an owned/overridable legacy service. */
    agents: Pick<AgentService, 'initialize' | 'interruptActiveSessions'>;
  }
): LegacyApplication {
  const dataDir = options.dataDir ?? DATA_DIR;
  const server = options.httpServer;
  const services = options.services;
  const {
    events,
    settingsService,
    autoModeService,
    devServerService,
    testRunnerService,
    terminalService,
  } = services;

  initAllowedPaths();

  // Initialize services
  async function initializeServices(): Promise<void> {
    // Migrate settings from legacy Electron userData location if needed
    // This handles users upgrading from versions that stored settings in ~/.config/Automaker (Linux),
    // ~/Library/Application Support/Automaker (macOS), or %APPDATA%\Automaker (Windows)
    // to the new shared ./data directory
    try {
      const migrationResult = await settingsService.migrateFromLegacyElectronPath();
      if (migrationResult.migrated) {
        logger.info(`Settings migrated from legacy location: ${migrationResult.legacyPath}`);
        logger.info(`Migrated files: ${migrationResult.migratedFiles.join(', ')}`);
      }
      if (migrationResult.errors.length > 0) {
        logger.warn('Migration errors:', migrationResult.errors);
      }
    } catch (err) {
      logger.warn('Failed to check for legacy settings migration:', err);
    }

    // Fetch global settings once and reuse for logging config and feature reconciliation
    let globalSettings: Awaited<ReturnType<typeof settingsService.getGlobalSettings>> | null = null;
    try {
      globalSettings = await settingsService.getGlobalSettings();
    } catch {
      logger.warn('Failed to load global settings, using defaults');
    }

    // Apply logging settings from saved settings
    if (globalSettings) {
      try {
        if (
          globalSettings.serverLogLevel &&
          LOG_LEVEL_MAP[globalSettings.serverLogLevel] !== undefined
        ) {
          setLogLevel(LOG_LEVEL_MAP[globalSettings.serverLogLevel]);
          logger.info(`Server log level set to: ${globalSettings.serverLogLevel}`);
        }
        // Apply request logging setting (default true if not set)
        const enableRequestLog = globalSettings.enableRequestLogging ?? true;
        setRequestLoggingEnabled(enableRequestLog);
        logger.info(`HTTP request logging: ${enableRequestLog ? 'enabled' : 'disabled'}`);
      } catch {
        logger.warn('Failed to apply logging settings, using defaults');
      }
    }

    await options.agents.initialize();
    logger.info('Agent service initialized');

    // Reconcile feature states on startup
    // After any type of restart (clean, forced, crash), features may be stuck in
    // transient states (in_progress, interrupted, pipeline_*) that don't match reality.
    // Reconcile them back to resting states before the UI is served.
    if (globalSettings) {
      try {
        if (globalSettings.projects && globalSettings.projects.length > 0) {
          let totalReconciled = 0;
          for (const project of globalSettings.projects) {
            const count = await autoModeService.reconcileFeatureStates(project.path);
            totalReconciled += count;
          }
          if (totalReconciled > 0) {
            logger.info(
              `[STARTUP] Reconciled ${totalReconciled} feature(s) across ${globalSettings.projects.length} project(s)`
            );
          } else {
            logger.info('[STARTUP] Feature state reconciliation complete - no stale states found');
          }

          // Resume interrupted features in the background for all projects.
          // This handles features stuck in transient states (in_progress, pipeline_*)
          // or explicitly marked as interrupted. Running in background so it doesn't block startup.
          for (const project of globalSettings.projects) {
            autoModeService.resumeInterruptedFeatures(project.path).catch((err) => {
              logger.warn(
                `[STARTUP] Failed to resume interrupted features for ${project.path}:`,
                err
              );
            });
          }
          logger.info('[STARTUP] Initiated background resume of interrupted features');
        }
      } catch (err) {
        logger.warn('[STARTUP] Failed to reconcile feature states:', err);
      }
    }
  }

  const STARTUP_TASK_TIMEOUT_MS = 120_000;
  let startupTasksPromise: Promise<void> | undefined;

  async function runNamedStartupTask(
    name: string,
    task: () => Promise<void>,
    failurePolicy: 'fail-startup' | 'log-and-continue'
  ): Promise<void> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      const correlationId = createCorrelationId(`startup:${name}:${Date.now()}`);
      await Promise.race([
        runWithCorrelationContext(correlationId, task),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`Startup task "${name}" timed out`)),
            STARTUP_TASK_TIMEOUT_MS
          );
          timeout.unref();
        }),
      ]);
    } catch (error) {
      if (failurePolicy === 'fail-startup') throw error;
      logger.error(`Startup task "${name}" failed:`, error);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  function runStartupTasks(): Promise<void> {
    if (startupTasksPromise) return startupTasksPromise;

    startupTasksPromise = (async () => {
      // Required stateful dependencies must be ready before any background task starts.
      await runNamedStartupTask(
        'legacy-service-initialization',
        initializeServices,
        'fail-startup'
      );

      await runNamedStartupTask(
        'dev-server-state-recovery',
        () => devServerService.initialize(dataDir, events),
        'log-and-continue'
      );

      void runNamedStartupTask(
        'claude-authentication-detection',
        checkClaudeAuthentication,
        'log-and-continue'
      );
    })();

    return startupTasksPromise;
  }

  // Global error handlers are installed only by the production entry point.
  const handleUnhandledRejection = (reason: unknown, _promise: Promise<unknown>) => {
    logger.error('Unhandled Promise Rejection:', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
    // Don't exit - log the error and continue running
    // This prevents the server from crashing due to unhandled rejections
  };

  const handleUncaughtException = (error: Error) => {
    logger.error('Uncaught Exception:', {
      message: error.message,
      stack: error.stack,
    });
    // Exit on uncaught exceptions to prevent undefined behavior
    // The process is in an unknown state after an uncaught exception
    process.exit(1);
  };

  // Graceful shutdown timeout (30 seconds)
  const SHUTDOWN_TIMEOUT_MS = 30000;

  // Graceful shutdown helper
  let shutdownPromise: Promise<void> | undefined;
  const gracefulShutdown = (
    signal: string,
    shutdownOptions: LegacyShutdownOptions = {}
  ): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;

    const { exitProcess = false } = shutdownOptions;
    shutdownPromise = performGracefulShutdown(signal, exitProcess);
    return shutdownPromise;
  };

  const performGracefulShutdown = async (signal: string, exitProcess: boolean): Promise<void> => {
    logger.info(`${signal} received, shutting down...`);

    // Set up a force-exit timeout to prevent hanging
    const forceExitTimeout = setTimeout(() => {
      logger.error(`Shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`);
      if (exitProcess) process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    const failures: unknown[] = [];
    const attempt = async (name: string, task: () => unknown | Promise<unknown>) => {
      try {
        await task();
      } catch (error) {
        failures.push(error);
        logger.error(`Shutdown task "${name}" failed; continuing resource cleanup:`, error);
      }
    };
    try {
      // Persistence failure must not prevent abort/drain or cleanup of other resources.
      await attempt('agent-interruption', () =>
        options.agents.interruptActiveSessions(`${signal} signal received`)
      );
      await attempt('feature-interruption', () =>
        autoModeService.markAllRunningFeaturesInterrupted(`${signal} signal received`)
      );
      await attempt('auto-mode-stop', () => autoModeService.interruptForShutdown());
      await attempt('terminal', () => terminalService.cleanup());
      await attempt('test-runner', () => testRunnerService.cleanup());
      await attempt('dev-server', () => devServerService.stopAll());
      await attempt('managed-test-runner', () =>
        getManagedTestRunnerService(settingsService, events).cleanup()
      );
      await attempt('managed-dev-server', () =>
        getManagedDevServerService(settingsService, events).cleanup()
      );
    } finally {
      clearTimeout(forceExitTimeout);
    }
    if (failures.length) throw new AggregateError(failures, 'Application shutdown cleanup failed.');
    logger.info('Application services stopped');
    if (exitProcess) process.exit(0);
  };

  return {
    server,
    events,
    services,
    async initialize() {
      if (options.runStartupTasks) await runStartupTasks();
    },
    shutdown(signal = 'application shutdown', shutdownOptions) {
      return gracefulShutdown(signal, shutdownOptions);
    },
    installExceptionHandlers() {
      process.on('unhandledRejection', handleUnhandledRejection);
      process.on('uncaughtException', handleUncaughtException);
    },
  };
}
