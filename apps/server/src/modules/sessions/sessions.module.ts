import { Module } from '@nestjs/common';
import { LegacySessionAdapter } from './legacy-session.adapter.js';
import { SessionApplicationService } from './session-application.service.js';
import {
  ACTIVE_SESSION_COORDINATOR,
  SESSION_METADATA_REPOSITORY,
} from './session-metadata.repository.js';
import { SessionsController } from './sessions.controller.js';

@Module({
  controllers: [SessionsController],
  providers: [
    LegacySessionAdapter,
    { provide: SESSION_METADATA_REPOSITORY, useExisting: LegacySessionAdapter },
    { provide: ACTIVE_SESSION_COORDINATOR, useExisting: LegacySessionAdapter },
    SessionApplicationService,
  ],
})
export class SessionsModule {}
