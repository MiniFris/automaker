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
  SessionListResponseSchema,
  SessionCreateResponseSchema,
  SessionReadResponseSchema,
  SessionMetadataEnvelopeSchema,
  SessionMutationResponseSchema,
} from '@automaker/contracts';
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
  async list(@Query(new ZodValidationPipe(SessionListQuerySchema)) query: SessionListQuery) {
    return SessionListResponseSchema.parse(
      await this.sessions.list(query.includeArchived === 'true')
    );
  }

  @Post()
  @HttpCode(200)
  async create(@Body(new ZodValidationPipe(SessionCreateSchema)) input: SessionCreateRequest) {
    return SessionCreateResponseSchema.parse(await this.sessions.create(input));
  }

  @Get(':sessionId')
  async get(@Param(new ZodValidationPipe(SessionParamsSchema)) params: SessionParams) {
    return SessionReadResponseSchema.parse(await this.sessions.get(params.sessionId));
  }

  @Put(':sessionId')
  async update(
    @Param(new ZodValidationPipe(SessionParamsSchema)) params: SessionParams,
    @Body(new ZodValidationPipe(SessionUpdateSchema)) input: SessionUpdateRequest
  ) {
    return SessionMetadataEnvelopeSchema.parse(await this.sessions.update(params.sessionId, input));
  }

  @Post(':sessionId/archive')
  @HttpCode(200)
  async archive(@Param(new ZodValidationPipe(SessionParamsSchema)) params: SessionParams) {
    return SessionMutationResponseSchema.parse(await this.sessions.archive(params.sessionId, true));
  }

  @Post(':sessionId/unarchive')
  @HttpCode(200)
  async unarchive(@Param(new ZodValidationPipe(SessionParamsSchema)) params: SessionParams) {
    return SessionMutationResponseSchema.parse(
      await this.sessions.archive(params.sessionId, false)
    );
  }

  @Delete(':sessionId')
  async remove(@Param(new ZodValidationPipe(SessionParamsSchema)) params: SessionParams) {
    return SessionMutationResponseSchema.parse(await this.sessions.remove(params.sessionId));
  }
}
