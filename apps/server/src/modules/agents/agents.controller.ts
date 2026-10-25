import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';

import { AllowedPathFields, AllowedPathGuard } from '../../core/security/index.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import { AgentApplicationService } from './agent-application.service.js';
import { RunningAgentsService } from './running-agents.service.js';
import { RunningAgentsResponseSchema } from '@automaker/contracts/domains/running-agents';
import {
  AgentStartResponseSchema,
  AgentSendResponseSchema,
  AgentHistoryResponseSchema,
  AgentMutationResponseSchema,
  AgentClearResponseSchema,
  AgentModelResponseSchema,
  AgentQueueAddResponseSchema,
  AgentQueueListResponseSchema,
} from '@automaker/contracts/domains/agent';
import {
  AgentModelSchema,
  AgentQueueAddSchema,
  AgentQueueRemoveSchema,
  AgentSendSchema,
  AgentSessionSchema,
  AgentStartSchema,
  type AgentModelRequest,
  type AgentQueueAddRequest,
  type AgentQueueRemoveRequest,
  type AgentSendRequest,
  type AgentSessionRequest,
  type AgentStartRequest,
} from './agent.schemas.js';

@Controller('agent')
@UseGuards(AllowedPathGuard)
export class AgentsController {
  constructor(@Inject(AgentApplicationService) private readonly agents: AgentApplicationService) {}

  @Post('start')
  @HttpCode(200)
  @AllowedPathFields('workingDirectory?')
  async start(@Body(new ZodValidationPipe(AgentStartSchema)) body: AgentStartRequest) {
    return AgentStartResponseSchema.parse(await this.agents.start(body));
  }

  @Post('send')
  @HttpCode(200)
  @AllowedPathFields('workingDirectory?', 'imagePaths?[]')
  send(@Body(new ZodValidationPipe(AgentSendSchema)) body: AgentSendRequest) {
    return AgentSendResponseSchema.parse(this.agents.send(body));
  }

  @Post('history')
  @HttpCode(200)
  async history(@Body(new ZodValidationPipe(AgentSessionSchema)) body: AgentSessionRequest) {
    return AgentHistoryResponseSchema.parse(await this.agents.history(body));
  }

  @Post('stop')
  @HttpCode(200)
  async stop(@Body(new ZodValidationPipe(AgentSessionSchema)) body: AgentSessionRequest) {
    return AgentMutationResponseSchema.parse(await this.agents.stop(body));
  }

  @Post('clear')
  @HttpCode(200)
  async clear(@Body(new ZodValidationPipe(AgentSessionSchema)) body: AgentSessionRequest) {
    return AgentClearResponseSchema.parse(await this.agents.clear(body));
  }

  @Post('model')
  @HttpCode(200)
  async model(@Body(new ZodValidationPipe(AgentModelSchema)) body: AgentModelRequest) {
    return AgentModelResponseSchema.parse(await this.agents.model(body));
  }

  @Post('queue/add')
  @HttpCode(200)
  @AllowedPathFields('imagePaths?[]')
  async queueAdd(@Body(new ZodValidationPipe(AgentQueueAddSchema)) body: AgentQueueAddRequest) {
    return AgentQueueAddResponseSchema.parse(await this.agents.queueAdd(body));
  }

  @Post('queue/list')
  @HttpCode(200)
  async queueList(@Body(new ZodValidationPipe(AgentSessionSchema)) body: AgentSessionRequest) {
    return AgentQueueListResponseSchema.parse(await this.agents.queueList(body));
  }

  @Post('queue/remove')
  @HttpCode(200)
  async queueRemove(
    @Body(new ZodValidationPipe(AgentQueueRemoveSchema)) body: AgentQueueRemoveRequest
  ) {
    return AgentMutationResponseSchema.parse(await this.agents.queueRemove(body));
  }

  @Post('queue/clear')
  @HttpCode(200)
  async queueClear(@Body(new ZodValidationPipe(AgentSessionSchema)) body: AgentSessionRequest) {
    return AgentMutationResponseSchema.parse(await this.agents.queueClear(body));
  }
}

@Controller('running-agents')
export class RunningAgentsController {
  constructor(@Inject(RunningAgentsService) private readonly running: RunningAgentsService) {}

  @Get()
  async list() {
    return RunningAgentsResponseSchema.parse(await this.running.list());
  }
}
