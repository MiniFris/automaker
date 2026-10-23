import { Module } from '@nestjs/common';

import { AgentApplicationService } from './agent-application.service.js';
import { AgentsController, RunningAgentsController } from './agents.controller.js';
import { RunningAgentsService } from './running-agents.service.js';

@Module({
  controllers: [AgentsController, RunningAgentsController],
  providers: [AgentApplicationService, RunningAgentsService],
})
export class AgentsModule {}
