import type { ExecuteOptions } from '@automaker/types';
import type { AgentCheckpointRepository } from '../../providers/openai-compatible/checkpoint.js';
import { prepareDirectExecution } from '../../providers/openai-compatible/execution.js';
import type { ProviderRegistry } from '../../modules/providers/provider-registry.service.js';
import { createChatOptions } from '../../lib/sdk-options.js';
import type { SettingsService } from '../settings-service.js';

/** One text-only preparation/normalization path. The caller owns session/jobs and event semantics. */
export class IdeationTextStream {
  constructor(
    private readonly providers: Pick<ProviderRegistry, 'providerForModel'>,
    private readonly settings: SettingsService | null,
    private readonly validateDirectory: (cwd: string) => void,
    private readonly hostEnvironment: Readonly<NodeJS.ProcessEnv>,
    private readonly checkpoints?: AgentCheckpointRepository
  ) {}

  async run(
    options: Omit<ExecuteOptions, 'systemPrompt'> & { systemPrompt?: string },
    providerId?: string,
    onPartial?: (text: string) => void
  ): Promise<string> {
    const model = options.originalModel ?? options.model;
    const sdk = createChatOptions({
      validateWorkingDirectory: this.validateDirectory,
      cwd: options.cwd,
      model,
      systemPrompt: options.systemPrompt,
      abortController: options.abortController,
    });
    const signal = options.abortController?.signal;
    signal?.throwIfAborted();
    const provider = this.providers.providerForModel(model);
    const prepared = await prepareDirectExecution(
      { ...options, systemPrompt: sdk.systemPrompt },
      this.settings,
      { model, providerId },
      'text',
      this.hostEnvironment,
      this.checkpoints
    );
    signal?.throwIfAborted();
    let text = '';
    for await (const message of provider.executeQuery(prepared)) {
      signal?.throwIfAborted();
      if (message.type === 'assistant' && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === 'text') {
            text += block.text;
            onPartial?.(text);
          }
        }
      } else if (message.type === 'result' && message.subtype === 'success' && message.result) {
        text = message.result;
      }
    }
    return text;
  }
}
