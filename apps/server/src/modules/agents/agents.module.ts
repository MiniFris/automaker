import { Module } from '@nestjs/common';

import { AgentApplicationService } from './agent-application.service.js';
import { AgentsController, RunningAgentsController } from './agents.controller.js';
import { RunningAgentsService } from './running-agents.service.js';
import { AgentStateModule } from './agent-state.module.js';
import { ChatExecutionReadModel } from './chat-execution-read-model.js';
import { AppSpecModule } from '../app-spec/app-spec.module.js';
import { BacklogPlanModule } from '../backlog-plan/backlog-plan.module.js';

@Module({
  imports: [AgentStateModule, AppSpecModule, BacklogPlanModule],
  controllers: [AgentsController, RunningAgentsController],
  providers: [AgentApplicationService, RunningAgentsService, ChatExecutionReadModel],
})
export class AgentsModule {}
