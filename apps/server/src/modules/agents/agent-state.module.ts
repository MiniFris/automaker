import { Global, Module } from '@nestjs/common';
import { RUNTIME_CONFIG, type RuntimeConfig } from '../../core/config/index.js';
import { AgentSessionRepository } from '../../services/agent/agent-session.repository.js';
import { AgentSessionRegistry } from '../../services/agent/agent-session-registry.js';
import { AgentExecutionCoordinator } from '../../services/agent/agent-execution-coordinator.js';
import { AgentPromptBuilder } from '../../services/agent/agent-prompt-builder.js';
import { AgentEnvironmentPreparer } from '../../services/agent/agent-environment-preparer.js';

@Global()
@Module({
  providers: [
    AgentSessionRegistry,
    AgentPromptBuilder,
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
  ],
})
export class AgentStateModule {}
