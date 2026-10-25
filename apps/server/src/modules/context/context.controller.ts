import { Body, Controller, HttpCode, Inject, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AllowedPathFields, AllowedPathGuard } from '../../core/security/index.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import { ContextDescriptionService } from './context-description.service.js';
import {
  DescribeFileResponseSchema,
  DescribeImageResponseSchema,
} from '@automaker/contracts/domains/context';
import {
  DescribeFileRequestSchema,
  DescribeImageRequestSchema,
  type DescribeFileRequest,
  type DescribeImageRequest,
} from './context.schemas.js';

@Controller('context')
@UseGuards(AllowedPathGuard)
export class ContextController {
  constructor(
    @Inject(ContextDescriptionService) private readonly descriptions: ContextDescriptionService
  ) {}

  @Post('describe-file')
  @HttpCode(200)
  @AllowedPathFields('filePath')
  async describeFile(
    @Body(new ZodValidationPipe(DescribeFileRequestSchema)) input: DescribeFileRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return DescribeFileResponseSchema.parse(
      await this.withCancellation(response, (controller) =>
        this.descriptions.describeFile(input.filePath, controller)
      )
    );
  }

  @Post('describe-image')
  @HttpCode(200)
  @AllowedPathFields('imagePath')
  async describeImage(
    @Body(new ZodValidationPipe(DescribeImageRequestSchema)) input: DescribeImageRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return DescribeImageResponseSchema.parse(
      await this.withCancellation(response, (controller) =>
        this.descriptions.describeImage(input.imagePath, controller)
      )
    );
  }

  private async withCancellation<T>(
    response: Response,
    operation: (controller: AbortController) => Promise<T>
  ): Promise<T> {
    const controller = new AbortController();
    const close = () => {
      if (!response.writableEnded) controller.abort();
    };
    response.on('close', close);
    try {
      return await operation(controller);
    } finally {
      response.off('close', close);
    }
  }
}
