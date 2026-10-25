import {
  settingsQueryServiceProvider,
  settingsCommandServiceProvider,
  directSettingsCommandServiceProvider,
} from './application.providers.js';
import { Global, Module, type DynamicModule } from '@nestjs/common';

import { RuntimePathsService } from '../../core/config/index.js';
import { SECURE_FILESYSTEM, SecurityService } from '../../core/security/index.js';
import type * as SecureFilesystem from '../../lib/secure-fs.js';
import { SettingsService } from '../../services/settings-service.js';
import { SettingsFileRepository } from './settings-file.repository.js';
import { SettingsController } from './settings.controller.js';

import { AgentProfileSource, NodeAgentProfileSource } from './agent-profile.source.js';

import { SettingsDomainEvents } from './settings-domain-events.js';
import { SettingsRuntimeEffectsService } from './settings-runtime-effects.service.js';

import { ExecutionEnvironmentSettingsController } from './execution-environment-settings.controller.js';
import { ExecutionEnvironmentSettingsService } from './execution-environment-settings.service.js';
import { LegacyProfileImporter } from './legacy-profile-importer.js';
import {
  LegacyElectronProfileSource,
  NodeLegacyElectronProfileSource,
} from '../../core/platform/legacy-electron-profile.source.js';

const AUTOMATIC_LEGACY_IMPORT = Symbol('AUTOMATIC_LEGACY_IMPORT');

@Global()
@Module({
  controllers: [SettingsController, ExecutionEnvironmentSettingsController],
  providers: [
    LegacyProfileImporter,
    { provide: LegacyElectronProfileSource, useClass: NodeLegacyElectronProfileSource },
    {
      provide: SettingsService,
      inject: [
        RuntimePathsService,
        SettingsFileRepository,
        LegacyProfileImporter,
        AUTOMATIC_LEGACY_IMPORT,
      ],
      useFactory: (
        paths: RuntimePathsService,
        files: SettingsFileRepository,
        importer: LegacyProfileImporter,
        automatic: boolean
      ) => new SettingsService(paths.dataDirectory, files, importer, automatic),
    },
    {
      provide: SettingsFileRepository,
      inject: [SECURE_FILESYSTEM, SecurityService],
      useFactory: (filesystem: typeof SecureFilesystem, security: SecurityService) =>
        new SettingsFileRepository(
          filesystem,
          (candidate) => security.validateLocalPath(candidate, 'settings storage'),
          true
        ),
    },
    settingsQueryServiceProvider,
    { provide: AgentProfileSource, useClass: NodeAgentProfileSource },
    settingsCommandServiceProvider,
    SettingsDomainEvents,
    SettingsRuntimeEffectsService,
    directSettingsCommandServiceProvider,
    ExecutionEnvironmentSettingsService,
  ],
  exports: [SettingsService, SettingsFileRepository],
})
export class SettingsModule {
  static register(automaticLegacyImport = true): DynamicModule {
    return {
      module: SettingsModule,
      providers: [{ provide: AUTOMATIC_LEGACY_IMPORT, useValue: automaticLegacyImport }],
    };
  }
}
