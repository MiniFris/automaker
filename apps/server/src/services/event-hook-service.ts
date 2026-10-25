/**
 * Event Hook Service - Executes custom actions when system events occur
 *
 * Listens to the event emitter and triggers configured hooks:
 * - Shell commands: Executed with configurable timeout
 * - HTTP webhooks: POST/GET/PUT/PATCH requests with variable substitution
 *
 * Also stores events to history for debugging and replay.
 *
 * Supported events:
 * - feature_created: A new feature was created
 * - feature_success: Feature completed successfully
 * - feature_error: Feature failed with an error
 * - auto_mode_complete: Auto mode finished all features (idle state)
 * - auto_mode_error: Auto mode encountered a critical error
 */

import { createLogger } from '@automaker/utils';
import { performance } from 'node:perf_hooks';
import type { EventBus, ApplicationEventMap } from '../core/eventing/event-bus.js';
import type { SettingsService } from './settings-service.js';
import type { EventHistoryService } from './event-history-service.js';
import type { FeatureLoader } from './feature-loader.js';
import type {
  EventHook,
  EventHookTrigger,
  EventHookShellAction,
  EventHookHttpAction,
  EventHookNtfyAction,
  EventHookContext,
} from '@automaker/types';
import { NtfyService, type NtfyContext } from './ntfy-service.js';
import { EnvironmentBindingStore } from './execution-environment/bindings.js';
import {
  FeatureWorkspaceService,
  featureRunKey,
} from './execution-environment/feature-workspace.js';
import { ExecutionEnvironmentError } from './execution-environment/runtime.js';
import {
  LocalExecutionEnvironment,
  captureNativeLocalEnvironment,
} from './execution-environment/local.js';

const logger = createLogger('EventHooks');

/** Default timeout for shell commands (30 seconds) */
const DEFAULT_SHELL_TIMEOUT = 30000;

/** Default timeout for HTTP requests (10 seconds) */
const DEFAULT_HTTP_TIMEOUT = 10000;

// Use the shared EventHookContext type (aliased locally as HookContext for clarity)
type HookContext = EventHookContext;

/**
 * Auto-mode event payload structure
 */
type AutoModeEventPayload = ApplicationEventMap['auto-mode:event'];

/**
 * Feature created event payload structure
 */
type FeatureCreatedPayload = ApplicationEventMap['feature:created'];

/**
 * Feature status changed event payload structure
 */
interface FeatureStatusChangedPayload {
  featureId: string;
  projectPath: string;
  status: string;
}

/**
 * Type guard to safely narrow AutoModeEventPayload to FeatureStatusChangedPayload
 */
function isFeatureStatusChangedPayload(
  payload: AutoModeEventPayload
): payload is AutoModeEventPayload & FeatureStatusChangedPayload {
  return (
    typeof payload.featureId === 'string' &&
    typeof payload.projectPath === 'string' &&
    typeof payload.status === 'string'
  );
}

/**
 * Feature completed event payload structure
 */
type FeatureCompletedPayload = ApplicationEventMap['feature:completed'];

export class EventHookCleanupError extends Error {
  readonly code = 'EVENT_HOOK_CLEANUP_FAILED';
  constructor() {
    super('Event hook cleanup could not be confirmed.');
  }
}

/**
 * Event Hook Service
 *
 * Manages execution of user-configured event hooks in response to system events.
 * Also stores events to history for debugging and replay.
 */
export class EventHookService {
  private readonly hostEnvironment: Readonly<NodeJS.ProcessEnv>;
  constructor(
    private readonly ntfy: NtfyService,
    hostEnvironment: Readonly<NodeJS.ProcessEnv> = process.env,
    private readonly workingDirectory = process.cwd()
  ) {
    this.hostEnvironment = captureNativeLocalEnvironment(hostEnvironment);
  }
  /** Feature status that indicates agent work is done and awaiting human review (tests skipped) */
  private static readonly STATUS_WAITING_APPROVAL = 'waiting_approval';
  /** Feature status that indicates agent work passed automated verification */
  private static readonly STATUS_VERIFIED = 'verified';

  private events: EventBus | null = null;
  private settingsService: SettingsService | null = null;
  private eventHistoryService: EventHistoryService | null = null;
  private featureLoader: FeatureLoader | null = null;
  private readonly unsubscribers: Array<() => void> = [];
  private readonly pending = new Set<Promise<void>>();
  private readonly cancellation = new AbortController();
  private initialized = false;
  private stopping = true;
  private shutdown?: Promise<void>;
  private cleanupFailed = false;

  /**
   * Track project/feature keys that already had hooks fired via auto_mode_feature_complete
   * to prevent double-firing when feature_status_changed also fires for the same feature.
   * Entries are automatically cleaned up after 30 seconds.
   */
  private recentlyHandledFeatures = new Set<string>();

  /**
   * Timer IDs for pending cleanup of recentlyHandledFeatures entries,
   * keyed by project/feature. Stored so they can be cancelled in destroy().
   */
  private recentlyHandledTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Initialize once with the application EventBus and native storage services.
   */
  initialize(
    events: EventBus,
    settingsService: SettingsService,
    eventHistoryService?: EventHistoryService,
    featureLoader?: FeatureLoader
  ): void {
    if (this.initialized || this.shutdown)
      throw new Error('Event hooks already initialized or stopped.');
    this.initialized = true;
    this.stopping = false;
    this.events = events;
    this.settingsService = settingsService;
    this.eventHistoryService = eventHistoryService || null;
    this.featureLoader = featureLoader || null;

    this.unsubscribers.push(
      events.subscribe('auto-mode:event', (payload) =>
        this.accept(() => this.handleAutoModeEvent(payload))
      )
    );
    this.unsubscribers.push(
      events.subscribe('feature:created', (payload) =>
        this.accept(() => this.handleFeatureCreatedEvent(payload))
      )
    );
    this.unsubscribers.push(
      events.subscribe('feature:completed', (payload) =>
        this.accept(() => this.handleFeatureCompletedEvent(payload))
      )
    );

    logger.info('Event hook service initialized');
  }

  /**
   * Cleanup subscriptions
   */
  destroy(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.stopping = true;
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      try {
        unsubscribe();
      } catch {
        this.cleanupFailed = true;
      }
    }
    this.cancellation.abort();
    // Cancel all pending cleanup timers to avoid cross-session mutations
    for (const timerId of this.recentlyHandledTimers.values()) {
      clearTimeout(timerId);
    }
    this.recentlyHandledTimers.clear();
    this.recentlyHandledFeatures.clear();
    const deadline = performance.now() + 25_000;
    let timer: NodeJS.Timeout | undefined;
    this.shutdown = Promise.race([
      Promise.allSettled([...this.pending]).then(() => {
        if (this.cleanupFailed || performance.now() >= deadline) throw new EventHookCleanupError();
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new EventHookCleanupError()), 25_000);
      }),
    ]).finally(() => {
      clearTimeout(timer);
      this.events = null;
      this.settingsService = null;
      this.eventHistoryService = null;
      this.featureLoader = null;
    });
    return this.shutdown;
  }

  private accept(operation: () => Promise<void>): void {
    if (this.stopping) return;
    const task = Promise.resolve()
      .then(() => {
        if (!this.stopping) return operation();
      })
      .catch(() => logger.error('Event hook processing failed.'))
      .finally(() => this.pending.delete(task));
    this.pending.add(task);
  }

  /**
   * Handle auto-mode events and trigger matching hooks
   */
  private async handleAutoModeEvent(payload: AutoModeEventPayload): Promise<void> {
    if (!payload.type) return;

    // Map internal event types to hook triggers
    let trigger: EventHookTrigger | null = null;

    switch (payload.type) {
      case 'auto_mode_feature_complete':
        // Only map explicit auto-mode completion events.
        // Manual feature completions are emitted as feature:completed.
        if (payload.executionMode !== 'auto') return;
        trigger = payload.passes ? 'feature_success' : 'feature_error';
        // Track this feature so feature_status_changed doesn't double-fire hooks
        if (payload.featureId) {
          this.markFeatureHandled(payload.featureId, payload.projectPath);
        }
        break;
      case 'auto_mode_error':
        // Feature-level error (has featureId) vs auto-mode level error
        trigger = payload.featureId ? 'feature_error' : 'auto_mode_error';
        // Track this feature so feature_status_changed doesn't double-fire hooks
        if (payload.featureId) {
          this.markFeatureHandled(payload.featureId, payload.projectPath);
        }
        break;
      case 'auto_mode_idle':
        trigger = 'auto_mode_complete';
        break;
      case 'feature_status_changed':
        if (isFeatureStatusChangedPayload(payload)) {
          await this.handleFeatureStatusChanged(payload);
        }
        return;
      default:
        // Other event types don't trigger hooks
        return;
    }

    if (!trigger) return;

    // Load feature name if we have featureId but no featureName
    let featureName: string | undefined = undefined;
    if (payload.featureId && payload.projectPath && this.featureLoader) {
      try {
        const feature = await this.featureLoader.get(payload.projectPath, payload.featureId);
        if (feature?.title) {
          featureName = feature.title;
        }
      } catch (error) {
        logger.warn(`Failed to load feature ${payload.featureId} for event hook:`, error);
      }
    }

    // Build context for variable substitution
    // Use loaded featureName (from feature.title) or fall back to payload.featureName
    // Only populate error/errorType for error triggers - don't leak success messages into error fields
    const isErrorTrigger = trigger === 'feature_error' || trigger === 'auto_mode_error';
    const context: HookContext = {
      featureId: payload.featureId,
      featureName: featureName || payload.featureName,
      projectPath: payload.projectPath,
      projectName: payload.projectPath ? this.extractProjectName(payload.projectPath) : undefined,
      error: isErrorTrigger ? payload.error || payload.message : undefined,
      errorType: isErrorTrigger ? payload.errorType : undefined,
      timestamp: new Date().toISOString(),
      eventType: trigger,
    };

    // Execute matching hooks (pass passes for feature completion events)
    await this.executeHooksForTrigger(trigger, context, { passes: payload.passes });
  }

  /**
   * Handle feature:completed events and trigger matching hooks
   */
  private async handleFeatureCompletedEvent(payload: FeatureCompletedPayload): Promise<void> {
    if (!payload.featureId || !payload.projectPath) return;

    // Mark as handled to prevent duplicate firing if feature_status_changed also fires
    this.markFeatureHandled(payload.featureId, payload.projectPath);

    const passes = payload.passes ?? true;
    const trigger: EventHookTrigger = passes ? 'feature_success' : 'feature_error';

    // Load feature name if we have featureId but no featureName
    let featureName: string | undefined = undefined;
    if (payload.projectPath && this.featureLoader) {
      try {
        const feature = await this.featureLoader.get(payload.projectPath, payload.featureId);
        if (feature?.title) {
          featureName = feature.title;
        }
      } catch (error) {
        logger.warn(`Failed to load feature ${payload.featureId} for event hook:`, error);
      }
    }

    const isErrorTrigger = trigger === 'feature_error';
    const context: HookContext = {
      featureId: payload.featureId,
      featureName: featureName || payload.featureName,
      projectPath: payload.projectPath,
      projectName: this.extractProjectName(payload.projectPath),
      error: isErrorTrigger ? payload.message : undefined,
      errorType: undefined,
      timestamp: new Date().toISOString(),
      eventType: trigger,
    };

    await this.executeHooksForTrigger(trigger, context, { passes });
  }

  /**
   * Handle feature:created events and trigger matching hooks
   */
  private async handleFeatureCreatedEvent(payload: FeatureCreatedPayload): Promise<void> {
    if (!payload.featureId || !payload.projectPath) return;
    const context: HookContext = {
      featureId: payload.featureId,
      featureName: payload.featureName,
      projectPath: payload.projectPath,
      projectName: this.extractProjectName(payload.projectPath),
      timestamp: new Date().toISOString(),
      eventType: 'feature_created',
    };

    await this.executeHooksForTrigger('feature_created', context);
  }

  /**
   * Handle feature_status_changed events for non-auto-mode feature completion.
   *
   * Auto-mode features already emit auto_mode_feature_complete which triggers hooks.
   * This handler catches manual (non-auto-mode) feature completions by detecting
   * status transitions to completion states (verified, waiting_approval).
   */
  private async handleFeatureStatusChanged(payload: FeatureStatusChangedPayload): Promise<void> {
    // Skip if this feature was already handled via auto_mode_feature_complete
    if (this.recentlyHandledFeatures.has(this.featureKey(payload.featureId, payload.projectPath))) {
      return;
    }

    let trigger: EventHookTrigger | null = null;

    if (
      payload.status === EventHookService.STATUS_VERIFIED ||
      payload.status === EventHookService.STATUS_WAITING_APPROVAL
    ) {
      trigger = 'feature_success';
    } else {
      // Only completion statuses trigger hooks from status changes
      return;
    }

    // Load feature name
    let featureName: string | undefined = undefined;
    if (this.featureLoader) {
      try {
        const feature = await this.featureLoader.get(payload.projectPath, payload.featureId);
        if (feature?.title) {
          featureName = feature.title;
        }
      } catch (error) {
        logger.warn(`Failed to load feature ${payload.featureId} for status change hook:`, error);
      }
    }

    const context: HookContext = {
      featureId: payload.featureId,
      featureName,
      projectPath: payload.projectPath,
      projectName: this.extractProjectName(payload.projectPath),
      timestamp: new Date().toISOString(),
      eventType: trigger,
    };

    await this.executeHooksForTrigger(trigger, context, { passes: true });
  }

  /**
   * Mark a feature as recently handled to prevent double-firing hooks.
   * Entries are cleaned up after 30 seconds.
   */
  private featureKey(featureId: string, projectPath?: string): string {
    return JSON.stringify([projectPath ?? null, featureId]);
  }

  private markFeatureHandled(featureId: string, projectPath?: string): void {
    if (this.stopping) return;
    const key = this.featureKey(featureId, projectPath);
    // Cancel any existing timer for this feature before setting a new one
    const existing = this.recentlyHandledTimers.get(key);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    this.recentlyHandledFeatures.add(key);
    const timerId = setTimeout(() => {
      this.recentlyHandledFeatures.delete(key);
      this.recentlyHandledTimers.delete(key);
    }, 30000);
    this.recentlyHandledTimers.set(key, timerId);
  }

  /**
   * Execute all enabled hooks matching the given trigger and store event to history
   */
  private async executeHooksForTrigger(
    trigger: EventHookTrigger,
    context: HookContext,
    additionalData?: { passes?: boolean }
  ): Promise<void> {
    if (this.stopping) return;
    // Store event to history (even if no hooks match)
    if (this.eventHistoryService && context.projectPath) {
      try {
        await this.eventHistoryService.storeEvent({
          trigger,
          projectPath: context.projectPath,
          featureId: context.featureId,
          featureName: context.featureName,
          error: context.error,
          errorType: context.errorType,
          passes: additionalData?.passes,
        });
      } catch {
        logger.error('Failed to store event to history.');
      }
    }

    if (this.stopping || !this.settingsService) {
      logger.warn('Settings service not available');
      return;
    }

    try {
      const settings = await this.settingsService.getGlobalSettings();
      if (this.stopping) return;
      const hooks = settings.eventHooks || [];

      // Filter to enabled hooks matching this trigger
      const matchingHooks = hooks.filter((hook) => hook.enabled && hook.trigger === trigger);

      if (matchingHooks.length === 0) {
        return;
      }

      logger.info(`Executing ${matchingHooks.length} hook(s) for trigger: ${trigger}`);

      // Execute hooks in parallel (don't wait for one to finish before starting next)
      await Promise.allSettled(matchingHooks.map((hook) => this.executeHook(hook, context)));
    } catch {
      logger.error('Error executing hooks.');
    }
  }

  /**
   * Execute a single hook
   */
  private async executeHook(hook: EventHook, context: HookContext): Promise<void> {
    if (this.stopping) return;
    const hookName = hook.name || hook.id;

    try {
      if (hook.action.type === 'shell') {
        await this.executeShellHook(hook.action, context, hookName);
      } else if (hook.action.type === 'http') {
        await this.executeHttpHook(hook.action, context, hookName);
      } else if (hook.action.type === 'ntfy') {
        await this.executeNtfyHook(hook.action, context, hookName);
      }
    } catch (error) {
      if (
        error instanceof ExecutionEnvironmentError &&
        ['PROCESS_CLEANUP_FAILED', 'SSH_CLEANUP_UNVERIFIED', 'SSH_OUTCOME_UNKNOWN'].includes(
          error.code
        )
      )
        this.cleanupFailed = true;
      logger.error(`Hook "${hookName}" failed.`);
    }
  }

  /**
   * Execute a shell command hook
   */
  private async executeShellHook(
    action: EventHookShellAction,
    context: HookContext,
    hookName: string
  ): Promise<void> {
    this.cancellation.signal.throwIfAborted();
    const timeout = action.timeout || DEFAULT_SHELL_TIMEOUT;
    if (this.settingsService && context.projectPath) {
      const store = new EnvironmentBindingStore(
        this.settingsService,
        undefined,
        undefined,
        this.hostEnvironment
      );
      const pinned = context.featureId
        ? await store.peek(
            context.projectPath,
            featureRunKey(context.projectPath, context.featureId)
          )
        : undefined;
      if (pinned?.type === 'ssh' || pinned?.type === 'docker' || pinned?.featureWorkspace) {
        const service = new FeatureWorkspaceService(
          this.settingsService,
          undefined,
          this.hostEnvironment
        );
        const remote = await service.prepare(
          context.projectPath,
          {
            id: context.featureId!,
            model: 'direct-internal',
            branchName: (pinned.sshWorkspace ?? pinned.featureWorkspace)?.baseBranch,
          },
          this.cancellation.signal,
          false
        );
        if (!remote)
          throw new ExecutionEnvironmentError(
            'SSH_FEATURE_REQUIRED',
            'Remote feature hook has no pinned workspace.'
          );
        const command = this.substituteVariables(action.command, {
          ...context,
          projectPath: remote.environment.cwd,
        });
        this.cancellation.signal.throwIfAborted();
        const result = await remote.environment.exec(command, this.cancellation.signal, {
          timeoutMs: Math.min(timeout, 600000),
          maxOutputBytes: 12000,
        });
        if (result.exitCode !== 0)
          throw new ExecutionEnvironmentError(
            'SSH_HOOK_FAILED',
            'Remote feature shell hook failed; no host execution was attempted.'
          );
        logger.info(`Shell hook "${hookName}" completed in the pinned ${pinned.type} workspace`);
        return;
      }
      if (
        !pinned &&
        ['ssh', 'docker', 'auto'].includes(
          (await store.configuration(context.projectPath)).resolved.type
        )
      )
        throw new ExecutionEnvironmentError(
          'SSH_FEATURE_REQUIRED',
          'Managed shell hooks require a started feature with a pinned workspace. Unbound/project-wide hooks were not executed on the host.'
        );
    }
    const command = this.substituteVariables(action.command, context);

    logger.info(`Executing shell hook "${hookName}"`);
    // Use the captured application cwd and environment with the shared owned process supervisor.
    const local = await LocalExecutionEnvironment.create(
      this.workingDirectory,
      this.hostEnvironment
    );
    const result = await local.exec(command, this.cancellation.signal, {
      timeoutMs: timeout,
      maxOutputBytes: 1024 * 1024,
      windowsShell: 'cmd',
    });
    if (result.exitCode !== 0) throw new Error('Shell hook failed.');
    logger.info(`Shell hook "${hookName}" completed successfully`);
  }

  /**
   * Execute an HTTP webhook hook
   */
  private async executeHttpHook(
    action: EventHookHttpAction,
    context: HookContext,
    hookName: string
  ): Promise<void> {
    const url = this.substituteVariables(action.url, context);
    const method = action.method || 'POST';

    // Substitute variables in headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (action.headers) {
      for (const [key, value] of Object.entries(action.headers)) {
        headers[key] = this.substituteVariables(value, context);
      }
    }

    // Substitute variables in body
    let body: string | undefined;
    if (action.body) {
      body = this.substituteVariables(action.body, context);
    } else if (method !== 'GET') {
      // Default body with context information
      body = JSON.stringify({
        eventType: context.eventType,
        timestamp: context.timestamp,
        featureId: context.featureId,
        featureName: context.featureName,
        projectPath: context.projectPath,
        projectName: context.projectName,
        error: context.error,
      });
    }

    logger.info(`Executing HTTP hook "${hookName}"`);

    this.cancellation.signal.throwIfAborted();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_HTTP_TIMEOUT);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: method !== 'GET' ? body : undefined,
        signal: AbortSignal.any([controller.signal, this.cancellation.signal]),
      });

      await response.body?.cancel();

      if (!response.ok) {
        logger.warn(`HTTP hook "${hookName}" received status ${response.status}`);
      } else {
        logger.info(`HTTP hook "${hookName}" completed successfully (status: ${response.status})`);
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        logger.error(`HTTP hook "${hookName}" timed out after ${DEFAULT_HTTP_TIMEOUT}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Execute an ntfy.sh notification hook
   */
  private async executeNtfyHook(
    action: EventHookNtfyAction,
    context: HookContext,
    hookName: string
  ): Promise<void> {
    if (!this.settingsService) {
      logger.warn('Settings service not available for ntfy hook');
      return;
    }

    // Get the endpoint configuration
    const settings = await this.settingsService.getGlobalSettings();
    this.cancellation.signal.throwIfAborted();
    const endpoints = settings.ntfyEndpoints || [];
    const endpoint = endpoints.find((e) => e.id === action.endpointId);

    if (!endpoint) {
      logger.error(`Ntfy hook "${hookName}" references unknown endpoint: ${action.endpointId}`);
      return;
    }

    // Convert HookContext to NtfyContext
    const ntfyContext: NtfyContext = {
      featureId: context.featureId,
      featureName: context.featureName,
      projectPath: context.projectPath,
      projectName: context.projectName,
      error: context.error,
      errorType: context.errorType,
      timestamp: context.timestamp,
      eventType: context.eventType,
    };

    // Resolve click URL: action-level overrides endpoint default
    let clickUrl = action.clickUrl || endpoint.defaultClickUrl;

    // Apply deep-link parameters to the resolved click URL
    if (clickUrl && context.projectPath) {
      try {
        const url = new URL(clickUrl);
        url.pathname = '/board';
        // Add projectPath so the UI can switch to the correct project
        url.searchParams.set('projectPath', context.projectPath);
        // Add featureId as query param for deep linking to board with feature output modal
        if (context.featureId) {
          url.searchParams.set('featureId', context.featureId);
        }
        clickUrl = url.toString();
      } catch (error) {
        // If URL parsing fails, log warning and use as-is
        logger.warn(
          `Failed to parse click URL "${clickUrl}" for deep linking: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    logger.info(`Executing ntfy hook "${hookName}" to endpoint "${endpoint.name}"`);

    const result = await this.ntfy.sendNotification(
      endpoint,
      {
        title: action.title,
        body: action.body,
        tags: action.tags,
        emoji: action.emoji,
        clickUrl,
        priority: action.priority,
      },
      ntfyContext,
      this.cancellation.signal
    );

    if (!result.success) {
      logger.warn(`Ntfy hook "${hookName}" failed: ${result.error}`);
    } else {
      logger.info(`Ntfy hook "${hookName}" completed successfully`);
    }
  }

  /**
   * Substitute {{variable}} placeholders in a string
   */
  private substituteVariables(template: string, context: HookContext): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, variable) => {
      const value = context[variable as keyof HookContext];
      if (value === undefined || value === null) {
        return '';
      }
      return String(value);
    });
  }

  /**
   * Extract project name from path
   */
  private extractProjectName(projectPath: string): string {
    const parts = projectPath.split(/[/\\]/);
    return parts[parts.length - 1] || projectPath;
  }
}
