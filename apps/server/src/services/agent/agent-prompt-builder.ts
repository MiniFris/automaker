import { isDirectModel } from '@automaker/types';
import {
  readImageAsBase64,
  buildPromptWithImages,
  loadContextFiles,
  createLogger,
} from '@automaker/utils';
import * as secureFs from '../../lib/secure-fs.js';
import { filterClaudeMdFromContext, getPromptCustomization } from '../../lib/settings-helpers.js';
import type { ExecuteOptions } from '../../providers/types.js';
import type { SettingsService } from '../settings-service.js';
import type { Message } from './agent-session.types.js';

const logger = createLogger('AgentPromptBuilder');

/** Owns prompt text/attachments, never provider choice or execution bindings. */
export class AgentPromptBuilder {
  async readImages(
    paths: readonly string[] | undefined,
    signal: AbortSignal
  ): Promise<NonNullable<Message['images']>> {
    signal.throwIfAborted();
    const images: NonNullable<Message['images']> = [];
    for (const file of paths ?? []) {
      signal.throwIfAborted();
      try {
        const image = await readImageAsBase64(file);
        images.push({ data: image.base64, mimeType: image.mimeType, filename: image.filename });
      } catch (error) {
        if (signal.aborted) throw error;
        logger.error(`Failed to load image ${file}:`, error);
      }
      signal.throwIfAborted();
    }
    return images;
  }

  async systemPrompt(input: {
    workingDirectory: string;
    message: string;
    autoLoadClaudeMd: boolean;
    requestedModel?: string;
    remoteContext: boolean;
    settings: SettingsService | null;
    signal: AbortSignal;
  }): Promise<string> {
    input.signal.throwIfAborted();
    // Controller source/memory must not be read or initialized for managed execution.
    const context = input.remoteContext
      ? undefined
      : await loadContextFiles({
          projectPath: input.workingDirectory,
          fsModule: secureFs as Parameters<typeof loadContextFiles>[0]['fsModule'],
          taskContext: { title: input.message.substring(0, 200), description: input.message },
        });
    input.signal.throwIfAborted();
    const contextPrompt = context
      ? filterClaudeMdFromContext(
          context,
          input.autoLoadClaudeMd && !isDirectModel(input.requestedModel ?? '')
        )
      : '';
    // No cache: customized prompts are deliberately hot-reloaded between messages.
    const prompts = await getPromptCustomization(input.settings, '[AgentService]');
    input.signal.throwIfAborted();
    return contextPrompt
      ? `${contextPrompt}\n\n${prompts.agent.systemPrompt}`
      : prompts.agent.systemPrompt;
  }

  history(messages: readonly Message[]): ExecuteOptions['conversationHistory'] {
    const history = messages
      .slice(0, -1)
      .map(({ role, content }) => ({ role, content }))
      .filter(({ content }) => content.trim().length > 0);
    return history.length ? history : undefined;
  }

  async content(
    message: string,
    imagePaths: string[] | undefined,
    signal: AbortSignal
  ): Promise<ExecuteOptions['prompt']> {
    signal.throwIfAborted();
    const { content } = await buildPromptWithImages(message, imagePaths, undefined, true);
    signal.throwIfAborted();
    return content;
  }

  appendContext(
    base: ExecuteOptions['systemPrompt'],
    context: string
  ): ExecuteOptions['systemPrompt'] {
    return typeof base === 'object'
      ? { ...base, append: [base.append, context].filter(Boolean).join('\n\n') }
      : [base, context].filter(Boolean).join('\n\n');
  }
}
