import { Module } from '@nestjs/common';

import { AgentApplicationService } from './agent-application.service.js';
import { AgentsController } from './agents.controller.js';

@Module({ controllers: [AgentsController], providers: [AgentApplicationService] })
export class AgentsModule {}
