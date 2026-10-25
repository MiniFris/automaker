import type { FactoryProvider } from '@nestjs/common';
import { SettingsQueryService } from './settings-query.service.js';
import { SettingsCommandService } from './settings-command.service.js';
import { DirectSettingsCommandService } from './direct-settings-command.service.js';
import { SettingsService } from '../../services/settings-service.js';
import { RUNTIME_CONFIG } from '../../core/config/index.js';
import { SECURE_FILESYSTEM } from '../../core/security/index.js';
import { AgentProfileSource } from './agent-profile.source.js';
import { SettingsDomainEvents } from './settings-domain-events.js';

export const settingsQueryServiceProvider: FactoryProvider<SettingsQueryService> = {
  provide: SettingsQueryService,
  inject: [SettingsService, RUNTIME_CONFIG, SECURE_FILESYSTEM, AgentProfileSource],
  useFactory: (
    settings: ConstructorParameters<typeof SettingsQueryService>[0],
    config: ConstructorParameters<typeof SettingsQueryService>[1],
    filesystem: ConstructorParameters<typeof SettingsQueryService>[2],
    profile: ConstructorParameters<typeof SettingsQueryService>[3]
  ) => new SettingsQueryService(settings, config, filesystem, profile),
};

export const settingsCommandServiceProvider: FactoryProvider<SettingsCommandService> = {
  provide: SettingsCommandService,
  inject: [SettingsService, SettingsDomainEvents],
  useFactory: (
    settings: ConstructorParameters<typeof SettingsCommandService>[0],
    events: ConstructorParameters<typeof SettingsCommandService>[1]
  ) => new SettingsCommandService(settings, events),
};

export const directSettingsCommandServiceProvider: FactoryProvider<DirectSettingsCommandService> = {
  provide: DirectSettingsCommandService,
  inject: [SettingsService, SettingsQueryService],
  useFactory: (
    settings: ConstructorParameters<typeof DirectSettingsCommandService>[0],
    queries: ConstructorParameters<typeof DirectSettingsCommandService>[1]
  ) => new DirectSettingsCommandService(settings, queries),
};
