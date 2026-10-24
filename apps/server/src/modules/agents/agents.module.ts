import { Module } from '@nestjs/common';

import { AgentApplicationService } from './agent-application.service.js';
import { AgentsController, RunningAgentsController } from './agents.controller.js';
import { RunningAgentsService } from './running-agents.service.js';
import { AgentStateModule } from './agent-state.module.js';
import { ChatExecutionReadModel } from './chat-execution-read-model.js';

@Module({
  imports: [AgentStateModule],
  controllers: [AgentsController, RunningAgentsController],
  providers: [AgentApplicationService, RunningAgentsService, ChatExecutionReadModel],
})
export class AgentsModule {}
