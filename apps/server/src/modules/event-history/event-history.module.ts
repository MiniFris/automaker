import { Module } from '@nestjs/common';
import { EventHistoryController } from './event-history.controller.js';
import { EventHistoryApplicationService } from './event-history.service.js';
import { EventReplayService } from './event-replay.service.js';
import { LEGACY_SERVICES } from '../../legacy/legacy.tokens.js';
import { EventHistoryService } from '../../services/event-history-service.js';

@Module({
  controllers: [EventHistoryController],
  providers: [
    { provide: EventHistoryService, useExisting: LEGACY_SERVICES.eventHistory },
    EventHistoryApplicationService,
    EventReplayService,
  ],
  exports: [EventHistoryService],
})
export class EventHistoryModule {}
