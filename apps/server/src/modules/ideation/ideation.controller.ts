import { IdeaPromptCategoryParameterSchema } from '@automaker/contracts/domains/ideation';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { AllowedPathFields, AllowedPathGuard } from '../../core/security/index.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import { IdeationApplicationService } from './ideation-application.service.js';
import {
  AddSuggestionSchema,
  ConvertSchema,
  GenerateSuggestionsSchema,
  IdeaCreateSchema,
  IdeaGetSchema,
  IdeaUpdateSchema,
  ProjectRequestSchema,
  SessionGetSchema,
  SessionMessageSchema,
  SessionStartSchema,
  SessionStopSchema,
} from './ideation.schemas.js';

@Controller('ideation')
@UseGuards(AllowedPathGuard)
export class IdeationController {
  constructor(
    @Inject(IdeationApplicationService) private readonly ideation: IdeationApplicationService
  ) {}

  @Post('session/start')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  start(@Body(new ZodValidationPipe(SessionStartSchema)) body: never) {
    return this.ideation.startSession(body);
  }
  @Post('session/message')
  @HttpCode(200)
  message(@Body(new ZodValidationPipe(SessionMessageSchema)) body: never) {
    return this.ideation.message(body);
  }
  @Post('session/stop')
  @HttpCode(200)
  stop(@Body(new ZodValidationPipe(SessionStopSchema)) body: never) {
    return this.ideation.stopSession(body);
  }
  @Post('session/get')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  session(@Body(new ZodValidationPipe(SessionGetSchema)) body: never) {
    return this.ideation.getSession(body);
  }

  @Post('ideas/list')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  list(@Body(new ZodValidationPipe(ProjectRequestSchema)) body: never) {
    return this.ideation.listIdeas(body);
  }
  @Post('ideas/create')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  create(@Body(new ZodValidationPipe(IdeaCreateSchema)) body: never) {
    return this.ideation.createIdea(body);
  }
  @Post('ideas/get')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  get(@Body(new ZodValidationPipe(IdeaGetSchema)) body: never) {
    return this.ideation.getIdea(body);
  }
  @Post('ideas/update')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  update(@Body(new ZodValidationPipe(IdeaUpdateSchema)) body: never) {
    return this.ideation.updateIdea(body);
  }
  @Post('ideas/delete')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  delete(@Body(new ZodValidationPipe(IdeaGetSchema)) body: never) {
    return this.ideation.deleteIdea(body);
  }

  @Post('analyze')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  analyze(@Body(new ZodValidationPipe(ProjectRequestSchema)) body: never) {
    return this.ideation.analyze(body);
  }
  @Post('analysis')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  analysis(@Body(new ZodValidationPipe(ProjectRequestSchema)) body: never) {
    return this.ideation.analysis(body);
  }
  @Post('convert')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  convert(@Body(new ZodValidationPipe(ConvertSchema)) body: never) {
    return this.ideation.convert(body);
  }
  @Post('add-suggestion')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  addSuggestion(@Body(new ZodValidationPipe(AddSuggestionSchema)) body: never) {
    return this.ideation.addSuggestion(body);
  }

  @Get('prompts') prompts() {
    return this.ideation.prompts();
  }
  @Get('prompts/:category') promptsByCategory(
    @Param('category', new ZodValidationPipe(IdeaPromptCategoryParameterSchema)) category: string
  ) {
    return this.ideation.promptsByCategory(category);
  }
  @Post('suggestions/generate')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  suggestions(@Body(new ZodValidationPipe(GenerateSuggestionsSchema)) body: never) {
    return this.ideation.generateSuggestions(body);
  }
}
