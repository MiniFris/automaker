import type {
  LocalStorageMigrationInput,
  ProjectSettingsUpdateInput,
  ModelTimeoutUpdateInput,
} from './application.inputs.js';

import type { GlobalSettings, ProjectSettings } from '../../types/settings.js';
import { SettingsService } from '../../services/settings-service.js';
import { SettingsDomainEvents } from './settings-domain-events.js';

import {
  parseModelTimeoutSettings,
  PROVIDER_TIMEOUT_KEYS,
  type ModelTimeoutProvider,
} from '@automaker/types';
import { ValidationDomainError } from '../../core/errors/domain-errors.js';

export class SettingsCommandService {
  constructor(
    private readonly settings: SettingsService,
    private readonly events: SettingsDomainEvents
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

  async updateProject(input: ProjectSettingsUpdateInput): Promise<Record<string, unknown>> {
    return {
      success: true,
      settings: await this.settings.updateProjectSettings(
        input.projectPath,
        input.updates as Partial<ProjectSettings>
      ),
    };
  }

  async migrate(input: LocalStorageMigrationInput): Promise<Record<string, unknown>> {
    return this.settings.migrateFromLocalStorage(input.data);
  }

  async updateModelTimeouts(input: ModelTimeoutUpdateInput): Promise<Record<string, unknown>> {
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
    input: ModelTimeoutUpdateInput
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
