import {
  Inject,
  Injectable,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { createLogger } from '@automaker/utils';

import { ApplicationLoggingPolicy } from '../../core/observability/logging-policy.js';
import { TerminalService } from '../../services/terminal-service.js';
import { SettingsService } from '../../services/settings-service.js';
import { SettingsDomainEvents, type GlobalSettingsUpdatedEvent } from './settings-domain-events.js';

const logger = createLogger('SettingsRuntimeEffects');
@Injectable()
export class SettingsRuntimeEffectsService implements OnModuleInit, OnModuleDestroy {
  private unsubscribe?: () => void;

  constructor(
    @Inject(SettingsDomainEvents) private readonly events: SettingsDomainEvents,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(TerminalService) private readonly terminal: TerminalService,
    @Optional()
    @Inject(ApplicationLoggingPolicy)
    private readonly logging?: ApplicationLoggingPolicy
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.events.onGlobalUpdated((event) => this.apply(event));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  private async apply(event: GlobalSettingsUpdatedEvent): Promise<void> {
    this.logging?.apply({
      ...(event.changed.has('serverLogLevel') && { serverLogLevel: event.current.serverLogLevel }),
      ...(event.changed.has('enableRequestLogging') && {
        enableRequestLogging: event.current.enableRequestLogging,
      }),
    });
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
