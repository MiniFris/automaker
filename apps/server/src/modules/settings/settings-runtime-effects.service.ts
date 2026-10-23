import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createLogger, LogLevel, setLogLevel } from '@automaker/utils';

import { setRequestLoggingEnabled } from '../../lib/request-logging-state.js';
import { TerminalService } from '../../services/terminal-service.js';
import { LEGACY_SERVICES } from '../../legacy/legacy.tokens.js';
import { SettingsService } from '../../services/settings-service.js';
import { SettingsDomainEvents, type GlobalSettingsUpdatedEvent } from './settings-domain-events.js';

const logger = createLogger('SettingsRuntimeEffects');
const LOG_LEVELS: Record<string, LogLevel> = {
  error: LogLevel.ERROR,
  warn: LogLevel.WARN,
  info: LogLevel.INFO,
  debug: LogLevel.DEBUG,
};

@Injectable()
export class SettingsRuntimeEffectsService implements OnModuleInit, OnModuleDestroy {
  private unsubscribe?: () => void;

  constructor(
    @Inject(SettingsDomainEvents) private readonly events: SettingsDomainEvents,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(LEGACY_SERVICES.terminal) private readonly terminal: TerminalService
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.events.onGlobalUpdated((event) => this.apply(event));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  private async apply(event: GlobalSettingsUpdatedEvent): Promise<void> {
    if (event.changed.has('serverLogLevel') && event.current.serverLogLevel) {
      const level = LOG_LEVELS[event.current.serverLogLevel];
      if (level !== undefined) setLogLevel(level);
    }
    if (
      event.changed.has('enableRequestLogging') &&
      typeof event.current.enableRequestLogging === 'boolean'
    ) {
      setRequestLoggingEnabled(event.current.enableRequestLogging);
    }
    if (!event.changed.has('theme') || event.previous.theme === event.current.theme) return;

    for (const project of event.current.projects ?? []) {
      try {
        const projectSettings = await this.settings.getProjectSettings(project.path);
        if (
          projectSettings.terminalConfig?.enabled !== false &&
          event.current.terminalConfig?.enabled === true
        ) {
          await this.terminal.onThemeChange(project.path, event.current.theme);
        }
      } catch (error) {
        logger.warn(`Failed to refresh terminal config for ${project.name}`, error);
      }
    }
  }
}
