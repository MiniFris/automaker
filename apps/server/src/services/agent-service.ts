/**
 * Agent Service - Runs AI agents via provider architecture
 * Manages conversation sessions and streams responses via WebSocket
 */

import path from 'path';
import { isAbortError, createLogger } from '@automaker/utils';
import { AgentSessionRepository } from './agent/agent-session.repository.js';
import { AgentSessionRegistry } from './agent/agent-session-registry.js';
import { AgentSessionStorageError } from './agent/agent-session-storage.error.js';
import { AgentExecutionCoordinator } from './agent/agent-execution-coordinator.js';
import { AgentPromptBuilder } from './agent/agent-prompt-builder.js';
import { AgentEnvironmentPreparer } from './agent/agent-environment-preparer.js';
import { AgentProviderSelector } from './agent/agent-provider-selector.js';
import { AgentQueryOptionsBuilder } from './agent/agent-query-options-builder.js';
import {
  AgentStreamNormalizer,
  normalizeAgentProviderError,
} from './agent/agent-stream-normalizer.js';
import { AgentEventPublisher } from './agent/agent-event-publisher.js';
import { AgentSessionLoader } from './agent/agent-session-loader.js';
import { AgentConversationCoordinator } from './agent/agent-conversation-coordinator.js';
import { AgentPromptQueue, type AgentQueuedInput } from './agent/agent-prompt-queue.js';
import { AgentSessionDeletion } from './agent/agent-session-deletion.js';
import { AgentExecutionStore, type AgentExecutionRecord } from './agent/agent-execution-store.js';
import type {
  ActiveSession as Session,
  Message,
  SessionMetadata,
  AgentMessageInput,
} from './agent/agent-session.types.js';
import { validateWorkingDirectory } from '../lib/sdk-options.js';
import type { SettingsService } from './settings-service.js';
import { ProviderCleanupError } from '../providers/provider-execution-scope.js';

export class AgentService {
  private reportedErrors = new WeakSet<object>();
  private events: AgentEventPublisher;
  private settingsService: SettingsService | null = null;
  private logger = createLogger('AgentService');

  constructor(
    private readonly repository: AgentSessionRepository,
    private readonly sessions: AgentSessionRegistry,
    private readonly executions: AgentExecutionCoordinator,
    private readonly prompts: AgentPromptBuilder,
    private readonly environments: AgentEnvironmentPreparer,
    private readonly streams: AgentStreamNormalizer,
    private readonly loader: AgentSessionLoader,
    private readonly conversations: AgentConversationCoordinator,
    private readonly queue: AgentPromptQueue,
    private readonly deletion: AgentSessionDeletion,
    private readonly runs: AgentExecutionStore,
    events: AgentEventPublisher,
    settingsService: SettingsService | undefined,
    private readonly providers: AgentProviderSelector,
    private readonly queries: AgentQueryOptionsBuilder,
    private readonly validateDirectory: (cwd: string) => void = validateWorkingDirectory
  ) {
    this.events = events;
    this.settingsService = settingsService ?? null;
  }

  async initialize(): Promise<void> {
    await this.repository.initialize();
  }

  /**
   * Start or resume a conversation
   */
  async startConversation({
    sessionId,
    workingDirectory,
  }: {
    sessionId: string;
    workingDirectory?: string;
  }) {
    this.executions.assertSessionOpen(sessionId);
    // ensureSession handles loading from disk if not in memory.
    // For startConversation, we always want to create a session even if
    // metadata doesn't exist yet (new session), so we fall back to creating one.
    let session = await this.ensureSession(sessionId, workingDirectory);
    await this.repository.assertAvailable(sessionId);
    this.executions.assertSessionOpen(sessionId);
    if (!session) {
      // Session doesn't exist on disk either — create a fresh in-memory session.
      const effectiveWorkingDirectory = workingDirectory || this.loader.workingDirectory;
      const resolvedWorkingDirectory = path.resolve(effectiveWorkingDirectory);
      this.validateDirectory(resolvedWorkingDirectory);

      session = this.sessions.getOrCreate(sessionId, () => ({
        messages: [],
        isRunning: false,
        abortController: null,
        workingDirectory: resolvedWorkingDirectory,
        projectPath: resolvedWorkingDirectory,
        promptQueue: [],
      }));
    }

    return {
      success: true,
      messages: session.messages,
      sessionId,
    };
  }

  private ensureSession(sessionId: string, workingDirectory?: string): Promise<Session | null> {
    return this.loader.ensure(sessionId, workingDirectory);
  }

  /**
   * Send a message to the agent and stream responses
   */
  sendMessage(input: AgentMessageInput) {
    return this.conversations.run(
      input.sessionId,
      async () => input,
      (selected, controller) => this.executeMessage(selected, controller)
    );
  }

  private async executeMessage(
    {
      sessionId,
      message,
      workingDirectory,
      imagePaths,
      model,
      providerId,
      thinkingLevel,
      reasoningEffort,
    }: AgentMessageInput,
    controller: AbortController,
    deliveryId?: string,
    queuedPromptId?: string
  ) {
    const session = await this.ensureSession(sessionId, workingDirectory);
    controller.signal.throwIfAborted();
    if (!session) {
      this.logger.error(
        `Session not found: ${sessionId}. ` +
          `The session may have been deleted, never created, or lost after a server restart. ` +
          `In-memory sessions: ${this.sessions.size}, requested ID: ${sessionId}`
      );
      throw new Error(
        `Session ${sessionId} not found. ` +
          `The session may have been deleted or expired. ` +
          `Please create a new session and try again.`
      );
    }

    if (session.isRunning) {
      this.logger.error('ERROR: Agent already running for session:', sessionId);
      throw new Error('Agent is already processing a message');
    }
    session.isRunning = true;
    session.abortController = controller;

    // Update session model, thinking level, and reasoning effort if provided
    if (model) {
      const changed = model !== session.model;
      const nextProviderId =
        providerId !== undefined ? providerId : changed ? undefined : session.providerId;
      const nextSdkSessionId = changed ? undefined : session.sdkSessionId;
      await this.updateSession(sessionId, {
        model,
        providerId: nextProviderId,
        sdkSessionId: nextSdkSessionId,
      });
      if (changed) {
        session.thinkingLevel = undefined;
        session.reasoningEffort = undefined;
        session.sdkSessionId = undefined;
      }
      session.model = model;
      session.providerId = nextProviderId;
    } else if (providerId !== undefined) {
      await this.updateSession(sessionId, { providerId });
      session.providerId = providerId;
    }
    if (thinkingLevel !== undefined) {
      session.thinkingLevel = thinkingLevel;
    }
    if (reasoningEffort !== undefined) {
      session.reasoningEffort = reasoningEffort;
    }

    // Validate vision support before processing images
    const effectiveModel = model || session.model;
    if (imagePaths && imagePaths.length > 0 && effectiveModel) {
      const supportsVision = this.providers.supportsVision(effectiveModel);
      if (!supportsVision) {
        throw new Error(
          `This model (${effectiveModel}) does not support image input. ` +
            `Please switch to a model that supports vision, or remove the images and try again.`
        );
      }
    }

    // Read images and convert to base64
    const images = await this.prompts.readImages(imagePaths, controller.signal);

    // Add user message
    controller.signal.throwIfAborted();
    const userMessage: Message = {
      id: this.generateId(),
      role: 'user',
      content: message,
      images: images.length > 0 ? images : undefined,
      timestamp: new Date().toISOString(),
      ...(deliveryId && { deliveryId }),
      ...(queuedPromptId && { queuedPromptId }),
    };

    session.messages.push(userMessage);

    let userMessageStored = false;
    let run: AgentExecutionRecord | undefined;
    try {
      run = await this.runs.begin(sessionId, userMessage);
      userMessage.runId = run.runId;
      this.emitAgentEvent(sessionId, { type: 'started' });
      this.emitAgentEvent(sessionId, { type: 'message', message: userMessage });
      await this.repository.saveMessages(sessionId, session.messages);
      userMessageStored = true;
      await this.updateSessionTimestamp(sessionId);
      // Determine the effective working directory for context loading
      const effectiveWorkDir = workingDirectory || session.workingDirectory;

      const requestedModel = model || session.model;
      const configuration = await this.queries.configuration({
        workingDirectory: effectiveWorkDir,
        settings: this.settingsService,
        requestedModel,
        providerId: session.providerId,
        signal: controller.signal,
      });

      const remoteContext = await this.environments.usesManagedContext(
        this.settingsService,
        session.projectPath ?? effectiveWorkDir,
        `chat:${sessionId}`,
        controller.signal
      );
      const combinedSystemPrompt = await this.prompts.systemPrompt({
        workingDirectory: effectiveWorkDir,
        message,
        autoLoadClaudeMd: configuration.autoLoadClaudeMd,
        requestedModel,
        remoteContext: Boolean(remoteContext),
        settings: this.settingsService,
        signal: controller.signal,
      });

      const { options, effectiveModel, routingModel } = this.queries.build({
        configuration,
        workingDirectory: effectiveWorkDir,
        model,
        session,
        systemPrompt: combinedSystemPrompt,
        abortController: controller,
        thinkingLevel,
        reasoningEffort,
        conversationHistory: this.prompts.history(session.messages),
      });

      // Build prompt content with images
      options.prompt = await this.prompts.content(message, imagePaths, controller.signal);

      // Execute via provider
      const execution = await this.environments.prepare({
        options,
        settings: this.settingsService,
        selection: {
          model: requestedModel ?? effectiveModel,
          providerId: session.providerId,
          projectPath: session.projectPath ?? effectiveWorkDir,
          runKey: `chat:${sessionId}`,
        },
        managedContext: remoteContext,
        onBinding: (binding) => this.updateSession(sessionId, { executionEnvironment: binding }),
      });
      const prepared = execution.options;
      const provider = this.providers.forQuery(routingModel, prepared.executionEnvironmentBinding);
      controller.signal.throwIfAborted();
      const stream = provider.executeQuery(prepared);

      const normalized = this.streams.create((content) => ({
        id: this.generateId(),
        role: 'assistant',
        content,
        timestamp: new Date().toISOString(),
      }));

      for await (const msg of stream) {
        controller.signal.throwIfAborted();
        // Capture SDK session ID from any message and persist it.
        // Update when:
        //  - No session ID set yet (first message in a new session)
        //  - The provider returned a *different* session ID (e.g., after a
        //    "Session not found" recovery where the provider started a fresh
        //    session — the stale ID must be replaced with the new one)
        if (msg.session_id && msg.session_id !== session.sdkSessionId) {
          // Persist the SDK session ID to ensure conversation continuity across server restarts
          await this.updateSession(sessionId, { sdkSessionId: msg.session_id });
          session.sdkSessionId = msg.session_id;
          controller.signal.throwIfAborted();
        }

        const update = normalized.consume(msg);
        if (update.newMessage) session.messages.push(update.newMessage);
        for (const event of update.events) {
          controller.signal.throwIfAborted();
          this.emitAgentEvent(sessionId, event);
        }
        if (update.error) {
          const { text: enhancedText, classification: errorInfo, staleSession } = update.error;
          if (session.sdkSessionId && staleSession) {
            this.logger.info(
              `Clearing stale sdkSessionId for session ${sessionId} after provider session error`
            );
            await this.clearSdkSessionId(sessionId);
            session.sdkSessionId = undefined;
            controller.signal.throwIfAborted();
          }

          this.logger.error('Provider error during agent execution:', {
            type: errorInfo.type,
            message: errorInfo.message,
          });

          // A persisted terminal delivery must not precede generator cleanup.
          await stream.return(undefined);
          controller.signal.throwIfAborted();

          // Mark session as no longer running so the UI and queue stay in sync
          session.isRunning = false;
          session.abortController = null;

          const errorMessage: Message = {
            id: this.generateId(),
            role: 'assistant',
            content: `Error: ${enhancedText}`,
            timestamp: new Date().toISOString(),
            isError: true,
          };

          session.messages.push(errorMessage);
          if (deliveryId) userMessage.deliveryStatus = 'failed';
          userMessage.executionStatus = 'failed';
          await this.runs.complete(run, session.messages, 'failed', session.sdkSessionId);
          controller.signal.throwIfAborted();

          this.emitAgentEvent(sessionId, {
            type: 'error',
            error: enhancedText,
            message: errorMessage,
          });

          // Don't continue streaming after an error message
          return {
            success: false,
          };
        }
      }

      try {
        await execution.recordMemoryUsage(normalized.responseText, normalized.modelSucceeded);
      } catch (error) {
        this.logger.warn(
          'Chat target memory statistics were not saved (no replay/fallback):',
          error
        );
      }
      controller.signal.throwIfAborted();
      if (deliveryId) userMessage.deliveryStatus = 'completed';
      userMessage.executionStatus = 'completed';
      await this.runs.complete(run, session.messages, 'completed', session.sdkSessionId);
      controller.signal.throwIfAborted();

      session.isRunning = false;
      session.abortController = null;
      if (normalized.completion) this.emitAgentEvent(sessionId, normalized.completion);

      // Process next item in queue after completion
      if (!deliveryId)
        setImmediate(
          () =>
            void this.queue.process(sessionId, (input, controller, queuedDeliveryId, promptId) =>
              this.executeMessage(input, controller, queuedDeliveryId, promptId)
            )
        );

      return {
        success: true,
        message: normalized.message,
      };
    } catch (error) {
      if (error instanceof AgentSessionStorageError || error instanceof ProviderCleanupError) {
        if (!userMessageStored) {
          session.messages = session.messages.filter((message) => message.id !== userMessage.id);
          if (run) {
            try {
              await this.runs.abandon(run);
            } catch {
              this.logger.warn('Unstarted execution journal remains pending recovery.');
            }
          }
        }
        session.isRunning = false;
        session.abortController?.abort();
        session.abortController = null;
        this.emitAgentEvent(sessionId, {
          type: 'error',
          error: error.message,
          errorType: error instanceof ProviderCleanupError ? 'execution_cleanup' : 'persistence',
        });
        this.reportedErrors.add(error);
        throw error;
      }
      if (controller.signal.aborted || isAbortError(error)) {
        if (deliveryId) userMessage.deliveryStatus = 'cancelled';
        userMessage.executionStatus = 'cancelled';
        if (run) await this.runs.complete(run, session.messages, 'cancelled', session.sdkSessionId);
        session.isRunning = false;
        session.abortController = null;
        return { success: false, aborted: true };
      }

      this.logger.error('Error:', error);

      const normalizedError = normalizeAgentProviderError(error);

      // Check if the thrown error is a provider-side session error.
      // Clear the stale sdkSessionId so the next retry starts fresh.
      if (session.sdkSessionId && normalizedError.staleSession) {
        this.logger.info(
          `Clearing stale sdkSessionId for session ${sessionId} after thrown session error`
        );
        await this.clearSdkSessionId(sessionId);
        session.sdkSessionId = undefined;
        controller.signal.throwIfAborted();
      }

      session.isRunning = false;
      session.abortController = null;

      const cleanErrorMsg = normalizedError.text;
      const errorMessage: Message = {
        id: this.generateId(),
        role: 'assistant',
        content: `Error: ${cleanErrorMsg}`,
        timestamp: new Date().toISOString(),
        isError: true,
      };

      session.messages.push(errorMessage);
      if (deliveryId) userMessage.deliveryStatus = 'failed';
      userMessage.executionStatus = 'failed';
      if (run) await this.runs.complete(run, session.messages, 'failed', session.sdkSessionId);
      controller.signal.throwIfAborted();

      this.emitAgentEvent(sessionId, {
        type: 'error',
        error: cleanErrorMsg,
        message: errorMessage,
      });

      if (error && typeof error === 'object') this.reportedErrors.add(error);
      throw error;
    } finally {
      if (run) this.runs.release(run);
    }
  }

  /**
   * Get conversation history
   */
  async getHistory(sessionId: string) {
    const session = await this.ensureSession(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    return {
      success: true,
      messages: session.messages,
      isRunning: session.isRunning,
    };
  }

  async stopExecution(sessionId: string) {
    return this.conversations.stop(sessionId);
  }
  async interruptActiveSessions(reason: string): Promise<number> {
    return this.conversations.interrupt(reason);
  }
  async clearSession(sessionId: string) {
    return this.conversations.clear(sessionId);
  }

  // Session management

  async loadSession(sessionId: string): Promise<Message[]> {
    return this.repository.loadMessages(sessionId);
  }

  async saveSession(sessionId: string, messages: Message[]): Promise<void> {
    await this.repository.saveMessages(sessionId, messages);
    await this.updateSessionTimestamp(sessionId);
  }

  async loadMetadata(): Promise<Record<string, SessionMetadata>> {
    return this.repository.loadMetadata();
  }

  async saveMetadata(metadata: Record<string, SessionMetadata>): Promise<void> {
    await this.repository.saveMetadata(metadata);
  }

  async updateSessionTimestamp(sessionId: string): Promise<void> {
    await this.repository.touchMetadata(sessionId);
  }

  async listSessions(includeArchived = false): Promise<SessionMetadata[]> {
    const metadata = await this.loadMetadata();
    let sessions = Object.values(metadata);

    if (!includeArchived) {
      sessions = sessions.filter((s) => !s.archived);
    }

    return sessions.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  async createSession(
    name: string,
    projectPath?: string,
    workingDirectory?: string,
    model?: string,
    providerId?: string
  ): Promise<SessionMetadata> {
    this.executions.assertAccepting();
    const sessionId = this.generateId();
    // Determine the effective working directory
    const effectiveWorkingDirectory =
      workingDirectory || projectPath || this.loader.workingDirectory;
    const resolvedWorkingDirectory = path.resolve(effectiveWorkingDirectory);

    // Validate that the working directory is allowed using centralized validation
    this.validateDirectory(resolvedWorkingDirectory);

    // Validate that projectPath is allowed if provided
    if (projectPath) {
      this.validateDirectory(projectPath);
    }

    const session: SessionMetadata = {
      id: sessionId,
      name,
      projectPath,
      workingDirectory: resolvedWorkingDirectory,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model,
      providerId,
    };

    await this.repository.addMetadata(session);

    return session;
  }

  async setSessionModel(sessionId: string, model: string, providerId?: string): Promise<boolean> {
    return this.executions.mutate(
      sessionId,
      async () => {
        const session = await this.ensureSession(sessionId);
        if (session) {
          await this.updateSession(sessionId, { model, providerId, sdkSessionId: undefined });
          session.model = model;
          session.providerId = providerId;
          session.sdkSessionId = undefined;
          session.thinkingLevel = undefined;
          session.reasoningEffort = undefined;
          return true;
        }
        return false;
      },
      false
    );
  }

  async updateSession(
    sessionId: string,
    updates: Partial<SessionMetadata>
  ): Promise<SessionMetadata | null> {
    // Persisted deletion is still "not found" for metadata HTTP mutations.
    // The repository independently fences a write racing with a new deletion.
    if (await this.repository.deletionState(sessionId)) return null;
    return this.repository.updateMetadata(sessionId, updates);
  }

  async updateSessionDetails(
    sessionId: string,
    updates: Partial<SessionMetadata>
  ): Promise<SessionMetadata | null> {
    this.executions.assertSessionOpen(sessionId);
    if (updates.model === undefined) return this.updateSession(sessionId, updates);
    return this.executions.mutate(
      sessionId,
      async () => {
        // Settle the old model's pending terminal intent before clearing its SDK ID.
        // Otherwise later hydration could restore that ID onto the new model.
        await this.ensureSession(sessionId);
        const current = (await this.loadMetadata())[sessionId];
        if (!current) return null;
        const result = await this.updateSession(sessionId, {
          ...updates,
          sdkSessionId: undefined,
          providerId: updates.model === current.model ? current.providerId : undefined,
        });
        const active = this.sessions.get(sessionId);
        if (active && result) {
          active.model = result.model;
          active.providerId = result.providerId;
          active.sdkSessionId = undefined;
          active.thinkingLevel = undefined;
          active.reasoningEffort = undefined;
        }
        return result;
      },
      false
    );
  }

  async archiveSession(sessionId: string): Promise<boolean> {
    this.executions.assertSessionOpen(sessionId);
    const result = await this.updateSession(sessionId, { archived: true });
    return result !== null;
  }

  async unarchiveSession(sessionId: string): Promise<boolean> {
    this.executions.assertSessionOpen(sessionId);
    const result = await this.updateSession(sessionId, { archived: false });
    return result !== null;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    return this.deletion.remove(sessionId);
  }

  /**
   * Clear the sdkSessionId from persisted metadata.
   *
   * This removes the provider-side session ID so that the next message
   * starts a fresh provider session instead of trying to resume a stale one.
   * Prevents "Session not found" errors from CLI providers like OpenCode
   * when the provider-side session has been deleted or expired.
   */
  async clearSdkSessionId(sessionId: string): Promise<void> {
    await this.repository.clearSdkSessionId(sessionId);
  }

  async addToQueue(sessionId: string, prompt: AgentQueuedInput) {
    return this.queue.add(sessionId, prompt);
  }
  async getQueue(sessionId: string) {
    return this.queue.get(sessionId);
  }
  async removeFromQueue(sessionId: string, promptId: string) {
    return this.queue.remove(sessionId, promptId);
  }
  async clearQueue(sessionId: string) {
    return this.queue.clear(sessionId);
  }

  /**
   * Emit an event to the agent stream (private, used internally).
   */
  private emitAgentEvent(sessionId: string, data: Record<string, unknown>): void {
    this.events.publish(sessionId, data);
  }

  /**
   * Emit an error event for a session.
   *
   * Public method so that route handlers can surface errors to the UI
   * even when sendMessage() throws before it can emit its own error event
   * (e.g., when the session is not found and no in-memory session exists).
   */
  emitSessionError(sessionId: string, error: string, originalError?: unknown): void {
    if (
      originalError &&
      typeof originalError === 'object' &&
      this.reportedErrors.has(originalError)
    )
      return;
    this.events.publish(sessionId, { type: 'error', error });
  }

  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}
