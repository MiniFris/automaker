import { isDirectModel, stripProviderPrefix, type ExecuteOptions } from '@automaker/types';
import type { StreamingQueryOptions } from '../../providers/simple-query-service.js';
import {
  prepareDirectExecution,
  resolveExistingExecutionPreparation,
} from '../../providers/openai-compatible/execution.js';
import type { AgentCheckpointRepository } from '../../providers/openai-compatible/checkpoint.js';
import type { ProviderRegistry } from '../providers/provider-registry.service.js';
import type { SettingsService } from '../../services/settings-service.js';
import { captureNativeLocalEnvironment } from '../../services/execution-environment/local.js';
import { ProjectAnalysisRuntimeError } from './project-analysis.service.js';

/** Actual agent-mode query; only prepared saved targets may issue tool capabilities. */
export class ProjectAnalysisQueryAdapter {
  private readonly environment: Readonly<NodeJS.ProcessEnv>;
  constructor(
    private readonly settings: SettingsService,
    private readonly providers: ProviderRegistry,
    environment: Readonly<NodeJS.ProcessEnv>,
    private readonly checkpoints: AgentCheckpointRepository
  ) {
    this.environment = captureNativeLocalEnvironment(environment);
  }

  async query(options: StreamingQueryOptions, runKey: string): Promise<string> {
    const signal = options.abortController!.signal;
    signal.throwIfAborted();
    const model = options.model!;
    let prepared: ExecuteOptions;
    try {
      const existing = await resolveExistingExecutionPreparation(
        this.settings,
        options.cwd,
        runKey,
        signal,
        this.environment
      );
      signal.throwIfAborted();
      prepared = await prepareDirectExecution(
        {
          prompt: options.prompt,
          model: stripProviderPrefix(model),
          originalModel: model,
          cwd: options.cwd,
          maxTurns: options.maxTurns,
          allowedTools: options.allowedTools,
          ...(isDirectModel(model) && { tools: options.allowedTools }),
          abortController: options.abortController,
          thinkingLevel: options.thinkingLevel,
          reasoningEffort: options.reasoningEffort,
          readOnly: true,
          settingSources: options.settingSources,
          claudeCompatibleProvider: options.claudeCompatibleProvider,
          credentials: options.credentials,
        },
        this.settings,
        { model, providerId: options.providerId, projectPath: options.cwd, runKey },
        'agent',
        this.environment,
        this.checkpoints,
        existing
      );
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ProjectAnalysisRuntimeError();
    }
    signal.throwIfAborted();
    let result = '';
    for await (const message of this.providers.providerForModel(model).executeQuery(prepared)) {
      signal.throwIfAborted();
      if (message.type === 'error') throw new Error('Project analysis provider failed.');
      if (message.type === 'assistant' && message.message?.content) {
        for (const block of message.message.content)
          if (block.type === 'text' && block.text) {
            result += block.text;
            options.onText?.(block.text);
          }
      } else if (
        message.type === 'result' &&
        message.subtype === 'success' &&
        message.result &&
        message.result.length > result.length
      ) {
        result = message.result;
      }
    }
    signal.throwIfAborted();
    return result;
  }
}
