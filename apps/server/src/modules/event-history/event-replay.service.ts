import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Inject, Injectable } from '@nestjs/common';
import { createLogger } from '@automaker/utils';
import type {
  EventHook,
  EventReplayHookResult,
  EventReplayResult,
  StoredEvent,
} from '@automaker/types';
import { LEGACY_SERVICES } from '../../legacy/legacy.tokens.js';
import type { SettingsService } from '../../services/settings-service.js';
import type { EventReplayRequest } from './event-history.schemas.js';
import { EventHistoryApplicationService } from './event-history.service.js';

const executeShell = promisify(exec);
const logger = createLogger('EventReplay');
const DEFAULT_SHELL_TIMEOUT = 30_000;
const DEFAULT_HTTP_TIMEOUT = 10_000;

interface HookContext {
  featureId?: string;
  featureName?: string;
  projectPath?: string;
  projectName?: string;
  error?: string;
  errorType?: string;
  timestamp: string;
  eventType: string;
}

function substituteVariables(template: string, context: HookContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, variable: keyof HookContext) =>
    String(context[variable] ?? '')
  );
}

@Injectable()
export class EventReplayService {
  constructor(
    @Inject(EventHistoryApplicationService)
    private readonly history: EventHistoryApplicationService,
    @Inject(LEGACY_SERVICES.settings) private readonly settings: SettingsService
  ) {}

  async replay(input: EventReplayRequest): Promise<Record<string, unknown>> {
    const event = await this.history.requireEvent(input);
    const settings = await this.settings.getGlobalSettings();
    let hooks = (settings.eventHooks ?? []).filter(
      (hook) => hook.enabled && hook.trigger === event.trigger
    );
    if (input.hookIds?.length) hooks = hooks.filter((hook) => input.hookIds?.includes(hook.id));
    const context = this.createContext(event);
    const hookResults = await Promise.all(hooks.map((hook) => this.executeHook(hook, context)));
    const result: EventReplayResult = {
      eventId: input.eventId,
      hooksTriggered: hooks.length,
      hookResults,
    };
    logger.info('Event replay completed', { eventId: input.eventId, hooks: hooks.length });
    return { success: true, result };
  }

  private createContext(event: StoredEvent): HookContext {
    return {
      featureId: event.featureId,
      featureName: event.featureName,
      projectPath: event.projectPath,
      projectName: event.projectName,
      error: event.error,
      errorType: event.errorType,
      timestamp: event.timestamp,
      eventType: event.trigger,
    };
  }

  private async executeHook(hook: EventHook, context: HookContext): Promise<EventReplayHookResult> {
    const startedAt = Date.now();
    try {
      if (hook.action.type === 'shell') {
        await executeShell(substituteVariables(hook.action.command, context), {
          timeout: hook.action.timeout || DEFAULT_SHELL_TIMEOUT,
          maxBuffer: 1024 * 1024,
        });
      } else if (hook.action.type === 'http') {
        const response = await this.executeHttpHook(hook, context);
        if (!response.ok)
          return this.result(
            hook,
            startedAt,
            false,
            `HTTP ${response.status}: ${response.statusText}`
          );
      } else {
        return this.result(hook, startedAt, false, 'Unknown hook action type');
      }
      return this.result(hook, startedAt, true);
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'AbortError'
          ? 'Request timed out'
          : error instanceof Error
            ? error.message
            : String(error);
      return this.result(hook, startedAt, false, message);
    }
  }

  private async executeHttpHook(hook: EventHook, context: HookContext): Promise<Response> {
    if (hook.action.type !== 'http') throw new Error('HTTP hook required');
    const method = hook.action.method || 'POST';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    for (const [key, value] of Object.entries(hook.action.headers ?? {}))
      headers[key] = substituteVariables(value, context);
    const body = hook.action.body
      ? substituteVariables(hook.action.body, context)
      : method === 'GET'
        ? undefined
        : JSON.stringify(context);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_HTTP_TIMEOUT);
    timer.unref();
    try {
      return await fetch(substituteVariables(hook.action.url, context), {
        method,
        headers,
        body: method === 'GET' ? undefined : body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private result(
    hook: EventHook,
    startedAt: number,
    success: boolean,
    error?: string
  ): EventReplayHookResult {
    return {
      hookId: hook.id,
      hookName: hook.name,
      success,
      ...(error && { error }),
      durationMs: Date.now() - startedAt,
    };
  }
}
