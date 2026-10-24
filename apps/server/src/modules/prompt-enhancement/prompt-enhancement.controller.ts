import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AllowedPathFields, AllowedPathGuard } from '../../core/security/index.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import { PromptEnhancementService } from './prompt-enhancement.service.js';
import { DomainError } from '../../core/errors/index.js';
import {
  PromptEnhancementRequestSchema,
  type PromptEnhancementRequest,
} from './prompt-enhancement.schemas.js';

@Controller('enhance-prompt')
@UseGuards(AllowedPathGuard)
export class PromptEnhancementController {
  constructor(
    @Inject(PromptEnhancementService) private readonly enhancement: PromptEnhancementService
  ) {}

  @Post()
  @HttpCode(200)
  @AllowedPathFields('projectPath?')
  async enhance(
    @Body(new ZodValidationPipe(PromptEnhancementRequestSchema)) body: PromptEnhancementRequest
  ) {
    try {
      return await this.enhancement.enhance(body);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error occurred';
      throw new HttpException({ success: false, error: message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
