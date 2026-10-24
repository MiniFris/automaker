/**
 * Agent Service - Runs AI agents via provider architecture
 * Manages conversation sessions and streams responses via WebSocket
 */

import path from 'path';
import type { EventEmitter } from '../lib/events.js';
import type { ThinkingLevel } from '@automaker/types';
import { isAbortError, createLogger, classifyError } from '@automaker/utils';
import { AgentSessionRepository } from './agent/agent-session.repository.js';
import { AgentSessionRegistry } from './agent/agent-session-registry.js';
import { AgentSessionStorageError } from './agent/agent-session-storage.error.js';
import { AgentExecutionCoordinator } from './agent/agent-execution-coordinator.js';
import { AgentPromptBuilder } from './agent/agent-prompt-builder.js';
import { AgentEnvironmentPreparer } from './agent/agent-environment-preparer.js';
import { AgentProviderSelector } from './agent/agent-provider-selector.js';
import { AgentQueryOptionsBuilder } from './agent/agent-query-options-builder.js';
import { ConflictDomainError, UnavailableDomainError } from '../core/errors/domain-errors.js';
import type {
  ActiveSession as Session,
  Message,
  QueuedPrompt,
  SessionMetadata,
  AgentMessageInput,
} from './agent/agent-session.types.js';
import { validateWorkingDirectory } from '../lib/sdk-options.js';
import type { SettingsService } from './settings-service.js';

export class AgentService {
  private reportedErrors = new WeakSet<object>();
  private events: EventEmitter;
  private settingsService: SettingsService | null = null;
  private logger = createLogger('AgentService');

  constructor(
    private readonly repository: AgentSessionRepository,
    private readonly sessions: AgentSessionRegistry,
    private readonly executions: AgentExecutionCoordinator,
    private readonly prompts: AgentPromptBuilder,
    private readonly environments: AgentEnvironmentPreparer,
    events: EventEmitter,
    settingsService: SettingsService | undefined,
    private readonly providers: AgentProviderSelector,
    private readonly queries: AgentQueryOptionsBuilder
  ) {
    this.events = events;
    this.settingsService = settingsService ?? null;
  }

  async initialize(): Promise<void> {
    await this.repository.initialize();
  }

  /**
   * Detect provider-side session errors (session not found, expired, etc.).
   * Used to decide whether to clear a stale sdkSessionId.
   */
  private isStaleSessionError(rawErrorText: string): boolean {
    const errorLower = rawErrorText.toLowerCase();
    return (
      errorLower.includes('session not found') ||
      errorLower.includes('session expired') ||
      errorLower.includes('invalid session') ||
      errorLower.includes('no such session')
    );
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
    if (!session) {
      // Session doesn't exist on disk either — create a fresh in-memory session.
      const effectiveWorkingDirectory = workingDirectory || process.cwd();
      const resolvedWorkingDirectory = path.resolve(effectiveWorkingDirectory);
      validateWorkingDirectory(resolvedWorkingDirectory);

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

  /**
   * Ensure a session is loaded into memory.
   *
   * Sessions may exist on disk (in metadata and session files) but not be
   * present in the in-memory Map — for example after a server restart, or
   * when a client calls sendMessage before explicitly calling startConversation.
   *
   * This helper transparently loads the session from disk when it is missing
   * from memory, eliminating "session not found" errors for sessions that
   * were previously created but not yet initialized in memory.
   *
   * If both metadata and session files are missing, the session truly doesn't
   * exist. A detailed diagnostic log is emitted so developers can track down
   * how the invalid session ID was generated.
   *
   * @returns The in-memory Session object, or null if the session doesn't exist at all
   */
  private async ensureSession(
    sessionId: string,
    workingDirectory?: string
  ): Promise<Session | null> {
    return this.sessions.getOrLoad(sessionId, () =>
      this.hydrateSession(sessionId, workingDirectory)
    );
  }

  private async hydrateSession(
    sessionId: string,
    workingDirectory?: string
  ): Promise<Session | null> {
    // Try to load from disk — the session may have been created earlier
    // (e.g. via createSession) but never initialized in memory.
    let metadata: Record<string, SessionMetadata>;
    let messages: Message[];
    try {
      [metadata, messages] = await Promise.all([this.loadMetadata(), this.loadSession(sessionId)]);
    } catch (error) {
      // Disk read failure should not be treated as "session not found" —
      // it's an I/O problem. Propagate it; a fresh empty session would risk
      // overwriting the existing persisted conversation.
      this.logger.error(
        `Failed to load session ${sessionId} from disk (I/O error — NOT a missing session):`,
        error
      );
      throw error;
    }

    const sessionMetadata = metadata[sessionId];

    // If there's no metadata AND no persisted messages, the session truly doesn't exist.
    // Log diagnostic info to help track down how we ended up with an invalid session ID.
    if (!sessionMetadata && messages.length === 0) {
      this.logger.warn(
        `Session "${sessionId}" not found: no metadata and no persisted messages. ` +
          `This can happen when a session ID references a deleted/expired session, ` +
          `or when the server restarted and the session was never persisted to disk. ` +
          `Available session IDs in metadata: [${Object.keys(metadata).slice(0, 10).join(', ')}${Object.keys(metadata).length > 10 ? '...' : ''}]`
      );
      return null;
    }

    const effectiveWorkingDirectory =
      workingDirectory || sessionMetadata?.workingDirectory || process.cwd();
    const resolvedWorkingDirectory = path.resolve(effectiveWorkingDirectory);

    // Validate that the working directory is allowed using centralized validation
    try {
      validateWorkingDirectory(resolvedWorkingDirectory);
    } catch (validationError) {
      this.logger.warn(
        `Session "${sessionId}": working directory "${resolvedWorkingDirectory}" is not allowed — ` +
          `returning null so callers treat it as a missing session. Error: ${(validationError as Error).message}`
      );
      return null;
    }

    // Load persisted queue
    const promptQueue = await this.loadQueueState(sessionId);

    const session: Session = {
      messages,
      isRunning: false,
      abortController: null,
      workingDirectory: resolvedWorkingDirectory,
      projectPath: sessionMetadata?.projectPath ?? resolvedWorkingDirectory,
      sdkSessionId: sessionMetadata?.sdkSessionId,
      model: sessionMetadata?.model,
      providerId: sessionMetadata?.providerId,
      promptQueue,
    };

    this.logger.info(
      `Auto-initialized session ${sessionId} from disk ` +
        `(${messages.length} messages, sdkSessionId: ${sessionMetadata?.sdkSessionId ? 'present' : 'none'})`
    );
    return session;
  }

  /**
   * Send a message to the agent and stream responses
   */
  sendMessage(input: AgentMessageInput) {
    return this.runSelectedMessage(input.sessionId, async () => input);
  }

  private runSelectedMessage(
    sessionId: string,
    selectInput: (controller: AbortController) => Promise<AgentMessageInput | undefined>
  ) {
    return this.executions.run(sessionId, async (controller) => {
      try {
        const input = await selectInput(controller);
        if (!input) return { success: false as const };
        controller.signal.throwIfAborted();
        return await this.executeMessage(input, controller);
      } catch (error) {
        if (controller.signal.aborted && !(error instanceof AgentSessionStorageError))
          return { success: false as const, aborted: true as const };
        throw error;
      } finally {
        const session = this.sessions.get(sessionId);
        if (session?.abortController === controller) {
          session.isRunning = false;
          session.abortController = null;
        }
      }
    });
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
    controller: AbortController
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
    };

    session.messages.push(userMessage);

    // Emit started event so UI can show thinking indicator
    this.emitAgentEvent(sessionId, {
      type: 'started',
    });

    // Emit user message event
    this.emitAgentEvent(sessionId, {
      type: 'message',
      message: userMessage,
    });

    let completion: Record<string, unknown> | undefined;
    let userMessageStored = false;
    try {
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

      let currentAssistantMessage: Message | null = null;
      let responseText = '';
      let modelSucceeded = false;
      const toolUses: Array<{ name: string; input: unknown }> = [];
      const toolNamesById = new Map<string, string>();

      for await (const msg of stream) {
        controller.signal.throwIfAborted();
        // Capture SDK session ID from any message and persist it.
        // Update when:
        //  - No session ID set yet (first message in a new session)
        //  - The provider returned a *different* session ID (e.g., after a
        //    "Session not found" recovery where the provider started a fresh
        //    session — the stale ID must be replaced with the new one)
        if (msg.session_id && msg.session_id !== session.sdkSessionId) {
          session.sdkSessionId = msg.session_id;
          // Persist the SDK session ID to ensure conversation continuity across server restarts
          await this.updateSession(sessionId, { sdkSessionId: msg.session_id });
        }

        if (msg.type === 'assistant') {
          if (msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === 'text') {
                responseText += block.text;

                if (!currentAssistantMessage) {
                  currentAssistantMessage = {
                    id: this.generateId(),
                    role: 'assistant',
                    content: responseText,
                    timestamp: new Date().toISOString(),
                  };
                  session.messages.push(currentAssistantMessage);
                } else {
                  currentAssistantMessage.content = responseText;
                }

                this.emitAgentEvent(sessionId, {
                  type: 'stream',
                  messageId: currentAssistantMessage.id,
                  content: responseText,
                  isComplete: false,
                });
              } else if (block.type === 'tool_use') {
                const toolUse = {
                  name: block.name || 'unknown',
                  input: block.input,
                };
                toolUses.push(toolUse);
                if (block.tool_use_id) {
                  toolNamesById.set(block.tool_use_id, toolUse.name);
                }

                this.emitAgentEvent(sessionId, {
                  type: 'tool_use',
                  tool: toolUse,
                });
              } else if (block.type === 'tool_result') {
                const toolUseId = block.tool_use_id;
                const toolName = toolUseId ? toolNamesById.get(toolUseId) : undefined;

                // Normalize block.content to a string for the emitted event
                const rawContent: unknown = block.content;
                let contentString: string;
                if (typeof rawContent === 'string') {
                  contentString = rawContent;
                } else if (Array.isArray(rawContent)) {
                  // Extract text from content blocks (TextBlock, ImageBlock, etc.)
                  contentString = rawContent
                    .map((part: { text?: string; type?: string }) => {
                      if (typeof part === 'string') return part;
                      if (part.text) return part.text;
                      // For non-text blocks (e.g., images), represent as type indicator
                      if (part.type) return `[${part.type}]`;
                      return JSON.stringify(part);
                    })
                    .join('\n');
                } else if (rawContent !== undefined && rawContent !== null) {
                  contentString = JSON.stringify(rawContent);
                } else {
                  contentString = '';
                }

                this.emitAgentEvent(sessionId, {
                  type: 'tool_result',
                  tool: {
                    name: toolName || 'unknown',
                    input: {
                      toolUseId,
                      content: contentString,
                    },
                  },
                });
              }
            }
          }
        } else if (msg.type === 'result') {
          modelSucceeded = msg.subtype === 'success';
          if (msg.subtype === 'success' && msg.result) {
            if (currentAssistantMessage) {
              currentAssistantMessage.content = msg.result;
              responseText = msg.result;
            }
          }

          completion = {
            type: 'complete',
            messageId: currentAssistantMessage?.id,
            content: responseText,
            toolUses,
          };
        } else if (msg.type === 'error') {
          // Some providers (like Codex CLI/SaaS or Cursor CLI) surface failures as
          // streamed error messages instead of throwing. Handle these here so the
          // Agent Runner UX matches the Claude/Cursor behavior without changing
          // their provider implementations.

          // Clean error text: strip ANSI escape codes and the redundant "Error: "
          // prefix that CLI providers (especially OpenCode) add to stderr output.
          // The OpenCode provider strips these in normalizeEvent/executeQuery, but
          // we also strip here as a defense-in-depth measure.
          //
          // Without stripping the "Error: " prefix, the wrapping at line ~647
          // (`content: \`Error: ${enhancedText}\``) produces double-prefixed text:
          // "Error: Error: Session not found" — confusing for the user.
          const rawMsgError =
            (typeof msg.error === 'string' && msg.error.trim()) ||
            'Unexpected error from provider during agent execution.';
          let rawErrorText = rawMsgError.replace(/\x1b\[[0-9;]*m/g, '').trim() || rawMsgError;
          // Remove the CLI's "Error: " prefix to prevent double-wrapping
          rawErrorText = rawErrorText.replace(/^Error:\s*/i, '').trim() || rawErrorText;

          const errorInfo = classifyError(new Error(rawErrorText));

          // Detect provider-side session errors and proactively clear the stale
          // sdkSessionId so the next attempt starts a fresh provider session.
          // This handles providers that don't have built-in session recovery
          // (unlike OpenCode which auto-retries without the session flag).
          if (session.sdkSessionId && this.isStaleSessionError(rawErrorText)) {
            this.logger.info(
              `Clearing stale sdkSessionId for session ${sessionId} after provider session error`
            );
            session.sdkSessionId = undefined;
            await this.clearSdkSessionId(sessionId);
          }

          // Keep the provider-supplied text intact (Codex already includes helpful tips),
          // only add a small rate-limit hint when we can detect it.
          const enhancedText = errorInfo.isRateLimit
            ? `${rawErrorText}\n\nTip: It looks like you hit a rate limit. Try waiting a bit or reducing concurrent Agent Runner / Auto Mode tasks.`
            : rawErrorText;

          this.logger.error('Provider error during agent execution:', {
            type: errorInfo.type,
            message: errorInfo.message,
          });

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
          await this.saveSession(sessionId, session.messages);

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
        await execution.recordMemoryUsage(responseText, modelSucceeded);
      } catch (error) {
        this.logger.warn(
          'Chat target memory statistics were not saved (no replay/fallback):',
          error
        );
      }
      controller.signal.throwIfAborted();
      await this.saveSession(sessionId, session.messages);
      controller.signal.throwIfAborted();

      session.isRunning = false;
      session.abortController = null;
      if (completion) this.emitAgentEvent(sessionId, completion);

      // Process next item in queue after completion
      setImmediate(() => this.processNextInQueue(sessionId));

      return {
        success: true,
        message: currentAssistantMessage,
      };
    } catch (error) {
      if (error instanceof AgentSessionStorageError) {
        if (!userMessageStored)
          session.messages = session.messages.filter((message) => message.id !== userMessage.id);
        session.isRunning = false;
        session.abortController?.abort();
        session.abortController = null;
        this.emitAgentEvent(sessionId, {
          type: 'error',
          error: error.message,
          errorType: 'persistence',
        });
        this.reportedErrors.add(error);
        throw error;
      }
      if (controller.signal.aborted || isAbortError(error)) {
        await this.saveSession(sessionId, session.messages);
        session.isRunning = false;
        session.abortController = null;
        return { success: false, aborted: true };
      }

      this.logger.error('Error:', error);

      // Strip ANSI escape codes and the "Error: " prefix from thrown error
      // messages so the UI receives clean text without double-prefixing.
      let rawThrownMsg = ((error as Error).message || '').replace(/\x1b\[[0-9;]*m/g, '').trim();
      rawThrownMsg = rawThrownMsg.replace(/^Error:\s*/i, '').trim() || rawThrownMsg;
      const thrownErrorMsg = rawThrownMsg.toLowerCase();

      // Check if the thrown error is a provider-side session error.
      // Clear the stale sdkSessionId so the next retry starts fresh.
      if (session.sdkSessionId && this.isStaleSessionError(rawThrownMsg)) {
        this.logger.info(
          `Clearing stale sdkSessionId for session ${sessionId} after thrown session error`
        );
        session.sdkSessionId = undefined;
        await this.clearSdkSessionId(sessionId);
      }

      session.isRunning = false;
      session.abortController = null;

      const cleanErrorMsg = rawThrownMsg || (error as Error).message;
      const errorMessage: Message = {
        id: this.generateId(),
        role: 'assistant',
        content: `Error: ${cleanErrorMsg}`,
        timestamp: new Date().toISOString(),
        isError: true,
      };

      session.messages.push(errorMessage);
      await this.saveSession(sessionId, session.messages);

      this.emitAgentEvent(sessionId, {
        type: 'error',
        error: cleanErrorMsg,
        message: errorMessage,
      });

      if (error && typeof error === 'object') this.reportedErrors.add(error);
      throw error;
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

  /**
   * Stop current agent execution
   */
  async stopExecution(sessionId: string) {
    return this.executions.mutate(sessionId, async () => {
      const session = await this.ensureSession(sessionId);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      if (session.abortController) {
        session.abortController.abort();
        session.isRunning = false;
        session.abortController = null;
      }

      return { success: true };
    });
  }

  async interruptActiveSessions(reason: string): Promise<number> {
    this.executions.stopAccepting();
    const ids = new Set([
      ...this.executions.ids(),
      ...[...this.sessions.entries()].filter(([, session]) => session.isRunning).map(([id]) => id),
    ]);
    let interrupted = 0;
    const results = await Promise.allSettled(
      [...ids].map(async (sessionId) => {
        const session = await this.ensureSession(sessionId);
        if (!session) return;
        const managed = this.executions.has(sessionId);
        if (!managed && !session.isRunning) return;
        const message: Message = {
          id: this.generateId(),
          role: 'assistant',
          content: `Interrupted: ${reason}`,
          timestamp: new Date().toISOString(),
          isError: true,
        };
        session.messages.push(message);
        await this.saveSession(sessionId, session.messages);
        // A run may have completed while its interruption snapshot was writing.
        if (managed && !this.executions.has(sessionId)) {
          session.messages = session.messages.filter((item) => item.id !== message.id);
          await this.saveSession(sessionId, session.messages);
          return;
        }
        interrupted++;
        this.emitAgentEvent(sessionId, {
          type: 'error',
          error: reason,
          errorType: 'interruption',
          message,
        });
      })
    );
    // Always request abort, even when persistence failed; never skip cleanup.
    this.executions.abortAll();
    for (const id of ids) this.sessions.get(id)?.abortController?.abort();
    await this.executions.drain();
    for (const id of ids) {
      const session = this.sessions.get(id);
      if (session) {
        session.isRunning = false;
        session.abortController = null;
      }
    }
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    return interrupted;
  }

  /**
   * Clear conversation history
   */
  async clearSession(sessionId: string) {
    return this.executions.mutate(sessionId, () =>
      this.sessions.serializeQueue(sessionId, () => this.clearSessionState(sessionId))
    );
  }

  private async clearSessionState(sessionId: string) {
    const session = await this.ensureSession(sessionId);
    if (session) {
      await this.saveSession(sessionId, []);
      await this.clearSdkSessionId(sessionId);
      session.messages = [];
      session.isRunning = false;
      session.sdkSessionId = undefined; // Clear stale provider session ID to prevent "Session not found" errors
    }

    // Clear the sdkSessionId from persisted metadata so it doesn't get
    // reloaded by ensureSession() after a server restart.
    // This prevents "Session not found" errors when the provider-side session
    // no longer exists (e.g., OpenCode CLI sessions expire on disk).
    if (!session) await this.clearSdkSessionId(sessionId);

    return { success: true };
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
    const effectiveWorkingDirectory = workingDirectory || projectPath || process.cwd();
    const resolvedWorkingDirectory = path.resolve(effectiveWorkingDirectory);

    // Validate that the working directory is allowed using centralized validation
    validateWorkingDirectory(resolvedWorkingDirectory);

    // Validate that projectPath is allowed if provided
    if (projectPath) {
      validateWorkingDirectory(projectPath);
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
    return this.executions.mutate(sessionId, () =>
      this.sessions.serializeQueue(sessionId, () => this.deleteSessionState(sessionId))
    );
  }

  private async deleteSessionState(sessionId: string): Promise<boolean> {
    if (!(await this.repository.deleteMetadata(sessionId))) return false;
    await this.repository.deleteMessages(sessionId);

    // Clear from memory
    this.sessions.delete(sessionId);

    return true;
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

  // Queue management methods

  /**
   * Add a prompt to the queue for later execution
   */
  async addToQueue(
    sessionId: string,
    prompt: {
      message: string;
      imagePaths?: string[];
      model?: string;
      providerId?: string;
      thinkingLevel?: ThinkingLevel;
    }
  ): Promise<{ success: boolean; queuedPrompt?: QueuedPrompt; error?: string }> {
    this.executions.assertSessionOpen(sessionId);
    return this.sessions.serializeQueue(sessionId, async () => {
      this.executions.assertSessionOpen(sessionId);
      const session = await this.ensureSession(sessionId);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      const queuedPrompt: QueuedPrompt = {
        id: this.generateId(),
        message: prompt.message,
        imagePaths: prompt.imagePaths,
        model: prompt.model ?? session.model,
        providerId:
          prompt.providerId ??
          (prompt.model === undefined || prompt.model === session.model
            ? session.providerId
            : undefined),
        thinkingLevel: prompt.thinkingLevel,
        addedAt: new Date().toISOString(),
      };

      const queue = [...session.promptQueue, queuedPrompt];
      await this.saveQueueState(sessionId, queue);
      session.promptQueue = queue;

      // Emit queue update event
      this.emitAgentEvent(sessionId, {
        type: 'queue_updated',
        queue: session.promptQueue,
      });

      return { success: true, queuedPrompt };
    });
  }

  /**
   * Get the current queue for a session
   */
  async getQueue(
    sessionId: string
  ): Promise<{ success: boolean; queue?: QueuedPrompt[]; error?: string }> {
    const session = await this.ensureSession(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }
    return { success: true, queue: session.promptQueue };
  }

  /**
   * Remove a specific prompt from the queue
   */
  async removeFromQueue(
    sessionId: string,
    promptId: string
  ): Promise<{ success: boolean; error?: string }> {
    this.executions.assertSessionOpen(sessionId);
    return this.sessions.serializeQueue(sessionId, async () => {
      this.executions.assertSessionOpen(sessionId);
      const session = await this.ensureSession(sessionId);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      const index = session.promptQueue.findIndex((p) => p.id === promptId);
      if (index === -1) {
        return { success: false, error: 'Prompt not found in queue' };
      }

      const queue = session.promptQueue.filter((_, position) => position !== index);
      await this.saveQueueState(sessionId, queue);
      session.promptQueue = queue;

      this.emitAgentEvent(sessionId, {
        type: 'queue_updated',
        queue: session.promptQueue,
      });

      return { success: true };
    });
  }

  /**
   * Clear all prompts from the queue
   */
  async clearQueue(sessionId: string): Promise<{ success: boolean; error?: string }> {
    this.executions.assertSessionOpen(sessionId);
    return this.sessions.serializeQueue(sessionId, async () => {
      this.executions.assertSessionOpen(sessionId);
      const session = await this.ensureSession(sessionId);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      await this.saveQueueState(sessionId, []);
      session.promptQueue = [];

      this.emitAgentEvent(sessionId, {
        type: 'queue_updated',
        queue: [],
      });

      return { success: true };
    });
  }

  /**
   * Save queue state to disk for persistence
   */
  private async saveQueueState(sessionId: string, queue: QueuedPrompt[]): Promise<void> {
    await this.repository.saveQueue(sessionId, queue);
  }

  /**
   * Load queue state from disk
   */
  private async loadQueueState(sessionId: string): Promise<QueuedPrompt[]> {
    return this.repository.loadQueue(sessionId);
  }

  /**
   * Process the next item in the queue (called after task completion)
   */
  private async processNextInQueue(sessionId: string): Promise<void> {
    let nextPrompt: QueuedPrompt | undefined;
    let admitted = false;
    try {
      // Claim execution before dequeueing; a manual send must not steal the run
      // after its queued prompt has already been removed from durable storage.
      const execution = this.runSelectedMessage(sessionId, async (controller) => {
        nextPrompt = await this.sessions.serializeQueue(sessionId, async () => {
          const session = this.sessions.get(sessionId);
          if (!session || session.isRunning || !session.promptQueue.length) return undefined;
          controller.signal.throwIfAborted();
          const [next, ...remaining] = session.promptQueue;
          await this.saveQueueState(sessionId, remaining);
          session.promptQueue = remaining;
          this.emitAgentEvent(sessionId, { type: 'queue_updated', queue: remaining });
          return next;
        });
        if (!nextPrompt) return undefined;
        return {
          sessionId,
          message: nextPrompt.message,
          imagePaths: nextPrompt.imagePaths,
          model: nextPrompt.model,
          providerId: nextPrompt.providerId,
          thinkingLevel: nextPrompt.thinkingLevel,
        };
      });
      admitted = true;
      await execution;
    } catch (error) {
      if (
        !admitted &&
        (error instanceof ConflictDomainError || error instanceof UnavailableDomainError)
      )
        return;
      this.logger.error('Failed to process queued prompt:', error);
      this.emitAgentEvent(sessionId, {
        type: 'queue_error',
        error: (error as Error).message,
        promptId: nextPrompt?.id,
      });
    }
  }

  /**
   * Emit an event to the agent stream (private, used internally).
   */
  private emitAgentEvent(sessionId: string, data: Record<string, unknown>): void {
    this.events.emit('agent:stream', { sessionId, ...data });
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
    this.events.emit('agent:stream', { sessionId, type: 'error', error });
  }

  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}
