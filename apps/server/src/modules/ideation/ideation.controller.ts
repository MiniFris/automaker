import {
  IdeationAnalysisAcceptedResponseSchema,
  IdeationAnalysisResponseSchema,
  IdeationCategoryPromptsResponseSchema,
  IdeationFeatureResponseSchema,
  IdeationIdeaListResponseSchema,
  IdeationIdeaResponseSchema,
  IdeationPromptsResponseSchema,
  IdeationSessionReadResponseSchema,
  IdeationSessionStartResponseSchema,
  IdeationSuccessResponseSchema,
  IdeationSuggestionsResponseSchema,
} from '@automaker/contracts/domains/ideation-responses';
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
  async start(@Body(new ZodValidationPipe(SessionStartSchema)) body: never) {
    return IdeationSessionStartResponseSchema.parse(await this.ideation.startSession(body));
  }
  @Post('session/message')
  @HttpCode(200)
  async message(@Body(new ZodValidationPipe(SessionMessageSchema)) body: never) {
    return IdeationSuccessResponseSchema.parse(await this.ideation.message(body));
  }
  @Post('session/stop')
  @HttpCode(200)
  async stop(@Body(new ZodValidationPipe(SessionStopSchema)) body: never) {
    return IdeationSuccessResponseSchema.parse(await this.ideation.stopSession(body));
  }
  @Post('session/get')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async session(@Body(new ZodValidationPipe(SessionGetSchema)) body: never) {
    return IdeationSessionReadResponseSchema.parse(await this.ideation.getSession(body));
  }

  @Post('ideas/list')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async list(@Body(new ZodValidationPipe(ProjectRequestSchema)) body: never) {
    return IdeationIdeaListResponseSchema.parse(await this.ideation.listIdeas(body));
  }
  @Post('ideas/create')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async create(@Body(new ZodValidationPipe(IdeaCreateSchema)) body: never) {
    return IdeationIdeaResponseSchema.parse(await this.ideation.createIdea(body));
  }
  @Post('ideas/get')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async get(@Body(new ZodValidationPipe(IdeaGetSchema)) body: never) {
    return IdeationIdeaResponseSchema.parse(await this.ideation.getIdea(body));
  }
  @Post('ideas/update')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async update(@Body(new ZodValidationPipe(IdeaUpdateSchema)) body: never) {
    return IdeationIdeaResponseSchema.parse(await this.ideation.updateIdea(body));
  }
  @Post('ideas/delete')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async delete(@Body(new ZodValidationPipe(IdeaGetSchema)) body: never) {
    return IdeationSuccessResponseSchema.parse(await this.ideation.deleteIdea(body));
  }

  @Post('analyze')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async analyze(@Body(new ZodValidationPipe(ProjectRequestSchema)) body: never) {
    return IdeationAnalysisAcceptedResponseSchema.parse(await this.ideation.analyze(body));
  }
  @Post('analysis')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async analysis(@Body(new ZodValidationPipe(ProjectRequestSchema)) body: never) {
    return IdeationAnalysisResponseSchema.parse(await this.ideation.analysis(body));
  }
  @Post('convert')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async convert(@Body(new ZodValidationPipe(ConvertSchema)) body: never) {
    return IdeationFeatureResponseSchema.parse(await this.ideation.convert(body));
  }
  @Post('add-suggestion')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async addSuggestion(@Body(new ZodValidationPipe(AddSuggestionSchema)) body: never) {
    return IdeationFeatureResponseSchema.parse(await this.ideation.addSuggestion(body));
  }

  @Get('prompts') async prompts() {
    return IdeationPromptsResponseSchema.parse(await this.ideation.prompts());
  }
  @Get('prompts/:category') async promptsByCategory(
    @Param('category', new ZodValidationPipe(IdeaPromptCategoryParameterSchema)) category: string
  ) {
    return IdeationCategoryPromptsResponseSchema.parse(
      await this.ideation.promptsByCategory(category)
    );
  }
  @Post('suggestions/generate')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async suggestions(@Body(new ZodValidationPipe(GenerateSuggestionsSchema)) body: never) {
    return IdeationSuggestionsResponseSchema.parse(await this.ideation.generateSuggestions(body));
  }
}
