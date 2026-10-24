import { ProviderRefreshQuerySchema } from '@automaker/contracts/domains/setup-query';
import { Body, Controller, Get, HttpCode, Inject, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import { ProviderUsageService, type ProviderHttpResult } from './provider-usage.service.js';
import {
  ZaiConfigureSchema,
  ZaiVerifySchema,
  type ZaiConfigureRequest,
  type ZaiVerifyRequest,
} from './provider-usage.schemas.js';

@Controller()
export class ProviderUsageController {
  constructor(@Inject(ProviderUsageService) private readonly usage: ProviderUsageService) {}

  @Get('claude/usage')
  claude(@Res({ passthrough: true }) response: Response) {
    return this.respond(response, this.usage.claudeUsage());
  }

  @Get('codex/usage')
  codex(@Res({ passthrough: true }) response: Response) {
    return this.respond(response, this.usage.codexUsage());
  }

  @Get('codex/models')
  codexModels(
    @Query('refresh', new ZodValidationPipe(ProviderRefreshQuerySchema))
    refresh: string | string[] | undefined,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.respond(response, this.usage.codexModelCatalog(refresh === 'true'));
  }

  @Get('gemini/usage')
  gemini(@Res({ passthrough: true }) response: Response) {
    return this.respond(response, this.usage.geminiUsage());
  }

  @Get('gemini/status')
  geminiStatus(@Res({ passthrough: true }) response: Response) {
    return this.respond(response, this.usage.geminiStatus());
  }

  @Post('zai/configure')
  @HttpCode(200)
  configureZai(
    @Body(new ZodValidationPipe(ZaiConfigureSchema)) body: ZaiConfigureRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.respond(response, this.usage.zaiConfigure(body));
  }

  @Post('zai/verify')
  @HttpCode(200)
  verifyZai(
    @Body(new ZodValidationPipe(ZaiVerifySchema)) body: ZaiVerifyRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.respond(response, this.usage.zaiVerify(body));
  }

  @Get('zai/usage')
  zai(@Res({ passthrough: true }) response: Response) {
    return this.respond(response, this.usage.zaiUsage());
  }

  @Get('zai/status')
  zaiStatus(@Res({ passthrough: true }) response: Response) {
    return this.respond(response, Promise.resolve(this.usage.zaiStatus()));
  }

  private async respond(response: Response, result: Promise<ProviderHttpResult>) {
    const resolved = await result;
    response.status(resolved.status);
    return resolved.body;
  }
}
