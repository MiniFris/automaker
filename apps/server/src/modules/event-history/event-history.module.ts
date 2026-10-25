import { Global, Module } from '@nestjs/common';
import { EventHistoryController } from './event-history.controller.js';
import { EventHistoryApplicationService } from './event-history.service.js';
import { EventReplayService } from './event-replay.service.js';
import { EventHistoryService } from '../../services/event-history-service.js';
import { SECURE_FILESYSTEM, SecurityService } from '../../core/security/index.js';
import type { ProjectEventFilesystem } from '../../services/project-event-storage.js';

@Global()
@Module({
  controllers: [EventHistoryController],
  providers: [
    {
      provide: EventHistoryService,
      inject: [SECURE_FILESYSTEM, SecurityService],
      useFactory: (filesystem: ProjectEventFilesystem, security: SecurityService) =>
        new EventHistoryService(filesystem, (project) =>
          security.validateLocalPath(project, 'event history storage')
        ),
    },
    EventHistoryApplicationService,
    EventReplayService,
  ],
  exports: [EventHistoryService],
})
export class EventHistoryModule {}
