import { Global, Injectable, Module, type OnModuleInit } from '@nestjs/common';

import { LEGACY_SERVICES } from '../../legacy/legacy.tokens.js';
import { ProviderFactory } from '../../providers/provider-factory.js';
import { SettingsService } from '../../services/settings-service.js';
import { SettingsFileRepository } from './settings-file.repository.js';
import { SettingsController } from './settings.controller.js';
import { SettingsQueryService } from './settings-query.service.js';
import { SettingsCommandService } from './settings-command.service.js';
import { SettingsDomainEvents } from './settings-domain-events.js';
import { SettingsRuntimeEffectsService } from './settings-runtime-effects.service.js';
import { DirectSettingsCommandService } from './direct-settings-command.service.js';

/**
 * Connects providers that are still created by the legacy registry to the one
 * settings instance registered in the Nest application graph.
 */
@Injectable()
class SettingsProviderBridge implements OnModuleInit {
  constructor(private readonly settingsService: SettingsService) {}

  onModuleInit(): void {
    ProviderFactory.configure({ settingsService: this.settingsService });
  }
}

@Global()
@Module({
  controllers: [SettingsController],
  providers: [
    { provide: SettingsService, useExisting: LEGACY_SERVICES.settings },
    SettingsFileRepository,
    SettingsQueryService,
    SettingsCommandService,
    SettingsDomainEvents,
    SettingsRuntimeEffectsService,
    DirectSettingsCommandService,
    SettingsProviderBridge,
  ],
  exports: [SettingsService, SettingsFileRepository],
})
export class SettingsModule {}
