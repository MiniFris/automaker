import {
  AppSpecStatusResponseSchema,
  PlanningAcceptedResponseSchema,
  PlanningSuccessResponseSchema,
} from '@automaker/contracts/domains/planning-responses';
import { Body, Controller, Get, HttpCode, Inject, Post, Query, UseGuards } from '@nestjs/common';
import { AllowedPathFields, AllowedPathGuard } from '../../core/security/index.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import { AppSpecApplicationService } from './app-spec-application.service.js';
import {
  AppSpecCreateSchema,
  AppSpecFeaturesSchema,
  AppSpecGenerateSchema,
  AppSpecProjectSchema,
  AppSpecStatusSchema,
  AppSpecStopSchema,
  type AppSpecCreateRequest,
  type AppSpecFeaturesRequest,
  type AppSpecGenerateRequest,
  type AppSpecProjectRequest,
  type AppSpecStatusRequest,
  type AppSpecStopRequest,
} from './app-spec.schemas.js';

@Controller('spec-regeneration')
@UseGuards(AllowedPathGuard)
export class AppSpecController {
  constructor(
    @Inject(AppSpecApplicationService) private readonly specs: AppSpecApplicationService
  ) {}

  @Post('create')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async create(@Body(new ZodValidationPipe(AppSpecCreateSchema)) input: AppSpecCreateRequest) {
    return PlanningAcceptedResponseSchema.parse(await this.specs.create(input));
  }

  @Post('generate')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async generate(
    @Body(new ZodValidationPipe(AppSpecGenerateSchema)) input: AppSpecGenerateRequest
  ) {
    return PlanningAcceptedResponseSchema.parse(await this.specs.generate(input));
  }

  @Post('generate-features')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async generateFeatures(
    @Body(new ZodValidationPipe(AppSpecFeaturesSchema)) input: AppSpecFeaturesRequest
  ) {
    return PlanningAcceptedResponseSchema.parse(await this.specs.generateFeatures(input));
  }

  @Post('sync')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async sync(@Body(new ZodValidationPipe(AppSpecProjectSchema)) input: AppSpecProjectRequest) {
    return PlanningAcceptedResponseSchema.parse(await this.specs.sync(input.projectPath));
  }

  @Post('stop')
  @HttpCode(200)
  async stop(@Body(new ZodValidationPipe(AppSpecStopSchema)) input: AppSpecStopRequest) {
    return PlanningSuccessResponseSchema.parse(await this.specs.stop(input.projectPath));
  }

  @Get('status')
  async status(@Query(new ZodValidationPipe(AppSpecStatusSchema)) input: AppSpecStatusRequest) {
    return AppSpecStatusResponseSchema.parse(await this.specs.status(input.projectPath));
  }
}
