/**
 * Transitional Automaker service graph
 *
 * Constructs stateful services that are being moved into native Nest providers.
 */

import type { Server } from 'node:http';
import dotenv from 'dotenv';

import { createEventEmitter, type EventEmitter } from './lib/events.js';
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
import { LoginAttemptStore } from './core/auth/login-attempt.store.js';
import { ProviderConnectionRepository } from './modules/providers/provider-connection.repository.js';
import { createProviderRegistrations } from './modules/providers/provider-registrations.js';
import { ProviderRegistry } from './modules/providers/provider-registry.service.js';
import { ToolPolicyService } from './modules/providers/tool-policy.service.js';
import {
  createCorrelationId,
  runWithCorrelationContext,
} from './core/observability/request-context.js';
import { AgentService } from './services/agent-service.js';
import { FeatureLoader } from './services/feature-loader.js';
import { AutoModeServiceCompat } from './services/auto-mode/index.js';
import { TerminalService } from './services/terminal-service.js';
import { SettingsService } from './services/settings-service.js';
import { ClaudeUsageService } from './services/claude-usage-service.js';
import { CodexUsageService } from './services/codex-usage-service.js';
import { CodexAppServerService } from './services/codex-app-server-service.js';
import { CodexModelCacheService } from './services/codex-model-cache-service.js';
import { ZaiUsageService } from './services/zai-usage-service.js';
import { GeminiUsageService } from './services/gemini-usage-service.js';
import { MCPTestService } from './services/mcp-test-service.js';
import { pipelineService as defaultPipelineService } from './services/pipeline-service.js';
import { IdeationService } from './services/ideation-service.js';
import { getDevServerService } from './services/dev-server-service.js';
import { EventHookService } from './services/event-hook-service.js';
import { NotificationService } from './services/notification-service.js';
import { EventHistoryService } from './services/event-history-service.js';
import { getTestRunnerService } from './services/test-runner-service.js';
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
  agentService: AgentService;
  featureLoader: FeatureLoader;
  autoModeService: AutoModeServiceCompat;
  claudeUsageService: ClaudeUsageService;
  codexAppServerService: CodexAppServerService;
  codexModelCacheService: CodexModelCacheService;
  codexUsageService: CodexUsageService;
  zaiUsageService: ZaiUsageService;
  geminiUsageService: GeminiUsageService;
  mcpTestService: MCPTestService;
  ideationService: IdeationService;
  devServerService: ReturnType<typeof getDevServerService>;
  notificationService: NotificationService;
  eventHistoryService: EventHistoryService;
  testRunnerService: ReturnType<typeof getTestRunnerService>;
  terminalService: TerminalService;
  pipelineService: typeof defaultPipelineService;
  eventHookService: EventHookService;
  loginAttemptStore: LoginAttemptStore;
  providerConnections: ProviderConnectionRepository;
  providerRegistry: ProviderRegistry;
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

export function createLegacyApplication(options: LegacyApplicationOptions): LegacyApplication {
  const dataDir = options.dataDir ?? DATA_DIR;
  const workingDirectory = options.workingDirectory ?? process.cwd();
  const serviceOverrides = options.services ?? {};
  const server = options.httpServer;

  // Initialize shared filesystem security before constructing services.
  initAllowedPaths();

  // Create shared event emitter for streaming
  const events: EventEmitter = serviceOverrides.events ?? createEventEmitter();

  // Create services
  // Note: settingsService is created first so it can be injected into other services
  const settingsService = serviceOverrides.settingsService ?? new SettingsService(dataDir);
  const providerConnections =
    serviceOverrides.providerConnections ??
    ProviderConnectionRepository.forWorkingDirectory(workingDirectory);
  const providerRegistry =
    serviceOverrides.providerRegistry ??
    new ProviderRegistry(createProviderRegistrations(settingsService), providerConnections);
  const toolPolicy = new ToolPolicyService();
  const agentService =
    serviceOverrides.agentService ??
    new AgentService(dataDir, events, settingsService, providerRegistry, toolPolicy);
  const featureLoader = serviceOverrides.featureLoader ?? new FeatureLoader();

  // Shared stateful services are constructed once and passed explicitly to both
  // legacy workflows and Nest providers during the transition.
  const notificationService = serviceOverrides.notificationService ?? new NotificationService();
  notificationService.setEventEmitter(events);
  const eventHistoryService = serviceOverrides.eventHistoryService ?? new EventHistoryService();

  // Auto-mode services: compatibility layer provides old interface while using new architecture
  const autoModeService =
    serviceOverrides.autoModeService ??
    new AutoModeServiceCompat(
      events,
      settingsService,
      featureLoader,
      null,
      notificationService,
      providerRegistry,
      toolPolicy
    );
  const claudeUsageService = serviceOverrides.claudeUsageService ?? new ClaudeUsageService();
  const codexAppServerService =
    serviceOverrides.codexAppServerService ?? new CodexAppServerService();
  const codexModelCacheService =
    serviceOverrides.codexModelCacheService ??
    new CodexModelCacheService(dataDir, codexAppServerService);
  const codexUsageService =
    serviceOverrides.codexUsageService ?? new CodexUsageService(codexAppServerService);
  const zaiUsageService = serviceOverrides.zaiUsageService ?? new ZaiUsageService();
  const geminiUsageService = serviceOverrides.geminiUsageService ?? new GeminiUsageService();
  const mcpTestService = serviceOverrides.mcpTestService ?? new MCPTestService(settingsService);
  const ideationService =
    serviceOverrides.ideationService ??
    new IdeationService(events, settingsService, featureLoader, providerRegistry);

  // Initialize DevServerService with event emitter for real-time log streaming
  const devServerService = serviceOverrides.devServerService ?? getDevServerService();

  // Initialize Test Runner Service with event emitter for real-time test output streaming
  const testRunnerService = serviceOverrides.testRunnerService ?? getTestRunnerService();
  testRunnerService.setEventEmitter(events);

  const pipelineService = serviceOverrides.pipelineService ?? defaultPipelineService;
  const eventHookService = serviceOverrides.eventHookService ?? new EventHookService();
  const loginAttemptStore = serviceOverrides.loginAttemptStore ?? new LoginAttemptStore();

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

    await agentService.initialize();
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

    // Bootstrap Codex model cache in background (don't block server startup)
    void codexModelCacheService.getModels().catch((err) => {
      logger.error('Failed to bootstrap Codex model cache:', err);
    });
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

  const terminalService = serviceOverrides.terminalService ?? new TerminalService(settingsService);

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
    shutdownPromise = performGracefulShutdown(signal, exitProcess).finally(() => {
      shutdownPromise = undefined;
    });
    return shutdownPromise;
  };

  const performGracefulShutdown = async (signal: string, exitProcess: boolean): Promise<void> => {
    logger.info(`${signal} received, shutting down...`);

    // Set up a force-exit timeout to prevent hanging
    const forceExitTimeout = setTimeout(() => {
      logger.error(`Shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`);
      if (exitProcess) process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    // Persist interrupted state before aborting provider processes so jobs can recover on restart.
    if (typeof agentService.interruptActiveSessions === 'function') {
      await agentService.interruptActiveSessions(`${signal} signal received`);
    }

    // Mark all running features as interrupted before shutdown
    // This ensures they can be resumed when the server restarts
    // Note: markAllRunningFeaturesInterrupted handles errors internally and never rejects
    await autoModeService.markAllRunningFeaturesInterrupted(`${signal} signal received`);
    autoModeService.interruptForShutdown();

    terminalService.cleanup();
    await getManagedTestRunnerService(settingsService, events).cleanup();
    await getManagedDevServerService(settingsService, events).cleanup();
    clearTimeout(forceExitTimeout);
    logger.info('Application services stopped');
    if (exitProcess) process.exit(0);
  };

  const services: LegacyServiceOverrides = {
    events,
    settingsService,
    agentService,
    featureLoader,
    autoModeService,
    claudeUsageService,
    codexAppServerService,
    codexModelCacheService,
    codexUsageService,
    zaiUsageService,
    geminiUsageService,
    mcpTestService,
    ideationService,
    devServerService,
    notificationService,
    eventHistoryService,
    testRunnerService,
    terminalService,
    pipelineService,
    eventHookService,
    loginAttemptStore,
    providerConnections,
    providerRegistry,
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
