import type {
  AddSuggestionInput,
  ConvertInput,
  GenerateSuggestionsInput,
  IdeaCreateInput,
  IdeaGetInput,
  IdeaUpdateInput,
  ProjectInput,
  SessionGetInput,
  SessionMessageInput,
  SessionStartInput,
  SessionStopInput,
} from './application.inputs.js';

import type { IdeaCategory } from '@automaker/types';
import { NotFoundDomainError, ValidationDomainError } from '../../core/errors/domain-errors.js';

import type { EventEmitter } from '../../lib/events.js';
import { IdeationService } from '../../services/ideation-service.js';
import { type FeatureRepository } from '../features/feature.repository.js';
import { FeatureTransitionService } from '../features/feature-transition.service.js';
import { ProjectFeatureSerializer } from '../features/project-feature-serializer.js';
import { IdeaConversionStore } from './idea-conversion.store.js';

export class IdeationApplicationService {
  constructor(
    private readonly ideation: IdeationService,
    private readonly events: EventEmitter,
    private readonly features: FeatureRepository,
    private readonly serializer: ProjectFeatureSerializer,
    private readonly transitions: FeatureTransitionService,
    private readonly conversions: IdeaConversionStore
  ) {}

  async startSession(input: SessionStartInput) {
    return {
      success: true as const,
      session: await this.ideation.runAccepted(() =>
        this.ideation.startSession(input.projectPath, input.options)
      ),
    };
  }

  message(input: SessionMessageInput) {
    this.ideation.launchMessage(input.sessionId, input.message, input.options);
    return { success: true as const };
  }

  async stopSession(input: SessionStopInput) {
    await this.ideation.runAccepted(() => this.ideation.stopSession(input.sessionId));
    this.events.emit('ideation:session-ended', input);
    return { success: true as const };
  }

  async getSession(input: SessionGetInput) {
    const session = await this.ideation.getSession(input.projectPath, input.sessionId);
    if (!session) throw new NotFoundDomainError('Session not found');
    return {
      success: true as const,
      session: { ...session, isRunning: this.ideation.isSessionRunning(input.sessionId) },
      messages: session.messages,
    };
  }

  async listIdeas(input: ProjectInput) {
    return { success: true as const, ideas: await this.ideation.getIdeas(input.projectPath) };
  }

  createIdea(input: IdeaCreateInput) {
    return this.ideation.runAccepted(() =>
      this.serializer.run(input.projectPath, async () => {
        const idea = await this.ideation.createIdea(input.projectPath, input.idea);
        this.events.emit('ideation:idea-created', { projectPath: input.projectPath, idea });
        return { success: true as const, idea };
      })
    );
  }

  async getIdea(input: IdeaGetInput) {
    const idea = await this.ideation.getIdea(input.projectPath, input.ideaId);
    if (!idea) throw new NotFoundDomainError('Idea not found');
    return { success: true as const, idea };
  }

  updateIdea(input: IdeaUpdateInput) {
    return this.ideation.runAccepted(() =>
      this.serializer.run(input.projectPath, async () => {
        const idea = await this.ideation.updateIdea(input.projectPath, input.ideaId, input.updates);
        if (!idea) throw new NotFoundDomainError('Idea not found');
        this.events.emit('ideation:idea-updated', {
          projectPath: input.projectPath,
          ideaId: input.ideaId,
          idea,
        });
        return { success: true as const, idea };
      })
    );
  }

  deleteIdea(input: IdeaGetInput) {
    return this.ideation.runAccepted(() =>
      this.serializer.run(input.projectPath, async () => {
        await this.ideation.deleteIdea(input.projectPath, input.ideaId);
        this.events.emit('ideation:idea-deleted', input);
        return { success: true as const };
      })
    );
  }

  analyze(input: ProjectInput) {
    this.ideation.launchAnalysis(input.projectPath);
    return { success: true as const, message: 'Analysis started' };
  }

  async analysis(input: ProjectInput) {
    return {
      success: true as const,
      result: await this.ideation.getCachedAnalysis(input.projectPath),
    };
  }

  convert(input: ConvertInput) {
    return this.ideation.runAccepted(() =>
      this.serializer.run(input.projectPath, async () => {
        let intent = await this.conversions.get(input.projectPath, input.ideaId);
        if (!intent) {
          const data = await this.ideation.convertToFeature(input.projectPath, input.ideaId);
          if (input.column) data.status = input.column;
          if (input.dependencies?.length) data.dependencies = input.dependencies;
          if (input.tags?.length) data.tags = input.tags;
          this.transitions.assertAllowed(data.status ?? 'backlog');
          intent = await this.conversions.prepare(input.projectPath, input.ideaId, data);
        }
        const feature = await this.conversions.createFeature(input.projectPath, intent);
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
      })
    );
  }

  addSuggestion(input: AddSuggestionInput) {
    return this.ideation.runAccepted(() =>
      this.serializer.run(input.projectPath, async () => {
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
      })
    );
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

  async generateSuggestions(input: GenerateSuggestionsInput) {
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
