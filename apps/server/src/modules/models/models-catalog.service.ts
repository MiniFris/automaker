import { Inject, Injectable } from '@nestjs/common';
import { toDirectModelId } from '@automaker/types';

import { RUNTIME_CONFIG, type RuntimeConfig } from '../../core/config/index.js';
import { SettingsService } from '../../services/settings-service.js';
import { ProviderFactory } from '../../providers/provider-factory.js';

@Injectable()
export class ModelsCatalogService {
  constructor(
    @Inject(SettingsService) private readonly settingsService: SettingsService,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig
  ) {}

  async listAvailable(): Promise<Record<string, unknown>> {
    // This is intentionally metadata-only. Provider availability probes belong to
    // getProviders() and are never launched while rendering the model catalog.
    const models = ProviderFactory.getAllAvailableModels();
    const global = await this.settingsService.getGlobalSettings();
    for (const endpoint of global.openaiCompatibleEndpoints ?? []) {
      if (!endpoint.enabled || endpoint.protocol !== 'chat-completions') continue;
      for (const model of endpoint.models)
        models.push({
          id: toDirectModelId(model.id),
          modelString: toDirectModelId(model.id),
          providerId: endpoint.id,
          name: model.displayName,
          provider: 'openai-compatible',
          description: endpoint.name,
          supportsTools: model.capabilities.tools,
          supportsVision: false,
          contextWindow: model.contextWindow,
          maxOutputTokens: model.maxOutputTokens,
        });
    }
    return { success: true, models };
  }

  async getProviders(): Promise<Record<string, unknown>> {
    const statuses = await ProviderFactory.checkAllProviders();
    const global = await this.settingsService.getGlobalSettings();
    return {
      success: true,
      providers: {
        anthropic: {
          available: statuses.claude?.installed || false,
          hasApiKey: this.config.providers.anthropicApiKeyConfigured,
        },
        cursor: {
          available: statuses.cursor?.installed || false,
          version: statuses.cursor?.version,
          path: statuses.cursor?.path,
          method: statuses.cursor?.method,
          authenticated: statuses.cursor?.authenticated,
        },
        'openai-compatible': {
          available: Boolean(
            global.openaiCompatibleEndpoints?.some(
              (endpoint) => endpoint.enabled && endpoint.protocol === 'chat-completions'
            )
          ),
          configuredEndpoints: global.openaiCompatibleEndpoints?.length ?? 0,
        },
      },
    };
  }
}
