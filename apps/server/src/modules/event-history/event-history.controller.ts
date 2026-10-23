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
  list(
    @Body(new ZodValidationPipe(EventListRequestSchema)) input: EventListRequest
  ): Promise<Record<string, unknown>> {
    return this.history.list(input);
  }

  @Post('get')
  @HttpCode(200)
  get(
    @Body(new ZodValidationPipe(EventByIdRequestSchema)) input: EventByIdRequest
  ): Promise<Record<string, unknown>> {
    return this.history.get(input);
  }

  @Post('delete')
  @HttpCode(200)
  delete(
    @Body(new ZodValidationPipe(EventByIdRequestSchema)) input: EventByIdRequest
  ): Promise<Record<string, unknown>> {
    return this.history.delete(input);
  }

  @Post('clear')
  @HttpCode(200)
  clear(
    @Body(new ZodValidationPipe(EventProjectRequestSchema)) input: EventProjectRequest
  ): Promise<Record<string, unknown>> {
    return this.history.clear(input);
  }

  @Post('replay')
  @HttpCode(200)
  replay(
    @Body(new ZodValidationPipe(EventReplayRequestSchema)) input: EventReplayRequest
  ): Promise<Record<string, unknown>> {
    return this.replayService.replay(input);
  }
}
