import { Inject, Injectable, Logger } from '@nestjs/common';
import type { IdeaCategory } from '@automaker/types';
import { NotFoundDomainError, ValidationDomainError } from '../../core/errors/index.js';
import { LEGACY_SERVICES } from '../../legacy/legacy.tokens.js';
import { APPLICATION_EVENTS } from '../../core/eventing/application-events.js';
import type { EventEmitter } from '../../lib/events.js';
import type { IdeationService } from '../../services/ideation-service.js';
import { FEATURE_REPOSITORY, type FeatureRepository } from '../features/feature.repository.js';
import { FeatureTransitionService } from '../features/feature-transition.service.js';
import { ProjectFeatureSerializer } from '../features/project-feature-serializer.js';
import type {
  AddSuggestionRequest,
  ConvertRequest,
  GenerateSuggestionsRequest,
  IdeaCreateRequest,
  IdeaGetRequest,
  IdeaUpdateRequest,
  ProjectRequest,
  SessionGetRequest,
  SessionMessageRequest,
  SessionStartRequest,
  SessionStopRequest,
} from './ideation.schemas.js';

@Injectable()
export class IdeationApplicationService {
  private readonly logger = new Logger(IdeationApplicationService.name);

  constructor(
    @Inject(LEGACY_SERVICES.ideation) private readonly ideation: IdeationService,
    @Inject(APPLICATION_EVENTS) private readonly events: EventEmitter,
    @Inject(FEATURE_REPOSITORY) private readonly features: FeatureRepository,
    @Inject(ProjectFeatureSerializer) private readonly serializer: ProjectFeatureSerializer,
    @Inject(FeatureTransitionService) private readonly transitions: FeatureTransitionService
  ) {}

  async startSession(input: SessionStartRequest) {
    return {
      success: true as const,
      session: await this.ideation.startSession(input.projectPath, input.options),
    };
  }

  message(input: SessionMessageRequest) {
    void this.ideation
      .sendMessage(input.sessionId, input.message, input.options)
      .catch((error) =>
        this.logger.error(
          'Ideation message failed',
          error instanceof Error ? error.stack : String(error)
        )
      );
    return { success: true as const };
  }

  async stopSession(input: SessionStopRequest) {
    await this.ideation.stopSession(input.sessionId);
    this.events.emit('ideation:session-ended', input);
    return { success: true as const };
  }

  async getSession(input: SessionGetRequest) {
    const session = await this.ideation.getSession(input.projectPath, input.sessionId);
    if (!session) throw new NotFoundDomainError('Session not found');
    return {
      success: true as const,
      session: { ...session, isRunning: this.ideation.isSessionRunning(input.sessionId) },
      messages: session.messages,
    };
  }

  async listIdeas(input: ProjectRequest) {
    return { success: true as const, ideas: await this.ideation.getIdeas(input.projectPath) };
  }

  createIdea(input: IdeaCreateRequest) {
    return this.serializer.run(input.projectPath, async () => {
      const idea = await this.ideation.createIdea(input.projectPath, input.idea);
      this.events.emit('ideation:idea-created', { projectPath: input.projectPath, idea });
      return { success: true as const, idea };
    });
  }

  async getIdea(input: IdeaGetRequest) {
    const idea = await this.ideation.getIdea(input.projectPath, input.ideaId);
    if (!idea) throw new NotFoundDomainError('Idea not found');
    return { success: true as const, idea };
  }

  updateIdea(input: IdeaUpdateRequest) {
    return this.serializer.run(input.projectPath, async () => {
      const idea = await this.ideation.updateIdea(input.projectPath, input.ideaId, input.updates);
      if (!idea) throw new NotFoundDomainError('Idea not found');
      this.events.emit('ideation:idea-updated', {
        projectPath: input.projectPath,
        ideaId: input.ideaId,
        idea,
      });
      return { success: true as const, idea };
    });
  }

  deleteIdea(input: IdeaGetRequest) {
    return this.serializer.run(input.projectPath, async () => {
      await this.ideation.deleteIdea(input.projectPath, input.ideaId);
      this.events.emit('ideation:idea-deleted', input);
      return { success: true as const };
    });
  }

  analyze(input: ProjectRequest) {
    void this.ideation
      .analyzeProject(input.projectPath)
      .catch((error) =>
        this.logger.error(
          'Ideation analysis failed',
          error instanceof Error ? error.stack : String(error)
        )
      );
    return { success: true as const, message: 'Analysis started' };
  }

  async analysis(input: ProjectRequest) {
    return {
      success: true as const,
      result: await this.ideation.getCachedAnalysis(input.projectPath),
    };
  }

  convert(input: ConvertRequest) {
    return this.serializer.run(input.projectPath, async () => {
      const data = await this.ideation.convertToFeature(input.projectPath, input.ideaId);
      if (input.column) data.status = input.column;
      if (input.dependencies?.length) data.dependencies = input.dependencies;
      if (input.tags?.length) data.tags = input.tags;
      this.transitions.assertAllowed(data.status ?? 'backlog');
      const feature = await this.features.create(input.projectPath, data);
      if (!input.keepIdea) {
        await this.ideation.deleteIdea(input.projectPath, input.ideaId);
        this.events.emit('ideation:idea-deleted', {
          projectPath: input.projectPath,
          ideaId: input.ideaId,
        });
      }
      this.events.emit('ideation:idea-converted', {
        projectPath: input.projectPath,
        ideaId: input.ideaId,
        featureId: feature.id,
        keepIdea: !!input.keepIdea,
      });
      return { success: true as const, featureId: feature.id };
    });
  }

  addSuggestion(input: AddSuggestionRequest) {
    return this.serializer.run(input.projectPath, async () => {
      const description = input.suggestion.rationale
        ? `${input.suggestion.description}\n\n**Rationale:** ${input.suggestion.rationale}`
        : input.suggestion.description;
      const feature = await this.features.create(input.projectPath, {
        title: input.suggestion.title,
        description,
        category: this.ideation.mapSuggestionCategoryToFeatureCategory(input.suggestion.category),
        status: 'backlog',
      });
      return { success: true as const, featureId: feature.id };
    });
  }

  prompts() {
    return {
      success: true as const,
      prompts: this.ideation.getAllPrompts(),
      categories: this.ideation.getPromptCategories(),
    };
  }

  promptsByCategory(category: string) {
    const valid = this.ideation.getPromptCategories().some(({ id }) => id === category);
    if (!valid) throw new ValidationDomainError('Invalid category');
    return {
      success: true as const,
      prompts: this.ideation.getPromptsByCategory(category as IdeaCategory),
    };
  }

  async generateSuggestions(input: GenerateSuggestionsRequest) {
    const count = Math.min(Math.max(input.count || 10, 1), 20);
    const suggestions = await this.ideation.generateSuggestions(
      input.projectPath,
      input.promptId,
      input.category,
      count,
      input.contextSources
    );
    return { success: true as const, suggestions };
  }
}
