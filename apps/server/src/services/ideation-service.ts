import { IdeationIdeaRepository, ensureIdeationDirectories } from './ideation/idea-repository.js';
import { IdeationProjectAnalysis } from './ideation/project-analysis.js';
import { IdeationTextStream } from './ideation/text-stream.js';
import { IdeationPromptCatalog } from './ideation/prompt-catalog.js';
import { IdeationProjectContextReader } from './ideation/project-context-reader.js';
import type { AgentCheckpointRepository } from '../providers/openai-compatible/checkpoint.js';
/**
 * Ideation Service - Manages brainstorming sessions and ideas
 * Provides AI-powered ideation, project analysis, and idea-to-feature conversion
 */

import * as secureFs from '../lib/secure-fs.js';
import type { EventEmitter } from '../lib/events.js';
import type { Feature, ExecuteOptions } from '@automaker/types';
import type {
  Idea,
  IdeaCategory,
  IdeationSession,
  IdeationSessionWithMessages,
  IdeationMessage,
  ProjectAnalysisResult,
  AnalysisSuggestion,
  CreateIdeaInput,
  UpdateIdeaInput,
  StartSessionOptions,
  SendMessageOptions,
  PromptCategory,
  IdeationPrompt,
  IdeationContextSources,
} from '@automaker/types';
import { DEFAULT_IDEATION_CONTEXT_SOURCES } from '@automaker/types';
import { getIdeationSessionsDir, getIdeationSessionPath } from '@automaker/platform';
import { createLogger, loadContextFiles, isAbortError } from '@automaker/utils';
import {
  atomicWriteJson,
  DEFAULT_BACKUP_COUNT,
  type AtomicWriteFilesystem,
} from '@automaker/utils';
import { IdeationJobs, isUnconfirmedIdeationCleanup } from '../modules/ideation/ideation-jobs.js';
import type { ProviderRegistry } from '../modules/providers/provider-registry.service.js';
import { captureNativeLocalEnvironment } from './execution-environment/local.js';
import type { SettingsService } from './settings-service.js';
import type { FeatureLoader } from './feature-loader.js';
import { validateWorkingDirectory } from '../lib/sdk-options.js';
import { resolveModelString, resolvePhaseModel } from '@automaker/model-resolver';
import { stripProviderPrefix } from '@automaker/types';
import {
  getPromptCustomization,
  getProviderByModelId,
  getPhaseModelWithOverrides,
} from '../lib/settings-helpers.js';

const logger = createLogger('IdeationService');

interface ActiveSession {
  cleanupUnconfirmed?: boolean;
  task?: Promise<void>;
  session: IdeationSession;
  messages: IdeationMessage[];
  isRunning: boolean;
  abortController: AbortController | null;
}

export class IdeationService {
  private readonly jobs = new IdeationJobs();
  private activeSessions = new Map<string, ActiveSession>();
  private events: EventEmitter;
  private settingsService: SettingsService | null = null;
  private featureLoader: FeatureLoader | null = null;

  private readonly hostEnvironment: Readonly<NodeJS.ProcessEnv>;
  private readonly prompts = new IdeationPromptCatalog();
  private readonly projectContext: IdeationProjectContextReader;
  private readonly ideas: IdeationIdeaRepository;
  private readonly analysis: IdeationProjectAnalysis;
  private readonly textStream: IdeationTextStream;

  constructor(
    events: EventEmitter,
    settingsService: SettingsService | undefined,
    featureLoader: FeatureLoader | undefined,
    private readonly providerRegistry: ProviderRegistry,
    private readonly validateDirectory: (cwd: string) => void = validateWorkingDirectory,
    private readonly filesystem: AtomicWriteFilesystem &
      Pick<typeof secureFs, 'readdir' | 'rm' | 'link' | 'appendFile'> = secureFs,
    hostEnvironment: Readonly<NodeJS.ProcessEnv> = process.env,
    private readonly checkpointRepository?: AgentCheckpointRepository
  ) {
    this.hostEnvironment = captureNativeLocalEnvironment(hostEnvironment);
    this.events = events;
    this.settingsService = settingsService ?? null;
    this.featureLoader = featureLoader ?? null;
    this.ideas = new IdeationIdeaRepository(this.filesystem, this.validateDirectory, (prefix) =>
      this.generateId(prefix)
    );
    this.projectContext = new IdeationProjectContextReader(
      this.filesystem,
      this.featureLoader,
      (project) => this.getIdeas(project),
      (project) => this.getCachedAnalysis(project),
      (prefix) => this.generateId(prefix)
    );
    this.analysis = new IdeationProjectAnalysis(
      this.filesystem,
      this.validateDirectory,
      this.projectContext,
      this.events
    );
    this.textStream = new IdeationTextStream(
      this.providerRegistry,
      this.settingsService,
      this.validateDirectory,
      this.hostEnvironment,
      this.checkpointRepository
    );
  }

  runAccepted<T>(action: () => Promise<T>): Promise<T> {
    return this.jobs.run(action);
  }

  launchMessage(sessionId: string, message: string, options?: SendMessageOptions): void {
    this.jobs.assertOpen();
    void this.sendMessage(sessionId, message, options).catch(() =>
      logger.error('Ideation message failed.')
    );
  }

  launchAnalysis(projectPath: string): void {
    this.jobs.assertOpen();
    void this.analyzeProject(projectPath).catch(() => logger.error('Ideation analysis failed.'));
  }

  onModuleDestroy(): Promise<void> {
    for (const active of this.activeSessions.values()) active.abortController?.abort();
    return this.jobs.close();
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * Start a new ideation session
   */
  async startSession(projectPath: string, options?: StartSessionOptions): Promise<IdeationSession> {
    this.validateDirectory(projectPath);
    await ensureIdeationDirectories(this.filesystem, projectPath);

    const sessionId = this.generateId('session');
    const now = new Date().toISOString();

    const session: IdeationSession = {
      id: sessionId,
      projectPath,
      promptCategory: options?.promptCategory,
      promptId: options?.promptId,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    const activeSession: ActiveSession = {
      session,
      messages: [],
      isRunning: false,
      abortController: null,
    };

    this.activeSessions.set(sessionId, activeSession);
    await this.saveSessionToDisk(projectPath, session, []);

    this.events.emit('ideation:session-started', { sessionId, projectPath });

    // If there's an initial message from a prompt, send it
    if (options?.initialMessage) {
      await this.sendMessage(sessionId, options.initialMessage);
    }

    return session;
  }

  /**
   * Get an existing session
   */
  async getSession(
    projectPath: string,
    sessionId: string
  ): Promise<IdeationSessionWithMessages | null> {
    // Check if session is already active in memory
    let activeSession = this.activeSessions.get(sessionId);

    if (!activeSession) {
      // Try to load from disk
      const loaded = await this.loadSessionFromDisk(projectPath, sessionId);
      if (!loaded) return null;

      activeSession = {
        session: loaded.session,
        messages: loaded.messages,
        isRunning: false,
        abortController: null,
      };
      this.activeSessions.set(sessionId, activeSession);
    }

    return {
      ...activeSession.session,
      messages: activeSession.messages,
    };
  }

  /**
   * Send a message in an ideation session
   */
  sendMessage(sessionId: string, message: string, options?: SendMessageOptions): Promise<void> {
    this.jobs.assertOpen();
    const active = this.activeSessions.get(sessionId);
    if (!active) return Promise.reject(new Error(`Session ${sessionId} not found`));
    if (active.isRunning)
      return Promise.reject(new Error('Session is already processing a message'));
    const controller = new AbortController();
    active.isRunning = true;
    active.abortController = controller;
    const task = this.jobs
      .run(() => this.sendMessageOwned(sessionId, message, options, active, controller), controller)
      .finally(() => {
        if (active.abortController === controller && !active.cleanupUnconfirmed) {
          active.isRunning = false;
          active.abortController = null;
          active.task = undefined;
        }
      });
    active.task = task;
    return task;
  }

  private async sendMessageOwned(
    sessionId: string,
    message: string,
    options: SendMessageOptions | undefined,
    activeSession: ActiveSession,
    controller: AbortController
  ): Promise<void> {
    let persistenceAttempted = false;
    // Add user message
    const userMessage: IdeationMessage = {
      id: this.generateId('msg'),
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };
    activeSession.messages.push(userMessage);

    // Emit user message
    this.events.emit('ideation:stream', {
      sessionId,
      type: 'message',
      message: userMessage,
    });

    try {
      const projectPath = activeSession.session.projectPath;

      // Build conversation history
      const conversationHistory = activeSession.messages.slice(0, -1).map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      // Load context files
      const contextResult = await loadContextFiles({
        projectPath,
        fsModule: this.filesystem as Parameters<typeof loadContextFiles>[0]['fsModule'],
      });

      // Gather existing features and ideas to prevent duplicate suggestions
      const existingWorkContext = await this.gatherExistingWorkContext(projectPath);

      // Get customized prompts from settings
      const prompts = await getPromptCustomization(this.settingsService, '[IdeationService]');

      // Build system prompt for ideation
      const systemPrompt = this.buildIdeationSystemPrompt(
        prompts.ideation.ideationSystemPrompt,
        contextResult.formattedPrompt,
        activeSession.session.promptCategory,
        existingWorkContext
      );

      // Resolve model alias to canonical identifier (with prefix)
      let modelId = resolveModelString(options?.model ?? 'sonnet');

      // Try to find a provider for this model (e.g., GLM, MiniMax models)
      let claudeCompatibleProvider: import('@automaker/types').ClaudeCompatibleProvider | undefined;
      let credentials = await this.settingsService?.getCredentials();

      if (this.settingsService && options?.model) {
        const providerResult = await getProviderByModelId(
          options.model,
          this.settingsService,
          '[IdeationService]'
        );
        if (providerResult.provider) {
          claudeCompatibleProvider = providerResult.provider;
          // CRITICAL: For custom providers, use the provider's model ID (e.g. "GLM-4.7")
          // for the API call, NOT the resolved Claude model - otherwise we get "model not found"
          modelId = options.model;
          credentials = providerResult.credentials ?? credentials;
        }
      }

      const executeOptions = {
        prompt: message,
        model: stripProviderPrefix(modelId),
        originalModel: modelId,
        cwd: projectPath,
        systemPrompt,
        maxTurns: 1, // Single turn for ideation
        abortController: controller,
        conversationHistory: conversationHistory.length > 0 ? conversationHistory : undefined,
        claudeCompatibleProvider, // Pass provider for alternative endpoint configuration
        credentials, // Pass credentials for resolving 'credentials' apiKeySource
      } satisfies ExecuteOptions;

      const assistantMessage: IdeationMessage = {
        id: this.generateId('msg'),
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
      };
      const responseText = await this.textStream.run(
        executeOptions,
        options?.providerId,
        (content) => {
          assistantMessage.content = content;
          this.events.emit('ideation:stream', { sessionId, type: 'stream', content, done: false });
        }
      );
      assistantMessage.content = responseText;

      controller.signal.throwIfAborted();
      activeSession.messages.push(assistantMessage);
      persistenceAttempted = true;
      await this.saveSessionToDisk(projectPath, activeSession.session, activeSession.messages);

      this.events.emit('ideation:stream', {
        sessionId,
        type: 'message-complete',
        message: assistantMessage,
        content: responseText,
        done: true,
      });
    } catch (error) {
      if (isAbortError(error)) {
        this.events.emit('ideation:stream', {
          sessionId,
          type: 'aborted',
        });
      } else {
        logger.error('Error in ideation message:', error);
        this.events.emit('ideation:stream', {
          sessionId,
          type: 'error',
          error: (error as Error).message,
        });
        if (isUnconfirmedIdeationCleanup(error)) {
          activeSession.cleanupUnconfirmed = true;
          throw error;
        }
      }
    } finally {
      if (!persistenceAttempted)
        await this.saveSessionToDisk(
          activeSession.session.projectPath,
          activeSession.session,
          activeSession.messages
        );
    }
  }

  /**
   * Stop an active session
   */
  async stopSession(sessionId: string): Promise<void> {
    const activeSession = this.activeSessions.get(sessionId);
    if (!activeSession) return;

    if (activeSession.abortController) {
      activeSession.abortController.abort();
    }

    await this.jobs.wait(activeSession.task);
    activeSession.session.status = 'completed';

    await this.saveSessionToDisk(
      activeSession.session.projectPath,
      activeSession.session,
      activeSession.messages
    );

    this.events.emit('ideation:session-ended', { sessionId });
  }

  // ============================================================================
  // Ideas CRUD
  // ============================================================================

  /**
   * Create a new idea
   */
  createIdea(projectPath: string, input: CreateIdeaInput): Promise<Idea> {
    return this.ideas.createIdea(projectPath, input);
  }
  getIdeas(projectPath: string): Promise<Idea[]> {
    return this.ideas.getIdeas(projectPath);
  }
  getIdea(projectPath: string, ideaId: string): Promise<Idea | null> {
    return this.ideas.getIdea(projectPath, ideaId);
  }
  updateIdea(projectPath: string, ideaId: string, updates: UpdateIdeaInput): Promise<Idea | null> {
    return this.ideas.updateIdea(projectPath, ideaId, updates);
  }
  deleteIdea(projectPath: string, ideaId: string): Promise<void> {
    return this.ideas.deleteIdea(projectPath, ideaId);
  }
  archiveIdea(projectPath: string, ideaId: string): Promise<Idea | null> {
    return this.ideas.archiveIdea(projectPath, ideaId);
  }

  // ============================================================================
  // Project Analysis
  // ============================================================================

  /**
   * Analyze project structure and generate suggestions
   */
  analyzeProject(projectPath: string): Promise<ProjectAnalysisResult> {
    return this.jobs.run((controller) => this.analysis.analyze(projectPath, controller));
  }

  /**
   * Check if a session is currently running (processing a message)
   */
  isSessionRunning(sessionId: string): boolean {
    const activeSession = this.activeSessions.get(sessionId);
    return activeSession?.isRunning ?? false;
  }

  /**
   * Get cached analysis result
   */
  getCachedAnalysis(projectPath: string): Promise<ProjectAnalysisResult | null> {
    return this.analysis.getCached(projectPath);
  }

  // ============================================================================
  // Convert to Feature
  // ============================================================================

  /**
   * Convert an idea to a feature
   */
  async convertToFeature(projectPath: string, ideaId: string): Promise<Feature> {
    const idea = await this.getIdea(projectPath, ideaId);
    if (!idea) {
      throw new Error(`Idea ${ideaId} not found`);
    }

    // Build feature description from idea
    let description = idea.description;
    if (idea.userStories && idea.userStories.length > 0) {
      description += '\n\n## User Stories\n' + idea.userStories.map((s) => `- ${s}`).join('\n');
    }
    if (idea.notes) {
      description += '\n\n## Notes\n' + idea.notes;
    }

    const feature: Feature = {
      id: this.generateId('feature'),
      title: idea.title,
      category: this.mapIdeaCategoryToFeatureCategory(idea.category),
      description,
      status: 'backlog',
    };

    return feature;
  }

  // ============================================================================
  // Generate Suggestions
  // ============================================================================

  /**
   * Generate structured suggestions for a prompt
   * Returns parsed suggestions that can be directly added to the board
   */
  generateSuggestions(
    projectPath: string,
    promptId: string,
    category: IdeaCategory,
    count = 10,
    contextSources?: IdeationContextSources
  ): Promise<AnalysisSuggestion[]> {
    return this.jobs.run((controller) =>
      this.generateSuggestionsOwned(
        projectPath,
        promptId,
        category,
        count,
        contextSources,
        controller
      )
    );
  }

  private async generateSuggestionsOwned(
    projectPath: string,
    promptId: string,
    category: IdeaCategory,
    count: number = 10,
    contextSources: IdeationContextSources | undefined,
    controller: AbortController
  ): Promise<AnalysisSuggestion[]> {
    const suggestionCount = Math.min(Math.max(Math.floor(count ?? 10), 1), 20);
    // Merge with defaults for backward compatibility
    const sources = { ...DEFAULT_IDEATION_CONTEXT_SOURCES, ...contextSources };
    this.validateDirectory(projectPath);

    // Get the prompt
    const prompt = this.getAllPrompts().find((p) => p.id === promptId);
    if (!prompt) {
      throw new Error(`Prompt ${promptId} not found`);
    }

    // Emit start event
    this.events.emit('ideation:suggestions', {
      type: 'started',
      promptId,
      category,
    });

    try {
      // Load context files (respecting toggle settings)
      const contextResult = await loadContextFiles({
        projectPath,
        fsModule: this.filesystem as Parameters<typeof loadContextFiles>[0]['fsModule'],
        includeContextFiles: sources.useContextFiles,
        includeMemory: sources.useMemoryFiles,
      });

      // Build context from multiple sources
      let contextPrompt = contextResult.formattedPrompt;

      // Add app spec context if enabled
      if (sources.useAppSpec) {
        const appSpecContext = await this.buildAppSpecContext(projectPath);
        if (appSpecContext) {
          contextPrompt = contextPrompt ? `${contextPrompt}\n\n${appSpecContext}` : appSpecContext;
        }
      }

      // If no context was found, try to gather basic project info
      if (!contextPrompt) {
        const projectInfo = await this.gatherBasicProjectInfo(projectPath);
        if (projectInfo) {
          contextPrompt = projectInfo;
        }
      }

      // Gather existing features and ideas to prevent duplicates (respecting toggle settings)
      const existingWorkContext = await this.gatherExistingWorkContext(projectPath, {
        includeFeatures: sources.useExistingFeatures,
        includeIdeas: sources.useExistingIdeas,
      });

      // Get customized prompts from settings
      const prompts = await getPromptCustomization(this.settingsService, '[IdeationService]');

      // Build system prompt for structured suggestions
      const systemPrompt = this.buildSuggestionsSystemPrompt(
        prompts.ideation.suggestionsSystemPrompt,
        contextPrompt,
        category,
        suggestionCount,
        existingWorkContext
      );

      // Get model from phase settings with provider info (ideationModel)
      const phaseResult = await getPhaseModelWithOverrides(
        'ideationModel',
        this.settingsService,
        projectPath,
        '[IdeationService]'
      );
      const resolved = resolvePhaseModel(phaseResult.phaseModel);
      // resolvePhaseModel already resolves model aliases internally - no need to call resolveModelString again
      const modelId = resolved.model;
      const claudeCompatibleProvider = phaseResult.provider;
      const credentials = phaseResult.credentials;

      logger.info(
        'generateSuggestions using model:',
        modelId,
        claudeCompatibleProvider ? `via provider: ${claudeCompatibleProvider.name}` : 'direct API'
      );

      const executeOptions = {
        prompt: prompt.prompt,
        model: stripProviderPrefix(modelId),
        originalModel: modelId,
        cwd: projectPath,
        systemPrompt,
        maxTurns: 1,
        // Disable all tools - we just want text generation, not codebase analysis
        allowedTools: [],
        abortController: controller,
        readOnly: true, // Suggestions only need to return JSON, never write files
        claudeCompatibleProvider, // Pass provider for alternative endpoint configuration
        credentials, // Pass credentials for resolving 'credentials' apiKeySource
      } satisfies ExecuteOptions;

      const responseText = await this.textStream.run(
        executeOptions,
        phaseResult.phaseModel.providerId
      );

      // Parse the response into structured suggestions
      const suggestions = this.parseSuggestionsFromResponse(
        responseText,
        category,
        suggestionCount
      );

      // Emit complete event
      this.events.emit('ideation:suggestions', {
        type: 'complete',
        promptId,
        category,
        suggestions,
      });

      return suggestions;
    } catch (error) {
      logger.error('Failed to generate suggestions:', error);
      this.events.emit('ideation:suggestions', {
        type: 'error',
        promptId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Build system prompt for structured suggestion generation
   * @param basePrompt - The base system prompt from settings
   * @param contextFilesPrompt - Project context from loaded files
   * @param category - The idea category to focus on
   * @param count - Number of suggestions to generate
   * @param existingWorkContext - Context about existing features/ideas
   */
  private buildSuggestionsSystemPrompt(
    basePrompt: string,
    contextFilesPrompt: string | undefined,
    category: IdeaCategory,
    count: number = 10,
    existingWorkContext?: string
  ): string {
    const contextSection = contextFilesPrompt
      ? `## Project Context\n${contextFilesPrompt}`
      : `## No Project Context Available\nNo context files were found. Generate suggestions based on the user's prompt and general best practices for the type of application being described.`;

    const existingWorkSection = existingWorkContext ? `\n\n${existingWorkContext}` : '';

    // Replace placeholder {{count}} if present, otherwise append count instruction
    let prompt = basePrompt;
    if (prompt.includes('{{count}}')) {
      prompt = prompt.replace(/\{\{count\}\}/g, String(count));
    } else {
      prompt += `\n\nGenerate exactly ${count} suggestions.`;
    }

    return `${prompt}

Focus area: ${this.prompts.getCategoryDescription(category)}

${contextSection}${existingWorkSection}`;
  }

  /**
   * Parse AI response into structured suggestions
   */
  private parseSuggestionsFromResponse(
    response: string,
    category: IdeaCategory,
    count: number
  ): AnalysisSuggestion[] {
    try {
      // Try to extract JSON from the response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        logger.warn('No JSON array found in response, falling back to text parsing');
        return this.parseTextResponse(response, category, count);
      }

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) {
        return this.parseTextResponse(response, category, count);
      }

      return parsed
        .map(
          (
            item: {
              title?: string;
              description?: string;
              rationale?: string;
              priority?: 'low' | 'medium' | 'high';
              relatedFiles?: string[];
            },
            index: number
          ) => ({
            id: this.generateId('sug'),
            category,
            title: item.title || `Suggestion ${index + 1}`,
            description: item.description || '',
            rationale: item.rationale || '',
            priority: item.priority || ('medium' as const),
            relatedFiles: item.relatedFiles || [],
          })
        )
        .slice(0, count);
    } catch (error) {
      logger.warn('Failed to parse JSON response:', error);
      return this.parseTextResponse(response, category, count);
    }
  }

  /**
   * Fallback: parse text response into suggestions
   */
  private parseTextResponse(
    response: string,
    category: IdeaCategory,
    count: number
  ): AnalysisSuggestion[] {
    const suggestions: AnalysisSuggestion[] = [];

    // Try to find numbered items or headers
    const lines = response.split('\n');
    let currentSuggestion: Partial<AnalysisSuggestion> | null = null;
    let currentContent: string[] = [];

    for (const line of lines) {
      // Check for numbered items or markdown headers
      const titleMatch = line.match(/^(?:\d+[.)]\s*\*{0,2}|#{1,3}\s+)(.+)/);

      if (titleMatch) {
        // Save previous suggestion
        if (currentSuggestion && currentSuggestion.title) {
          suggestions.push({
            id: this.generateId('sug'),
            category,
            title: currentSuggestion.title,
            description: currentContent.join(' ').trim() || currentSuggestion.title,
            rationale: '',
            priority: 'medium',
            ...currentSuggestion,
          } as AnalysisSuggestion);
        }

        // Start new suggestion
        currentSuggestion = {
          title: titleMatch[1].replace(/\*{1,2}/g, '').trim(),
        };
        currentContent = [];
      } else if (currentSuggestion && line.trim()) {
        currentContent.push(line.trim());
      }
    }

    // Don't forget the last suggestion
    if (currentSuggestion && currentSuggestion.title) {
      suggestions.push({
        id: this.generateId('sug'),
        category,
        title: currentSuggestion.title,
        description: currentContent.join(' ').trim() || currentSuggestion.title,
        rationale: '',
        priority: 'medium',
      } as AnalysisSuggestion);
    }

    // If no suggestions found, create one from the whole response
    if (suggestions.length === 0 && response.trim()) {
      suggestions.push({
        id: this.generateId('sug'),
        category,
        title: 'AI Suggestion',
        description: response.slice(0, 500),
        rationale: '',
        priority: 'medium',
      });
    }

    return suggestions.slice(0, count);
  }

  // ============================================================================
  // Guided Prompts
  // ============================================================================

  /**
   * Get all prompt categories
   */
  getPromptCategories(): PromptCategory[] {
    return this.prompts.getPromptCategories();
  }

  /**
   * Get prompts for a specific category
   */
  getPromptsByCategory(category: IdeaCategory): IdeationPrompt[] {
    return this.prompts.getPromptsByCategory(category);
  }

  /**
   * Get all guided prompts
   * This is the single source of truth for guided prompts data.
   * Frontend fetches this data via /api/ideation/prompts endpoint.
   */
  getAllPrompts(): IdeationPrompt[] {
    return this.prompts.getAllPrompts();
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private buildIdeationSystemPrompt(
    basePrompt: string,
    contextFilesPrompt: string | undefined,
    category?: IdeaCategory,
    existingWorkContext?: string
  ): string {
    return this.prompts.buildIdeationSystemPrompt(
      basePrompt,
      contextFilesPrompt,
      category,
      existingWorkContext
    );
  }

  /**
   * Build context from app_spec.txt for suggestion generation
   * Extracts project name, overview, capabilities, and implemented features
   */
  private async buildAppSpecContext(projectPath: string): Promise<string> {
    return this.projectContext.buildAppSpecContext(projectPath);
  }

  /**
   * Gather basic project information for context when no context files exist
   */
  private async gatherBasicProjectInfo(projectPath: string): Promise<string | null> {
    return this.projectContext.gatherBasicProjectInfo(projectPath);
  }

  /**
   * Gather existing features and ideas to prevent duplicate suggestions
   * Returns a concise list of titles grouped by status to avoid polluting context
   */
  private async gatherExistingWorkContext(
    projectPath: string,
    options?: { includeFeatures?: boolean; includeIdeas?: boolean }
  ): Promise<string> {
    return this.projectContext.gatherExistingWorkContext(projectPath, options);
  }

  /**
   * Map idea category to feature category
   * Used internally for idea-to-feature conversion
   */
  private mapIdeaCategoryToFeatureCategory(category: IdeaCategory): string {
    return this.mapSuggestionCategoryToFeatureCategory(category);
  }

  /**
   * Map suggestion/idea category to feature category
   * This is the single source of truth for category mapping.
   * Used by both idea-to-feature conversion and suggestion-to-feature conversion.
   */
  mapSuggestionCategoryToFeatureCategory(category: IdeaCategory): string {
    const mapping: Record<IdeaCategory, string> = {
      feature: 'ui',
      'ux-ui': 'enhancement',
      dx: 'chore',
      growth: 'feature',
      technical: 'refactor',
      security: 'bug',
      performance: 'enhancement',
      accessibility: 'enhancement',
      analytics: 'feature',
    };
    return mapping[category] || 'feature';
  }

  private async saveSessionToDisk(
    projectPath: string,
    session: IdeationSession,
    messages: IdeationMessage[]
  ): Promise<void> {
    await this.filesystem.mkdir(getIdeationSessionsDir(projectPath), { recursive: true });
    const data = { session, messages };
    await atomicWriteJson(getIdeationSessionPath(projectPath, session.id), data, {
      backupCount: DEFAULT_BACKUP_COUNT,
      filesystem: this.filesystem,
    });
  }

  private async loadSessionFromDisk(
    projectPath: string,
    sessionId: string
  ): Promise<{ session: IdeationSession; messages: IdeationMessage[] } | null> {
    try {
      const content = (await this.filesystem.readFile(
        getIdeationSessionPath(projectPath, sessionId),
        'utf-8'
      )) as string;
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }
}
