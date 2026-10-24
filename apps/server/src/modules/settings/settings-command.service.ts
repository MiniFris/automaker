import { Inject, Injectable } from '@nestjs/common';
import type { GlobalSettings, ProjectSettings } from '../../types/settings.js';
import { SettingsService } from '../../services/settings-service.js';
import { SettingsDomainEvents } from './settings-domain-events.js';
import type {
  LocalStorageMigrationRequest,
  ProjectSettingsUpdate,
  ModelTimeoutUpdate,
} from './settings.schemas.js';
import {
  parseModelTimeoutSettings,
  PROVIDER_TIMEOUT_KEYS,
  type ModelTimeoutProvider,
} from '@automaker/types';
import { ValidationDomainError } from '../../core/errors/index.js';

@Injectable()
export class SettingsCommandService {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(SettingsDomainEvents) private readonly events: SettingsDomainEvents
  ) {}

  async updateGlobal(updates: Record<string, unknown>): Promise<Record<string, unknown>> {
    const previous = await this.settings.getGlobalSettings();
    const current = await this.settings.updateGlobalSettings(updates as Partial<GlobalSettings>);
    await this.events.globalUpdated({
      previous,
      current,
      changed: new Set(Object.keys(updates) as Array<keyof GlobalSettings>),
    });
    return { success: true, settings: current };
  }

  async updateProject(input: ProjectSettingsUpdate): Promise<Record<string, unknown>> {
    return {
      success: true,
      settings: await this.settings.updateProjectSettings(
        input.projectPath,
        input.updates as Partial<ProjectSettings>
      ),
    };
  }

  async migrate(input: LocalStorageMigrationRequest): Promise<Record<string, unknown>> {
    return this.settings.migrateFromLocalStorage(input.data);
  }

  async updateModelTimeouts(input: ModelTimeoutUpdate): Promise<Record<string, unknown>> {
    try {
      const timeouts = parseModelTimeoutSettings(input.timeouts);
      await this.settings.updateGlobalSettings({ modelTimeouts: timeouts });
      return { success: true, timeouts };
    } catch {
      throw new ValidationDomainError(
        'Invalid model timeout settings. Use positive integer milliseconds within the supported timer range.'
      );
    }
  }

  async updateProviderModelTimeouts(
    provider: ModelTimeoutProvider,
    input: ModelTimeoutUpdate
  ): Promise<Record<string, unknown>> {
    try {
      const timeouts = parseModelTimeoutSettings(input.timeouts, PROVIDER_TIMEOUT_KEYS[provider]);
      await this.settings.updateProviderModelTimeouts(provider, timeouts);
      return { success: true, timeouts };
    } catch {
      throw new ValidationDomainError('Invalid provider timeout settings.');
    }
  }
}
