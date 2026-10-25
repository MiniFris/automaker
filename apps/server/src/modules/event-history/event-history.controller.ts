import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { AllowedPathFields, AllowedPathGuard } from '../../core/security/index.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import {
  EventByIdRequestSchema,
  EventListRequestSchema,
  EventProjectRequestSchema,
  EventReplayRequestSchema,
  type EventByIdRequest,
  type EventListRequest,
  type EventProjectRequest,
  type EventReplayRequest,
} from './event-history.schemas.js';
import { EventHistoryApplicationService } from './event-history.service.js';
import { EventReplayService } from './event-replay.service.js';
import {
  EventHistoryListResponseSchema,
  EventHistoryReadResponseSchema,
  EventHistoryDeleteResponseSchema,
  EventHistoryClearResponseSchema,
  EventHistoryReplayResponseSchema,
} from '@automaker/contracts/domains/event-history';

@Controller('event-history')
@UseGuards(AllowedPathGuard)
@AllowedPathFields('projectPath')
export class EventHistoryController {
  constructor(
    @Inject(EventHistoryApplicationService)
    private readonly history: EventHistoryApplicationService,
    @Inject(EventReplayService) private readonly replayService: EventReplayService
  ) {}

  @Post('list')
  @HttpCode(200)
  async list(@Body(new ZodValidationPipe(EventListRequestSchema)) input: EventListRequest) {
    return EventHistoryListResponseSchema.parse(await this.history.list(input));
  }

  @Post('get')
  @HttpCode(200)
  async get(@Body(new ZodValidationPipe(EventByIdRequestSchema)) input: EventByIdRequest) {
    return EventHistoryReadResponseSchema.parse(await this.history.get(input));
  }

  @Post('delete')
  @HttpCode(200)
  async delete(@Body(new ZodValidationPipe(EventByIdRequestSchema)) input: EventByIdRequest) {
    return EventHistoryDeleteResponseSchema.parse(await this.history.delete(input));
  }

  @Post('clear')
  @HttpCode(200)
  async clear(@Body(new ZodValidationPipe(EventProjectRequestSchema)) input: EventProjectRequest) {
    return EventHistoryClearResponseSchema.parse(await this.history.clear(input));
  }

  @Post('replay')
  @HttpCode(200)
  async replay(@Body(new ZodValidationPipe(EventReplayRequestSchema)) input: EventReplayRequest) {
    return EventHistoryReplayResponseSchema.parse(await this.replayService.replay(input));
  }
}
