import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import { SessionApplicationService } from './session-application.service.js';
import {
  SessionCreateSchema,
  SessionListQuerySchema,
  SessionParamsSchema,
  SessionUpdateSchema,
  type SessionCreateRequest,
  type SessionListQuery,
  type SessionParams,
  type SessionUpdateRequest,
} from './session.schemas.js';

@Controller('sessions')
export class SessionsController {
  constructor(
    @Inject(SessionApplicationService) private readonly sessions: SessionApplicationService
  ) {}

  @Get()
  list(@Query(new ZodValidationPipe(SessionListQuerySchema)) query: SessionListQuery) {
    return this.sessions.list(query.includeArchived === 'true');
  }

  @Post()
  @HttpCode(200)
  create(@Body(new ZodValidationPipe(SessionCreateSchema)) input: SessionCreateRequest) {
    return this.sessions.create(input);
  }

  @Get(':sessionId')
  get(@Param(new ZodValidationPipe(SessionParamsSchema)) params: SessionParams) {
    return this.sessions.get(params.sessionId);
  }

  @Put(':sessionId')
  update(
    @Param(new ZodValidationPipe(SessionParamsSchema)) params: SessionParams,
    @Body(new ZodValidationPipe(SessionUpdateSchema)) input: SessionUpdateRequest
  ) {
    return this.sessions.update(params.sessionId, input);
  }

  @Post(':sessionId/archive')
  @HttpCode(200)
  archive(@Param(new ZodValidationPipe(SessionParamsSchema)) params: SessionParams) {
    return this.sessions.archive(params.sessionId, true);
  }

  @Post(':sessionId/unarchive')
  @HttpCode(200)
  unarchive(@Param(new ZodValidationPipe(SessionParamsSchema)) params: SessionParams) {
    return this.sessions.archive(params.sessionId, false);
  }

  @Delete(':sessionId')
  remove(@Param(new ZodValidationPipe(SessionParamsSchema)) params: SessionParams) {
    return this.sessions.remove(params.sessionId);
  }
}
