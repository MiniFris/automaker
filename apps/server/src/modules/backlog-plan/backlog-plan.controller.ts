import {
  BacklogApplyResponseSchema,
  BacklogStatusResponseSchema,
  PlanningAcceptedResponseSchema,
  PlanningSuccessResponseSchema,
} from '@automaker/contracts/domains/planning-responses';
import { Body, Controller, Get, HttpCode, Inject, Post, Query, UseGuards } from '@nestjs/common';
import { AllowedPathFields, AllowedPathGuard } from '../../core/security/index.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import { BacklogPlanApplicationService } from './backlog-plan-application.service.js';
import {
  BacklogApplySchema,
  BacklogGenerateSchema,
  BacklogProjectSchema,
  type BacklogApplyRequest,
  type BacklogGenerateRequest,
  type BacklogProjectRequest,
} from './backlog-plan.schemas.js';

@Controller('backlog-plan')
@UseGuards(AllowedPathGuard)
export class BacklogPlanController {
  constructor(
    @Inject(BacklogPlanApplicationService) private readonly plans: BacklogPlanApplicationService
  ) {}

  @Post('generate')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async generate(
    @Body(new ZodValidationPipe(BacklogGenerateSchema)) input: BacklogGenerateRequest
  ) {
    return PlanningAcceptedResponseSchema.parse(await this.plans.generate(input));
  }

  @Post('stop')
  @HttpCode(200)
  async stop() {
    return PlanningSuccessResponseSchema.parse(await this.plans.stop());
  }

  @Get('status')
  @AllowedPathFields('projectPath')
  async status(@Query(new ZodValidationPipe(BacklogProjectSchema)) input: BacklogProjectRequest) {
    return BacklogStatusResponseSchema.parse(await this.plans.status(input.projectPath));
  }

  @Post('apply')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async apply(@Body(new ZodValidationPipe(BacklogApplySchema)) input: BacklogApplyRequest) {
    return BacklogApplyResponseSchema.parse(await this.plans.apply(input));
  }

  @Post('clear')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async clear(@Body(new ZodValidationPipe(BacklogProjectSchema)) input: BacklogProjectRequest) {
    return PlanningSuccessResponseSchema.parse(await this.plans.clear(input.projectPath));
  }
}
