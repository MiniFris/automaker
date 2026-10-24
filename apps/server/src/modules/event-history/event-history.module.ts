import { Global, Module } from '@nestjs/common';
import { EventHistoryController } from './event-history.controller.js';
import { EventHistoryApplicationService } from './event-history.service.js';
import { EventReplayService } from './event-replay.service.js';
import { EventHistoryService } from '../../services/event-history-service.js';

@Global()
@Module({
  controllers: [EventHistoryController],
  providers: [EventHistoryService, EventHistoryApplicationService, EventReplayService],
  exports: [EventHistoryService],
})
export class EventHistoryModule {}
