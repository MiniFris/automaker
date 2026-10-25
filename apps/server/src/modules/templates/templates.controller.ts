import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import { CloneTemplateRequestSchema, type CloneTemplateRequest } from './templates.schemas.js';
import { TemplatesService } from './templates.service.js';
import { CloneTemplateResponseSchema } from '@automaker/contracts/domains/templates';

@Controller('templates')
export class TemplatesController {
  constructor(@Inject(TemplatesService) private readonly templates: TemplatesService) {}

  @Post('clone')
  @HttpCode(200)
  async clone(
    @Body(new ZodValidationPipe(CloneTemplateRequestSchema)) input: CloneTemplateRequest
  ): Promise<Record<string, unknown>> {
    return CloneTemplateResponseSchema.parse(await this.templates.clone(input));
  }
}
