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
  create(@Body(new ZodValidationPipe(AppSpecCreateSchema)) input: AppSpecCreateRequest) {
    return this.specs.create(input);
  }

  @Post('generate')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  generate(@Body(new ZodValidationPipe(AppSpecGenerateSchema)) input: AppSpecGenerateRequest) {
    return this.specs.generate(input);
  }

  @Post('generate-features')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  generateFeatures(
    @Body(new ZodValidationPipe(AppSpecFeaturesSchema)) input: AppSpecFeaturesRequest
  ) {
    return this.specs.generateFeatures(input);
  }

  @Post('sync')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  sync(@Body(new ZodValidationPipe(AppSpecProjectSchema)) input: AppSpecProjectRequest) {
    return this.specs.sync(input.projectPath);
  }

  @Post('stop')
  @HttpCode(200)
  stop(@Body(new ZodValidationPipe(AppSpecStopSchema)) input: AppSpecStopRequest) {
    return this.specs.stop(input.projectPath);
  }

  @Get('status')
  status(@Query(new ZodValidationPipe(AppSpecStatusSchema)) input: AppSpecStatusRequest) {
    return this.specs.status(input.projectPath);
  }
}
