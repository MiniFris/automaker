import { Global, Module } from '@nestjs/common';
import { RUNTIME_CONFIG, type RuntimeConfig } from '../../core/config/index.js';
import { AgentSessionRepository } from '../../services/agent/agent-session.repository.js';
import { AgentSessionRegistry } from '../../services/agent/agent-session-registry.js';
import { AgentExecutionCoordinator } from '../../services/agent/agent-execution-coordinator.js';
import { AgentPromptBuilder } from '../../services/agent/agent-prompt-builder.js';
import { AgentEnvironmentPreparer } from '../../services/agent/agent-environment-preparer.js';
import { AgentProviderSelector } from '../../services/agent/agent-provider-selector.js';
import { AgentQueryOptionsBuilder } from '../../services/agent/agent-query-options-builder.js';
import { ProviderRegistry } from '../providers/provider-registry.service.js';
import { ToolPolicyService } from '../providers/tool-policy.service.js';

@Global()
@Module({
  providers: [
    AgentSessionRegistry,
    AgentPromptBuilder,
    {
      provide: AgentProviderSelector,
      inject: [ProviderRegistry, ToolPolicyService],
      useFactory: (registry: ProviderRegistry, policy: ToolPolicyService) =>
        new AgentProviderSelector(registry, policy),
    },
    {
      provide: AgentQueryOptionsBuilder,
      inject: [AgentProviderSelector],
      useFactory: (providers: AgentProviderSelector) => new AgentQueryOptionsBuilder(providers),
    },
    {
      provide: AgentEnvironmentPreparer,
      inject: [AgentPromptBuilder],
      useFactory: (prompts: AgentPromptBuilder) => new AgentEnvironmentPreparer(prompts),
    },
    { provide: AgentExecutionCoordinator, useFactory: () => new AgentExecutionCoordinator() },
    {
      provide: AgentSessionRepository,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) =>
        new AgentSessionRepository(config.storage.dataDirectory),
    },
  ],
  exports: [
    AgentSessionRegistry,
    AgentSessionRepository,
    AgentExecutionCoordinator,
    AgentPromptBuilder,
    AgentEnvironmentPreparer,
    AgentProviderSelector,
    AgentQueryOptionsBuilder,
  ],
})
export class AgentStateModule {}
