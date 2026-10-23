import { Global, Module } from '@nestjs/common';
import { RUNTIME_CONFIG, type RuntimeConfig } from '../../core/config/index.js';
import { AgentSessionRepository } from '../../services/agent/agent-session.repository.js';
import { AgentSessionRegistry } from '../../services/agent/agent-session-registry.js';

@Global()
@Module({
  providers: [
    AgentSessionRegistry,
    {
      provide: AgentSessionRepository,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) =>
        new AgentSessionRepository(config.storage.dataDirectory),
    },
  ],
  exports: [AgentSessionRegistry, AgentSessionRepository],
})
export class AgentStateModule {}
