import { Global, Module } from '@nestjs/common';

import { LEGACY_SERVICES } from '../../legacy/legacy.tokens.js';
import { SettingsService } from '../../services/settings-service.js';
import { SettingsFileRepository } from './settings-file.repository.js';
import { SettingsController } from './settings.controller.js';
import { SettingsQueryService } from './settings-query.service.js';
import { SettingsCommandService } from './settings-command.service.js';
import { SettingsDomainEvents } from './settings-domain-events.js';
import { SettingsRuntimeEffectsService } from './settings-runtime-effects.service.js';
import { DirectSettingsCommandService } from './direct-settings-command.service.js';
import { ExecutionEnvironmentSettingsController } from './execution-environment-settings.controller.js';
import { ExecutionEnvironmentSettingsService } from './execution-environment-settings.service.js';

@Global()
@Module({
  controllers: [SettingsController, ExecutionEnvironmentSettingsController],
  providers: [
    { provide: SettingsService, useExisting: LEGACY_SERVICES.settings },
    SettingsFileRepository,
    SettingsQueryService,
    SettingsCommandService,
    SettingsDomainEvents,
    SettingsRuntimeEffectsService,
    DirectSettingsCommandService,
    ExecutionEnvironmentSettingsService,
  ],
  exports: [SettingsService, SettingsFileRepository],
})
export class SettingsModule {}
