import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';

import { AllowedPathFields, AllowedPathGuard } from '../../core/security/index.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import { AgentApplicationService } from './agent-application.service.js';
import { RunningAgentsService } from './running-agents.service.js';
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
  start(@Body(new ZodValidationPipe(AgentStartSchema)) body: AgentStartRequest) {
    return this.agents.start(body);
  }

  @Post('send')
  @HttpCode(200)
  @AllowedPathFields('workingDirectory?', 'imagePaths?[]')
  send(@Body(new ZodValidationPipe(AgentSendSchema)) body: AgentSendRequest) {
    return this.agents.send(body);
  }

  @Post('history')
  @HttpCode(200)
  history(@Body(new ZodValidationPipe(AgentSessionSchema)) body: AgentSessionRequest) {
    return this.agents.history(body);
  }

  @Post('stop')
  @HttpCode(200)
  stop(@Body(new ZodValidationPipe(AgentSessionSchema)) body: AgentSessionRequest) {
    return this.agents.stop(body);
  }

  @Post('clear')
  @HttpCode(200)
  clear(@Body(new ZodValidationPipe(AgentSessionSchema)) body: AgentSessionRequest) {
    return this.agents.clear(body);
  }

  @Post('model')
  @HttpCode(200)
  model(@Body(new ZodValidationPipe(AgentModelSchema)) body: AgentModelRequest) {
    return this.agents.model(body);
  }

  @Post('queue/add')
  @HttpCode(200)
  @AllowedPathFields('imagePaths?[]')
  queueAdd(@Body(new ZodValidationPipe(AgentQueueAddSchema)) body: AgentQueueAddRequest) {
    return this.agents.queueAdd(body);
  }

  @Post('queue/list')
  @HttpCode(200)
  queueList(@Body(new ZodValidationPipe(AgentSessionSchema)) body: AgentSessionRequest) {
    return this.agents.queueList(body);
  }

  @Post('queue/remove')
  @HttpCode(200)
  queueRemove(@Body(new ZodValidationPipe(AgentQueueRemoveSchema)) body: AgentQueueRemoveRequest) {
    return this.agents.queueRemove(body);
  }

  @Post('queue/clear')
  @HttpCode(200)
  queueClear(@Body(new ZodValidationPipe(AgentSessionSchema)) body: AgentSessionRequest) {
    return this.agents.queueClear(body);
  }
}

@Controller('running-agents')
export class RunningAgentsController {
  constructor(@Inject(RunningAgentsService) private readonly running: RunningAgentsService) {}

  @Get()
  list() {
    return this.running.list();
  }
}
