import { agentApplicationServiceProvider } from './application.providers.js';
import { Module } from '@nestjs/common';

import { AgentsController, RunningAgentsController } from './agents.controller.js';
import { RunningAgentsService } from './running-agents.service.js';
import { AgentStateModule } from './agent-state.module.js';
import { ChatExecutionReadModel } from './chat-execution-read-model.js';
import { AppSpecModule } from '../app-spec/app-spec.module.js';
import { BacklogPlanModule } from '../backlog-plan/backlog-plan.module.js';

@Module({
  imports: [AgentStateModule, AppSpecModule, BacklogPlanModule],
  controllers: [AgentsController, RunningAgentsController],
  providers: [agentApplicationServiceProvider, RunningAgentsService, ChatExecutionReadModel],
})
export class AgentsModule {}
