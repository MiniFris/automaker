import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';

import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import {
  DiscoverAgentsSchema,
  ModelTimeoutProviderSchema,
  ProjectSettingsReadSchema,
  type DiscoverAgentsRequest,
  type ProjectSettingsRead,
} from './settings.schemas.js';
import { SettingsQueryService } from './settings-query.service.js';
import type { ModelTimeoutProvider } from '@automaker/types';

@Controller('settings')
export class SettingsController {
  constructor(@Inject(SettingsQueryService) private readonly queries: SettingsQueryService) {}

  @Get('status')
  status(): Promise<Record<string, unknown>> {
    return this.queries.status();
  }

  @Get('global')
  global(): Promise<Record<string, unknown>> {
    return this.queries.global();
  }

  @Get('credentials')
  credentials(): Promise<Record<string, unknown>> {
    return this.queries.credentials();
  }

  @Post('project')
  @HttpCode(200)
  project(
    @Body(new ZodValidationPipe(ProjectSettingsReadSchema)) input: ProjectSettingsRead
  ): Promise<Record<string, unknown>> {
    return this.queries.project(input);
  }

  @Post('agents/discover')
  @HttpCode(200)
  discoverAgents(
    @Body(new ZodValidationPipe(DiscoverAgentsSchema)) input: DiscoverAgentsRequest
  ): Promise<Record<string, unknown>> {
    return this.queries.discoverAgents(input);
  }

  @Get('model-timeouts')
  modelTimeouts(): Promise<Record<string, unknown>> {
    return this.queries.modelTimeouts();
  }

  @Get('model-timeouts/:provider')
  providerModelTimeouts(
    @Param('provider', new ZodValidationPipe(ModelTimeoutProviderSchema))
    provider: ModelTimeoutProvider
  ): Promise<Record<string, unknown>> {
    return this.queries.providerModelTimeouts(provider);
  }

  @Get('openai-compatible')
  openAICompatible(): Promise<Record<string, unknown>> {
    return this.queries.openAICompatible();
  }
}
