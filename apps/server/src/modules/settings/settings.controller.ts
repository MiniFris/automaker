import {
  SettingsStatusResponseSchema,
  SettingsDocumentResponseSchema,
  SettingsCredentialsResponseSchema,
  SettingsAgentsResponseSchema,
  SettingsTimeoutsResponseSchema,
  SettingsDirectResponseSchema,
  SettingsRetiredCredentialsResponseSchema,
  SettingsMigrationResponseSchema,
  SettingsDirectModelsResponseSchema,
  SettingsDirectTestResponseSchema,
} from '@automaker/contracts/domains/settings';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RETIRED_CREDENTIAL_WRITE } from '@automaker/contracts';

import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import {
  DiscoverAgentsSchema,
  DirectSettingsMutationSchema,
  GlobalSettingsUpdateSchema,
  LocalStorageMigrationRequestSchema,
  ModelTimeoutUpdateSchema,
  ModelTimeoutProviderSchema,
  ProjectSettingsReadSchema,
  ProjectSettingsUpdateSchema,
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
  async status() {
    return SettingsStatusResponseSchema.parse(await this.queries.status());
  }

  @Get('global')
  async global() {
    return SettingsDocumentResponseSchema.parse(await this.queries.global());
  }

  @Get('credentials')
  async credentials() {
    return SettingsCredentialsResponseSchema.parse(await this.queries.credentials());
  }

  @Post('project')
  @HttpCode(200)
  async project(
    @Body(new ZodValidationPipe(ProjectSettingsReadSchema)) input: ProjectSettingsRead
  ) {
    return SettingsDocumentResponseSchema.parse(await this.queries.project(input));
  }

  @Post('agents/discover')
  @HttpCode(200)
  async discoverAgents(
    @Body(new ZodValidationPipe(DiscoverAgentsSchema)) input: DiscoverAgentsRequest
  ) {
    return SettingsAgentsResponseSchema.parse(await this.queries.discoverAgents(input));
  }

  @Get('model-timeouts')
  async modelTimeouts() {
    return SettingsTimeoutsResponseSchema.parse(await this.queries.modelTimeouts());
  }

  @Get('model-timeouts/:provider')
  async providerModelTimeouts(
    @Param('provider', new ZodValidationPipe(ModelTimeoutProviderSchema))
    provider: ModelTimeoutProvider
  ) {
    return SettingsTimeoutsResponseSchema.parse(await this.queries.providerModelTimeouts(provider));
  }

  @Get('openai-compatible')
  async openAICompatible() {
    return SettingsDirectResponseSchema.parse(await this.queries.openAICompatible());
  }

  @Put('global')
  async updateGlobal(
    @Body(new ZodValidationPipe(GlobalSettingsUpdateSchema)) updates: Record<string, unknown>
  ) {
    return SettingsDocumentResponseSchema.parse(await this.commands.updateGlobal(updates));
  }

  @Put('credentials')
  @HttpCode(410)
  retiredCredentialsWrite() {
    return SettingsRetiredCredentialsResponseSchema.parse(RETIRED_CREDENTIAL_WRITE);
  }

  @Put('project')
  async updateProject(
    @Body(new ZodValidationPipe(ProjectSettingsUpdateSchema)) input: ProjectSettingsUpdate
  ) {
    return SettingsDocumentResponseSchema.parse(await this.commands.updateProject(input));
  }

  @Post('migrate')
  @HttpCode(200)
  async migrate(
    @Body(new ZodValidationPipe(LocalStorageMigrationRequestSchema))
    input: LocalStorageMigrationRequest
  ) {
    return SettingsMigrationResponseSchema.parse(await this.commands.migrate(input));
  }

  @Put('model-timeouts')
  async updateModelTimeouts(
    @Body(new ZodValidationPipe(ModelTimeoutUpdateSchema)) input: ModelTimeoutUpdate
  ) {
    return SettingsTimeoutsResponseSchema.parse(await this.commands.updateModelTimeouts(input));
  }

  @Put('model-timeouts/:provider')
  async updateProviderModelTimeouts(
    @Param('provider', new ZodValidationPipe(ModelTimeoutProviderSchema))
    provider: ModelTimeoutProvider,
    @Body(new ZodValidationPipe(ModelTimeoutUpdateSchema)) input: ModelTimeoutUpdate
  ) {
    return SettingsTimeoutsResponseSchema.parse(
      await this.commands.updateProviderModelTimeouts(provider, input)
    );
  }

  @Put('openai-compatible/endpoint')
  async updateDirectEndpoint(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) input: Record<string, unknown>
  ) {
    return SettingsDirectResponseSchema.parse(await this.directCommands.updateEndpoint(input));
  }

  @Post('openai-compatible/remove')
  @HttpCode(200)
  async removeDirectEndpoint(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) input: Record<string, unknown>
  ) {
    return SettingsDirectResponseSchema.parse(await this.directCommands.remove(input));
  }

  @Put('openai-compatible/agent')
  async updateDirectAgent(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) input: Record<string, unknown>
  ) {
    return SettingsDirectResponseSchema.parse(await this.directCommands.updateAgent(input));
  }

  @Post('openai-compatible/models')
  @HttpCode(200)
  async discoverDirectModels(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) input: Record<string, unknown>,
    @Res({ passthrough: true }) response: Response
  ) {
    return SettingsDirectModelsResponseSchema.parse(
      await this.abortable(response, (signal) => this.directCommands.discoverModels(input, signal))
    );
  }

  @Post('openai-compatible/test')
  @HttpCode(200)
  async testDirectConnection(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) input: Record<string, unknown>,
    @Res({ passthrough: true }) response: Response
  ) {
    return SettingsDirectTestResponseSchema.parse(
      await this.abortable(response, (signal) => this.directCommands.testConnection(input, signal))
    );
  }

  private async abortable<T>(
    response: Response,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const controller = new AbortController();
    const close = () => {
      if (!response.writableEnded) controller.abort();
    };
    response.on('close', close);
    try {
      return await operation(controller.signal);
    } finally {
      response.off('close', close);
    }
  }
}
