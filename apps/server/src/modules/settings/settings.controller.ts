import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';

import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import {
  DiscoverAgentsSchema,
  DirectSettingsMutationSchema,
  CredentialsUpdateSchema,
  GlobalSettingsUpdateSchema,
  LocalStorageMigrationRequestSchema,
  ModelTimeoutUpdateSchema,
  ModelTimeoutProviderSchema,
  ProjectSettingsReadSchema,
  ProjectSettingsUpdateSchema,
  type CredentialsUpdate,
  type DiscoverAgentsRequest,
  type ProjectSettingsRead,
  type LocalStorageMigrationRequest,
  type ModelTimeoutUpdate,
  type ProjectSettingsUpdate,
} from './settings.schemas.js';
import { SettingsQueryService } from './settings-query.service.js';
import { SettingsCommandService } from './settings-command.service.js';
import { DirectSettingsCommandService } from './direct-settings-command.service.js';
import type { ModelTimeoutProvider } from '@automaker/types';

@Controller('settings')
export class SettingsController {
  constructor(
    @Inject(SettingsQueryService) private readonly queries: SettingsQueryService,
    @Inject(SettingsCommandService) private readonly commands: SettingsCommandService,
    @Inject(DirectSettingsCommandService)
    private readonly directCommands: DirectSettingsCommandService
  ) {}

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

  @Put('global')
  updateGlobal(
    @Body(new ZodValidationPipe(GlobalSettingsUpdateSchema)) updates: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.commands.updateGlobal(updates);
  }

  @Put('credentials')
  updateCredentials(
    @Body(new ZodValidationPipe(CredentialsUpdateSchema)) input: CredentialsUpdate
  ): Promise<Record<string, unknown>> {
    return this.commands.updateCredentials(input);
  }

  @Put('project')
  updateProject(
    @Body(new ZodValidationPipe(ProjectSettingsUpdateSchema)) input: ProjectSettingsUpdate
  ): Promise<Record<string, unknown>> {
    return this.commands.updateProject(input);
  }

  @Post('migrate')
  @HttpCode(200)
  migrate(
    @Body(new ZodValidationPipe(LocalStorageMigrationRequestSchema))
    input: LocalStorageMigrationRequest
  ): Promise<Record<string, unknown>> {
    return this.commands.migrate(input);
  }

  @Put('model-timeouts')
  updateModelTimeouts(
    @Body(new ZodValidationPipe(ModelTimeoutUpdateSchema)) input: ModelTimeoutUpdate
  ): Promise<Record<string, unknown>> {
    return this.commands.updateModelTimeouts(input);
  }

  @Put('model-timeouts/:provider')
  updateProviderModelTimeouts(
    @Param('provider', new ZodValidationPipe(ModelTimeoutProviderSchema))
    provider: ModelTimeoutProvider,
    @Body(new ZodValidationPipe(ModelTimeoutUpdateSchema)) input: ModelTimeoutUpdate
  ): Promise<Record<string, unknown>> {
    return this.commands.updateProviderModelTimeouts(provider, input);
  }

  @Put('openai-compatible/endpoint')
  updateDirectEndpoint(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) input: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.directCommands.updateEndpoint(input);
  }

  @Post('openai-compatible/remove')
  @HttpCode(200)
  removeDirectEndpoint(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) input: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.directCommands.remove(input);
  }

  @Put('openai-compatible/agent')
  updateDirectAgent(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) input: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.directCommands.updateAgent(input);
  }
}
