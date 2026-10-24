import { Module } from '@nestjs/common';
import { AgentSessionAdapter } from './agent-session.adapter.js';
import { SessionApplicationService } from './session-application.service.js';
import {
  ACTIVE_SESSION_COORDINATOR,
  SESSION_METADATA_REPOSITORY,
} from './session-metadata.repository.js';
import { SessionsController } from './sessions.controller.js';

@Module({
  controllers: [SessionsController],
  providers: [
    AgentSessionAdapter,
    { provide: SESSION_METADATA_REPOSITORY, useExisting: AgentSessionAdapter },
    { provide: ACTIVE_SESSION_COORDINATOR, useExisting: AgentSessionAdapter },
    SessionApplicationService,
  ],
})
export class SessionsModule {}
