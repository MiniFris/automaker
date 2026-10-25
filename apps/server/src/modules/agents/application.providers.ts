import type { FactoryProvider } from '@nestjs/common';
import { AgentApplicationService } from './agent-application.service.js';
import { AgentService } from '../../services/agent-service.js';

export const agentApplicationServiceProvider: FactoryProvider<AgentApplicationService> = {
  provide: AgentApplicationService,
  inject: [AgentService],
  useFactory: (agents: ConstructorParameters<typeof AgentApplicationService>[0]) =>
    new AgentApplicationService(agents),
};
