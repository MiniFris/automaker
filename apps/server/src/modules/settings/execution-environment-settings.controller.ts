import {
  ExecutionEnvironmentSettingsResponseSchema,
  ExecutionEnvironmentFeatureResponseSchema,
  ExecutionDockerDiagnosticResponseSchema,
  ExecutionDockerPreparationResponseSchema,
  ExecutionProviderStatusResponseSchema,
  ExecutionSSHScanResponseSchema,
  ExecutionSSHDiagnosticResponseSchema,
} from '@automaker/contracts/domains/execution-environment-responses';
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
  async inspect(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>
  ) {
    return ExecutionEnvironmentSettingsResponseSchema.parse(await this.environments.inspect(body));
  }

  @Post('feature/inspect')
  @HttpCode(200)
  async inspectFeature(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>
  ) {
    return ExecutionEnvironmentFeatureResponseSchema.parse(
      await this.environments.inspectFeature(body)
    );
  }

  @Put('global')
  async updateGlobal(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>
  ) {
    return ExecutionEnvironmentSettingsResponseSchema.parse(
      await this.environments.updateGlobal(body)
    );
  }

  @Put('project')
  async updateProject(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>
  ) {
    return ExecutionEnvironmentSettingsResponseSchema.parse(
      await this.environments.updateProject(body)
    );
  }

  @Post('local/confirm')
  @HttpCode(200)
  async confirmLocal(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>
  ) {
    return ExecutionEnvironmentSettingsResponseSchema.parse(
      await this.environments.updateConsent('local', 'confirm', body)
    );
  }

  @Post('local/revoke')
  @HttpCode(200)
  async revokeLocal(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>
  ) {
    return ExecutionEnvironmentSettingsResponseSchema.parse(
      await this.environments.updateConsent('local', 'revoke', body)
    );
  }

  @Post('auto/confirm')
  @HttpCode(200)
  async confirmAuto(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>
  ) {
    return ExecutionEnvironmentSettingsResponseSchema.parse(
      await this.environments.updateConsent('auto', 'confirm', body)
    );
  }

  @Post('auto/revoke')
  @HttpCode(200)
  async revokeAuto(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>
  ) {
    return ExecutionEnvironmentSettingsResponseSchema.parse(
      await this.environments.updateConsent('auto', 'revoke', body)
    );
  }

  @Post('docker/check')
  @HttpCode(200)
  async checkDocker(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    return ExecutionDockerDiagnosticResponseSchema.parse(
      await this.abortable(request, response, (signal) =>
        this.environments.checkDocker(body, signal)
      )
    );
  }

  @Post('docker/prepare')
  @HttpCode(200)
  async prepareDocker(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    return ExecutionDockerPreparationResponseSchema.parse(
      await this.abortable(request, response, (signal) =>
        this.environments.prepareDocker(body, signal)
      )
    );
  }

  @Post('providers/inspect')
  @HttpCode(200)
  async inspectProvider(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    return ExecutionProviderStatusResponseSchema.parse(
      await this.abortable(request, response, (signal) =>
        this.environments.providerOperation('inspect', body, signal)
      )
    );
  }

  @Post('providers/install')
  @HttpCode(200)
  async installProvider(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    return ExecutionProviderStatusResponseSchema.parse(
      await this.abortable(request, response, (signal) =>
        this.environments.providerOperation('install', body, signal)
      )
    );
  }

  @Post('providers/key')
  @HttpCode(200)
  async updateProviderKey(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    return ExecutionProviderStatusResponseSchema.parse(
      await this.abortable(request, response, (signal) =>
        this.environments.providerOperation('key', body, signal)
      )
    );
  }

  @Post('ssh/scan')
  @HttpCode(200)
  async scanSSH(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    return ExecutionSSHScanResponseSchema.parse(
      await this.abortable(request, response, (signal) => this.environments.scanSSH(body, signal))
    );
  }

  @Post('ssh/trust')
  @HttpCode(200)
  async trustSSH(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    return ExecutionEnvironmentSettingsResponseSchema.parse(
      await this.abortable(request, response, (signal) => this.environments.trustSSH(body, signal))
    );
  }

  @Post('ssh/key')
  @HttpCode(200)
  async updateSSHKey(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>
  ) {
    return ExecutionEnvironmentSettingsResponseSchema.parse(
      await this.environments.updateSSHKey(body)
    );
  }

  @Post('ssh/check')
  @HttpCode(200)
  async checkSSH(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    return ExecutionSSHDiagnosticResponseSchema.parse(
      await this.abortable(request, response, (signal) => this.environments.checkSSH(body, signal))
    );
  }

  @Post('ssh/prepare')
  @HttpCode(200)
  async prepareSSH(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    return ExecutionEnvironmentSettingsResponseSchema.parse(
      await this.abortable(request, response, (signal) =>
        this.environments.prepareSSH(body, signal)
      )
    );
  }

  @Post('ssh/project')
  @HttpCode(200)
  async prepareSSHProject(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    return ExecutionEnvironmentSettingsResponseSchema.parse(
      await this.abortable(request, response, (signal) =>
        this.environments.prepareSSHProject(body, signal)
      )
    );
  }

  @Post('ssh/recover')
  @HttpCode(200)
  async recoverSSH(
    @Body(new ZodValidationPipe(DirectSettingsMutationSchema)) body: Record<string, unknown>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    return ExecutionEnvironmentSettingsResponseSchema.parse(
      await this.abortable(request, response, (signal) =>
        this.environments.recoverSSH(body, signal)
      )
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
