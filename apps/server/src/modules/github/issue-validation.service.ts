import { DirectCheckpointRepository } from '../providers/direct-checkpoint.repository.js';
import type { AgentCheckpointRepository } from '../../providers/openai-compatible/checkpoint.js';
import { HOST_ENVIRONMENT } from '../../core/config/index.js';
/**
 * Native issue-validation workflow and application service.
 *
 * Scans the codebase to determine if an issue is valid, invalid, or needs clarification.
 * Runs asynchronously and emits events for progress and completion.
 * Supports Claude, Codex, Cursor, and OpenCode models.
 */

import { Inject, Injectable } from '@nestjs/common';
import { createLogger } from '@automaker/utils';
import { EVENT_BUS, type EventBus } from '../../core/eventing/event-bus.js';
import { UnavailableDomainError, ValidationDomainError } from '../../core/errors/domain-errors.js';
import { IssueValidationRegistry } from './issue-validation-registry.service.js';
import type {
  IssueValidationRequest,
  IssueValidationStatusRequest,
  IssueValidationStopRequest,
} from './issue-validation.schemas.js';
import type {
  IssueValidationResult,
  IssueValidationEvent,
  ModelId,
  ThinkingLevel,
  ReasoningEffort,
} from '@automaker/types';
import {
  DEFAULT_PHASE_MODELS,
  isClaudeModel,
  isCodexModel,
  isCursorModel,
  isOpencodeModel,
  supportsStructuredOutput,
} from '@automaker/types';
import { resolvePhaseModel, resolveModelString } from '@automaker/model-resolver';
import { extractJson } from '../../lib/json-extractor.js';
import { IssueValidationRepository } from './issue-validation.repository.js';
import { streamingQuery } from '../../providers/simple-query-service.js';
import {
  issueValidationSchema,
  buildValidationPrompt,
  ValidationComment,
  ValidationLinkedPR,
} from './issue-validation-prompt.js';
import {
  getPromptCustomization,
  getAutoLoadClaudeMdSetting,
  resolveProviderContext,
} from '../../lib/settings-helpers.js';
import { SettingsService } from '../../services/settings-service.js';
import { ProviderRegistry } from '../providers/provider-registry.service.js';

const logger = createLogger('IssueValidation');

/**
 * Run the validation asynchronously
 *
 * Emits events for start, progress, complete, and error.
 * Stores result on completion.
 * Supports Claude/Codex models (structured output) and Cursor/OpenCode models (JSON parsing).
 */
async function runValidation(
  projectPath: string,
  issueNumber: number,
  issueTitle: string,
  issueBody: string,
  issueLabels: string[] | undefined,
  model: ModelId,
  events: EventBus,
  abortController: AbortController,
  settingsService: SettingsService | undefined,
  providerId: string | undefined,
  comments: ValidationComment[] | undefined,
  linkedPRs: ValidationLinkedPR[] | undefined,
  thinkingLevel: ThinkingLevel | undefined,
  reasoningEffort: ReasoningEffort | undefined,
  providerRegistry: ProviderRegistry,
  repository: IssueValidationRepository,
  hostEnvironment: Readonly<NodeJS.ProcessEnv>,
  checkpointRepository?: AgentCheckpointRepository
): Promise<void> {
  // Emit start event
  const startEvent: IssueValidationEvent = {
    type: 'issue_validation_start',
    issueNumber,
    issueTitle,
    projectPath,
  };
  events.emit('issue-validation:event', startEvent);

  try {
    // Build the prompt (include comments and linked PRs if provided)
    const basePrompt = buildValidationPrompt(
      issueNumber,
      issueTitle,
      issueBody,
      issueLabels,
      comments,
      linkedPRs
    );

    let responseText = '';

    // Get customized prompts from settings
    const prompts = await getPromptCustomization(settingsService, '[ValidateIssue]');
    const issueValidationSystemPrompt = prompts.issueValidation.systemPrompt;

    // Determine if we should use structured output based on model type
    // Claude and Codex support it; Cursor, Gemini, OpenCode, Copilot don't
    const useStructuredOutput = supportsStructuredOutput(model);

    // Build the final prompt - for Cursor, include system prompt and JSON schema instructions
    let finalPrompt = basePrompt;
    if (!useStructuredOutput) {
      finalPrompt = `${issueValidationSystemPrompt}

CRITICAL INSTRUCTIONS:
1. DO NOT write any files. Return the JSON in your response only.
2. Respond with ONLY a JSON object - no explanations, no markdown, just raw JSON.
3. The JSON must match this exact schema:

${JSON.stringify(issueValidationSchema, null, 2)}

Your entire response should be valid JSON starting with { and ending with }. No text before or after.

${basePrompt}`;
    }

    // Load autoLoadClaudeMd setting
    const autoLoadClaudeMd = await getAutoLoadClaudeMdSetting(
      projectPath,
      settingsService,
      '[ValidateIssue]'
    );

    // Use request overrides if provided, otherwise fall back to settings
    let effectiveThinkingLevel: ThinkingLevel | undefined = thinkingLevel;
    let effectiveReasoningEffort: ReasoningEffort | undefined = reasoningEffort;
    if (!effectiveThinkingLevel || !effectiveReasoningEffort) {
      const settings = await settingsService?.getGlobalSettings();
      const phaseModelEntry =
        settings?.phaseModels?.validationModel || DEFAULT_PHASE_MODELS.validationModel;
      const resolved = resolvePhaseModel(phaseModelEntry);
      if (!effectiveThinkingLevel) {
        effectiveThinkingLevel = resolved.thinkingLevel;
      }
      if (!effectiveReasoningEffort && typeof phaseModelEntry !== 'string') {
        effectiveReasoningEffort = phaseModelEntry.reasoningEffort;
      }
    }

    // Check if the model is a provider model (like "GLM-4.5-Air")
    // If so, get the provider config and resolved Claude model
    let claudeCompatibleProvider: import('@automaker/types').ClaudeCompatibleProvider | undefined;
    let providerResolvedModel: string | undefined;
    let credentials = await settingsService?.getCredentials();

    if (settingsService) {
      const providerResult = await resolveProviderContext(
        settingsService,
        model,
        providerId,
        '[ValidateIssue]'
      );
      if (providerResult.provider) {
        claudeCompatibleProvider = providerResult.provider;
        providerResolvedModel = providerResult.resolvedModel;
        credentials = providerResult.credentials;
        logger.info(
          `Using provider "${providerResult.provider.name}" for model "${model}"` +
            (providerResolvedModel ? ` -> resolved to "${providerResolvedModel}"` : '')
        );
      }
    }

    // CRITICAL: For custom providers (GLM, MiniMax), pass the provider's model ID (e.g. "GLM-4.7")
    // to the API, NOT the resolved Claude model - otherwise we get "model not found"
    // For standard Claude models, resolve aliases (e.g., 'opus' -> 'claude-opus-4-20250514')
    const effectiveModel = claudeCompatibleProvider
      ? (model as string)
      : providerResolvedModel || resolveModelString(model as string);
    logger.info(`Using model: ${effectiveModel}`);

    // Use streamingQuery with event callbacks
    const result = await streamingQuery(
      {
        settingsService,
        providerId,
        prompt: finalPrompt,
        model: effectiveModel,
        cwd: projectPath,
        systemPrompt: useStructuredOutput ? issueValidationSystemPrompt : undefined,
        abortController,
        thinkingLevel: effectiveThinkingLevel,
        reasoningEffort: effectiveReasoningEffort,
        readOnly: true, // Issue validation only reads code, doesn't write
        settingSources: autoLoadClaudeMd ? ['user', 'project', 'local'] : undefined,
        claudeCompatibleProvider, // Pass provider for alternative endpoint configuration
        credentials, // Pass credentials for resolving 'credentials' apiKeySource
        outputFormat: useStructuredOutput
          ? {
              type: 'json_schema',
              schema: issueValidationSchema as Record<string, unknown>,
            }
          : undefined,
        onText: (text) => {
          if (abortController.signal.aborted) return;
          responseText += text;
          // Emit progress event
          const progressEvent: IssueValidationEvent = {
            type: 'issue_validation_progress',
            issueNumber,
            content: text,
            projectPath,
          };
          events.emit('issue-validation:event', progressEvent);
        },
      },
      providerRegistry,
      hostEnvironment,
      checkpointRepository
    );

    abortController.signal.throwIfAborted();

    // Get validation result from structured output or parse from text
    let validationResult: IssueValidationResult | null = null;

    if (result.structured_output) {
      validationResult = result.structured_output as unknown as IssueValidationResult;
      logger.debug('Received structured validation output.');
    } else if (responseText) {
      // Parse JSON from response text
      validationResult = extractJson<IssueValidationResult>(responseText, { logger });
    }

    // Require validation result
    if (!validationResult) {
      logger.error('No validation result received from AI provider');
      throw new Error('Validation failed: no valid result received');
    }

    logger.info(`Issue #${issueNumber} validation complete: ${validationResult.verdict}`);

    // Store the result
    abortController.signal.throwIfAborted();
    await repository.write(projectPath, issueNumber, {
      issueNumber,
      issueTitle,
      validatedAt: new Date().toISOString(),
      model,
      result: validationResult,
    });

    abortController.signal.throwIfAborted();
    // Emit completion event
    const completeEvent: IssueValidationEvent = {
      type: 'issue_validation_complete',
      issueNumber,
      issueTitle,
      result: validationResult,
      projectPath,
      model,
    };
    events.emit('issue-validation:event', completeEvent);
  } catch (error) {
    const errorMessage = abortController.signal.aborted
      ? 'Validation cancelled.'
      : 'Issue validation failed.';
    logger.error(`Issue #${issueNumber} validation failed.`);

    // Emit error event
    const errorEvent: IssueValidationEvent = {
      type: 'issue_validation_error',
      issueNumber,
      error: errorMessage,
      projectPath,
    };
    events.emit('issue-validation:event', errorEvent);

    throw error;
  }
}

@Injectable()
export class IssueValidationService {
  constructor(
    @Inject(EVENT_BUS) private readonly events: EventBus,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(ProviderRegistry) private readonly providers: ProviderRegistry,
    @Inject(IssueValidationRegistry) private readonly registry: IssueValidationRegistry,
    @Inject(IssueValidationRepository) private readonly repository: IssueValidationRepository,
    @Inject(HOST_ENVIRONMENT) private readonly hostEnvironment: Readonly<NodeJS.ProcessEnv> = {},
    @Inject(DirectCheckpointRepository)
    private readonly checkpointRepository?: AgentCheckpointRepository
  ) {}

  start(input: IssueValidationRequest) {
    const {
      projectPath,
      issueNumber,
      issueTitle,
      issueBody,
      issueLabels,
      model = 'opus',
      thinkingLevel,
      reasoningEffort,
      comments,
      linkedPRs,
    } = input;
    const providerId = input.providerId?.trim() || undefined;
    if (
      !(
        isClaudeModel(model) ||
        isCursorModel(model) ||
        isCodexModel(model) ||
        isOpencodeModel(model) ||
        providerId
      )
    )
      throw new ValidationDomainError(
        'Invalid model. Must be a Claude, Cursor, Codex, or OpenCode model ID (or alias), or provide a valid providerId for custom Claude-compatible models.'
      );
    const accepted = this.registry.start(projectPath, issueNumber, (controller) =>
      runValidation(
        projectPath,
        issueNumber,
        issueTitle,
        issueBody,
        issueLabels,
        model,
        this.events,
        controller,
        this.settings,
        providerId,
        comments?.map((comment) => ({
          author: comment.author?.login || 'ghost',
          createdAt: comment.createdAt,
          body: comment.body,
        })),
        linkedPRs?.map((pr) => ({ number: pr.number, title: pr.title, state: pr.state })),
        thinkingLevel,
        reasoningEffort,
        this.providers,
        this.repository,
        this.hostEnvironment,
        this.checkpointRepository
      )
    );
    return accepted
      ? { success: true, message: `Validation started for issue #${issueNumber}`, issueNumber }
      : { success: false, error: `Validation is already running for issue #${issueNumber}` };
  }

  status(input: IssueValidationStatusRequest) {
    if (this.registry.hasUnconfirmed(input.projectPath, input.issueNumber))
      throw new UnavailableDomainError('Issue validation cleanup is unconfirmed.');
    if (input.issueNumber === undefined)
      return { success: true, runningIssues: this.registry.running(input.projectPath) };
    const status = this.registry.status(input.projectPath, input.issueNumber);
    return {
      success: true,
      isRunning: status?.isRunning ?? false,
      startedAt: status?.startedAt.toISOString(),
    };
  }

  stop(input: IssueValidationStopRequest) {
    return this.registry.abort(input.projectPath, input.issueNumber)
      ? { success: true, message: `Validation for issue #${input.issueNumber} has been stopped` }
      : { success: false, error: `No validation is running for issue #${input.issueNumber}` };
  }

  async stored(input: IssueValidationStatusRequest) {
    if (input.issueNumber === undefined)
      return { success: true, validations: await this.repository.list(input.projectPath) };
    const result = await this.repository.get(input.projectPath, input.issueNumber);
    return result
      ? { success: true, validation: result.validation, isStale: result.isStale }
      : { success: true, validation: null };
  }

  async delete(input: IssueValidationStopRequest) {
    return {
      success: true,
      deleted: await this.repository.delete(input.projectPath, input.issueNumber),
    };
  }

  async markViewed(input: IssueValidationStopRequest) {
    const success = await this.repository.markViewed(input.projectPath, input.issueNumber);
    if (success)
      this.events.emit('issue-validation:event', {
        type: 'issue_validation_viewed',
        issueNumber: input.issueNumber,
        projectPath: input.projectPath,
      });
    return { success };
  }
}
