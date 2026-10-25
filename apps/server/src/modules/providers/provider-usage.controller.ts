import {
  ClaudeUsageResponseSchema,
  CodexUsageResponseSchema,
  CodexModelsResponseSchema,
  GeminiUsageResponseSchema,
  GeminiStatusResponseSchema,
  ZaiConfigureResponseSchema,
  ZaiVerifyResponseSchema,
  ZaiUsageResponseSchema,
  ZaiStatusResponseSchema,
} from '@automaker/contracts/domains/provider-usage-responses';
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
  async claude(@Res({ passthrough: true }) response: Response) {
    return ClaudeUsageResponseSchema.parse(await this.respond(response, this.usage.claudeUsage()));
  }

  @Get('codex/usage')
  async codex(@Res({ passthrough: true }) response: Response) {
    return CodexUsageResponseSchema.parse(await this.respond(response, this.usage.codexUsage()));
  }

  @Get('codex/models')
  async codexModels(
    @Query('refresh', new ZodValidationPipe(ProviderRefreshQuerySchema))
    refresh: string | string[] | undefined,
    @Res({ passthrough: true }) response: Response
  ) {
    return CodexModelsResponseSchema.parse(
      await this.respond(response, this.usage.codexModelCatalog(refresh === 'true'))
    );
  }

  @Get('gemini/usage')
  async gemini(@Res({ passthrough: true }) response: Response) {
    return GeminiUsageResponseSchema.parse(await this.respond(response, this.usage.geminiUsage()));
  }

  @Get('gemini/status')
  async geminiStatus(@Res({ passthrough: true }) response: Response) {
    return GeminiStatusResponseSchema.parse(
      await this.respond(response, this.usage.geminiStatus())
    );
  }

  @Post('zai/configure')
  @HttpCode(200)
  async configureZai(
    @Body(new ZodValidationPipe(ZaiConfigureSchema)) body: ZaiConfigureRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return ZaiConfigureResponseSchema.parse(
      await this.respond(response, this.usage.zaiConfigure(body))
    );
  }

  @Post('zai/verify')
  @HttpCode(200)
  async verifyZai(
    @Body(new ZodValidationPipe(ZaiVerifySchema)) body: ZaiVerifyRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return ZaiVerifyResponseSchema.parse(await this.respond(response, this.usage.zaiVerify(body)));
  }

  @Get('zai/usage')
  async zai(@Res({ passthrough: true }) response: Response) {
    return ZaiUsageResponseSchema.parse(await this.respond(response, this.usage.zaiUsage()));
  }

  @Get('zai/status')
  async zaiStatus(@Res({ passthrough: true }) response: Response) {
    return ZaiStatusResponseSchema.parse(
      await this.respond(response, Promise.resolve(this.usage.zaiStatus()))
    );
  }

  private async respond(response: Response, result: Promise<ProviderHttpResult>) {
    const resolved = await result;
    response.status(resolved.status);
    return resolved.body;
  }
}
