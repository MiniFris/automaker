import { Inject, Injectable } from '@nestjs/common';
import { parseDirectAgentSettings } from '../../providers/openai-compatible/execution.js';
import { parseOpenAICompatibleEndpoint } from '../../providers/openai-compatible/config.js';
import { discoverFilesystemAgents } from '../../lib/agent-discovery.js';
import { SettingsService } from '../../services/settings-service.js';
import {
  parseModelTimeoutSettings,
  providerModelTimeouts,
  type ModelTimeoutProvider,
  type OpenAICompatibleEndpointStatus,
} from '@automaker/types';
import type { DirectAgentSettings } from '@automaker/types';
import type { DiscoverAgentsRequest, ProjectSettingsRead } from './settings.schemas.js';
import { RUNTIME_CONFIG, type RuntimeConfig } from '../../core/config/index.js';

@Injectable()
export class SettingsQueryService {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig
  ) {}

  async status(): Promise<Record<string, unknown>> {
    const [hasGlobalSettings, hasCredentials] = await Promise.all([
      this.settings.hasGlobalSettings(),
      this.settings.hasCredentials(),
    ]);
    return {
      success: true,
      hasGlobalSettings,
      hasCredentials,
      dataDir: this.settings.getDataDir(),
      needsMigration: !hasGlobalSettings,
    };
  }

  async global(): Promise<Record<string, unknown>> {
    return { success: true, settings: await this.settings.getGlobalSettings() };
  }

  async credentials(): Promise<Record<string, unknown>> {
    return { success: true, credentials: await this.settings.getMaskedCredentials() };
  }

  async project(input: ProjectSettingsRead): Promise<Record<string, unknown>> {
    return {
      success: true,
      settings: await this.settings.getProjectSettings(input.projectPath),
    };
  }

  async discoverAgents(input: DiscoverAgentsRequest): Promise<Record<string, unknown>> {
    return {
      success: true,
      agents: await discoverFilesystemAgents(
        input.projectPath,
        input.sources ?? ['user', 'project']
      ),
    };
  }

  async modelTimeouts(): Promise<Record<string, unknown>> {
    const global = await this.settings.getGlobalSettings();
    return { success: true, timeouts: parseModelTimeoutSettings(global.modelTimeouts ?? {}) };
  }

  async providerModelTimeouts(provider: ModelTimeoutProvider): Promise<Record<string, unknown>> {
    return {
      success: true,
      timeouts: providerModelTimeouts(await this.settings.getGlobalSettings(), provider),
    };
  }

  async openAICompatible(): Promise<{
    success: true;
    endpoints: OpenAICompatibleEndpointStatus[];
    agentSettings: DirectAgentSettings;
  }> {
    const [global, credentials] = await Promise.all([
      this.settings.getGlobalSettings(),
      this.settings.getCredentials(),
    ]);
    return {
      success: true,
      endpoints: (global.openaiCompatibleEndpoints ?? []).map((value) => {
        const endpoint = parseOpenAICompatibleEndpoint(value);
        const key =
          endpoint.auth.type === 'credentials'
            ? credentials.openaiCompatibleApiKeys?.[endpoint.auth.credentialId]
            : endpoint.auth.type === 'env'
              ? this.config.providers.isEnvironmentVariableConfigured(endpoint.auth.variableName)
                ? 'configured'
                : undefined
              : undefined;
        return {
          endpoint,
          keyConfigured: endpoint.auth.type === 'none' || (typeof key === 'string' && !!key.trim()),
        };
      }),
      agentSettings: parseDirectAgentSettings(global.openaiCompatibleAgentSettings ?? {}),
    };
  }
}
