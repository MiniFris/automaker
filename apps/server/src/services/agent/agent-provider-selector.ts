import type { ClaudeCompatibleProvider, ExecutionEnvironmentBinding } from '@automaker/types';
import { stripProviderPrefix } from '@automaker/types';
import { createLogger } from '@automaker/utils';
import { getProviderByModelId, resolveProviderContext } from '../../lib/settings-helpers.js';
import type { ProviderRegistry } from '../../modules/providers/provider-registry.service.js';
import type { ToolPolicyService } from '../../modules/providers/tool-policy.service.js';
import type { SettingsService } from '../settings-service.js';

export interface AgentProviderSelection {
  provider?: ClaudeCompatibleProvider;
  resolvedModel?: string;
}

/** Routing/capability policy only: no SDK options, storage or execution side effects. */
export class AgentProviderSelector {
  private readonly logger = createLogger('AgentProviderSelector');

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly tools?: ToolPolicyService
  ) {}

  async resolve(input: {
    requestedModel?: string;
    providerId?: string;
    settings: SettingsService | null;
    signal: AbortSignal;
  }): Promise<AgentProviderSelection> {
    input.signal.throwIfAborted();
    if (!input.requestedModel || !input.settings) return {};
    const result = input.providerId
      ? await resolveProviderContext(
          input.settings,
          input.requestedModel,
          input.providerId,
          '[AgentService]'
        )
      : await getProviderByModelId(input.requestedModel, input.settings, '[AgentService]');
    input.signal.throwIfAborted();
    if (!result.provider) return {};
    this.logger.info(
      `Using provider "${result.provider.name}" for model "${input.requestedModel}"` +
        (result.resolvedModel ? ` -> resolved to "${result.resolvedModel}"` : '')
    );
    return { provider: result.provider, resolvedModel: result.resolvedModel };
  }

  models(
    selection: AgentProviderSelection,
    requestedModel: string | undefined,
    effectiveModel: string
  ) {
    // A mapped Claude model controls SDK budgets, never a custom endpoint's API model ID.
    return {
      routingModel: selection.provider ? (requestedModel ?? effectiveModel) : effectiveModel,
      bareModel: selection.provider
        ? (requestedModel ?? effectiveModel)
        : stripProviderPrefix(effectiveModel),
    };
  }

  supportsVision(model: string): boolean {
    return this.registry.supportsVision(model);
  }

  allowedTools(model: string, requested: string[] | undefined): string[] | undefined {
    if (!this.tools) return requested;
    const capabilities = this.registry
      .byName(this.registry.providerNameForModel(model))
      ?.getCapabilities();
    return this.tools.resolve({
      requested,
      readOnly: false,
      providerSupportsTools: capabilities?.tools === true,
    });
  }

  forQuery(model: string, binding: ExecutionEnvironmentBinding | undefined) {
    // Controller CLI auth is not authoritative for a pinned remote runtime.
    const remote = binding?.type === 'ssh' || binding?.type === 'docker';
    return this.registry.providerForModel(model, { throwOnDisconnected: !remote });
  }
}
