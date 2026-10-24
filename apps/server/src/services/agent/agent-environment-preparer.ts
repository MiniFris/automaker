import type { ExecutionEnvironmentBinding } from '@automaker/types';
import { hasRemoteEnvironment } from '../../providers/environment-execution.js';
import { prepareDirectExecution } from '../../providers/openai-compatible/execution.js';
import type { ExecuteOptions } from '../../providers/types.js';
import { FeatureWorkspaceService } from '../execution-environment/feature-workspace.js';
import { isIssuedEnvironment } from '../execution-environment/runtime.js';
import type { SettingsService } from '../settings-service.js';
import { AgentPromptBuilder } from './agent-prompt-builder.js';

/** Binds chat execution and target context; never selects a provider or retries mutations. */
export class AgentEnvironmentPreparer {
  constructor(private readonly prompts: AgentPromptBuilder) {}

  async usesManagedContext(
    settings: SettingsService | null,
    projectPath: string,
    runKey: string,
    signal: AbortSignal
  ): Promise<boolean> {
    signal.throwIfAborted();
    const managed = settings ? await hasRemoteEnvironment(settings, projectPath, runKey) : false;
    signal.throwIfAborted();
    return managed;
  }

  async prepare(input: {
    options: ExecuteOptions;
    settings: SettingsService | null;
    selection: Parameters<typeof prepareDirectExecution>[2];
    managedContext: boolean;
    onBinding: (binding: ExecutionEnvironmentBinding) => Promise<unknown>;
  }): Promise<{
    options: ExecuteOptions;
    recordMemoryUsage: (response: string, succeeded: boolean) => Promise<void>;
  }> {
    const signal = input.options.abortController!.signal;
    signal.throwIfAborted();
    const options = await prepareDirectExecution(input.options, input.settings, input.selection);
    // Persist a newly acquired binding even if cancellation arrived while binding.
    // A restart must not silently select a different environment for this chat.
    if (options.executionEnvironmentBinding)
      await input.onBinding(options.executionEnvironmentBinding);
    signal.throwIfAborted();
    const binding = options.executionEnvironmentBinding;
    const runtime = options.executionEnvironmentRuntime;
    const managed =
      input.managedContext && binding && isIssuedEnvironment(runtime) && input.settings
        ? {
            service: new FeatureWorkspaceService(input.settings),
            run: { binding, environment: runtime },
          }
        : undefined;
    const context = managed ? await managed.service.context(managed.run, signal) : undefined;
    signal.throwIfAborted();
    if (context?.formattedPrompt)
      options.systemPrompt = this.prompts.appendContext(
        options.systemPrompt,
        context.formattedPrompt
      );
    return {
      options,
      recordMemoryUsage: async (response, succeeded) => {
        if (!managed || !context?.memoryFiles.length) return;
        signal.throwIfAborted();
        // Errors are reported by the caller; no replay or controller-memory fallback.
        await managed.service
          .memory(managed.run)
          .recordUsage(context.memoryFiles, response, succeeded, signal);
      },
    };
  }
}
