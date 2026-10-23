import { Body, Controller, HttpCode, Inject, Post, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import { DirectSettingsMutationSchema } from './settings.schemas.js';
import { ExecutionEnvironmentSettingsService } from './execution-environment-settings.service.js';

@Controller('settings/execution-environments')
export class ExecutionEnvironmentSettingsController {
  constructor(
    @Inject(ExecutionEnvironmentSettingsService)
    private readonly environments: ExecutionEnvironmentSettingsService
  ) {}

  @Post('inspect')
  @HttpCode(200)
  inspect(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>
  ) {
    return this.environments.inspect(body);
  }

  @Post('feature/inspect')
  @HttpCode(200)
  inspectFeature(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>
  ) {
    return this.environments.inspectFeature(body);
  }

  @Put('global')
  updateGlobal(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>
  ) {
    return this.environments.updateGlobal(body);
  }

  @Put('project')
  updateProject(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>
  ) {
    return this.environments.updateProject(body);
  }

  @Post('local/confirm')
  @HttpCode(200)
  confirmLocal(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>
  ) {
    return this.environments.updateConsent('local', 'confirm', body);
  }

  @Post('local/revoke')
  @HttpCode(200)
  revokeLocal(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>
  ) {
    return this.environments.updateConsent('local', 'revoke', body);
  }

  @Post('auto/confirm')
  @HttpCode(200)
  confirmAuto(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>
  ) {
    return this.environments.updateConsent('auto', 'confirm', body);
  }

  @Post('auto/revoke')
  @HttpCode(200)
  revokeAuto(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>
  ) {
    return this.environments.updateConsent('auto', 'revoke', body);
  }

  @Post('docker/check')
  @HttpCode(200)
  checkDocker(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.abortable(request, response, (signal) =>
      this.environments.checkDocker(body, signal)
    );
  }

  @Post('docker/prepare')
  @HttpCode(200)
  prepareDocker(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.abortable(request, response, (signal) =>
      this.environments.prepareDocker(body, signal)
    );
  }

  private async abortable<T>(
    _request: Request,
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
