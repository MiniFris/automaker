import { TextDecoder } from 'node:util';
import type { ResolvedOpenAICompatibleConnection } from '@automaker/types';
import { modelTimeout, providerModelTimeouts, toDirectModelId } from '@automaker/types';

import { ValidationDomainError } from '../../core/errors/domain-errors.js';
import {
  normalizeOpenAICompatibleBaseUrl,
  parseOpenAICompatibleEndpoint,
  resolveOpenAICompatibleConnection,
} from '../../providers/openai-compatible/config.js';
import { parseDirectAgentSettings } from '../../providers/openai-compatible/execution.js';
import { OpenAICompatibleError } from '../../providers/openai-compatible/errors.js';
import { chatCompletion } from '../../providers/openai-compatible/transport.js';
import { SettingsService } from '../../services/settings-service.js';
import { SettingsQueryService } from './settings-query.service.js';

export class DirectSettingsCommandService {
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly settings: SettingsService,
    private readonly queries: SettingsQueryService
  ) {}

  updateEndpoint(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.serialized(async () => {
      try {
        if (Object.keys(body).some((key) => !['endpoint', 'apiKey', 'clearKey'].includes(key))) {
          throw new OpenAICompatibleError('Unknown endpoint update field.');
        }
        const endpoint = parseOpenAICompatibleEndpoint(body.endpoint);
        if (
          body.apiKey !== undefined &&
          (typeof body.apiKey !== 'string' ||
            !body.apiKey.trim() ||
            /[\x00-\x1f\x7f]/.test(body.apiKey))
        ) {
          throw new OpenAICompatibleError('Invalid API key.');
        }
        if (body.clearKey !== undefined && typeof body.clearKey !== 'boolean') {
          throw new OpenAICompatibleError('Invalid clearKey flag.');
        }
        if (body.apiKey !== undefined && body.clearKey) {
          throw new OpenAICompatibleError('Choose either replacing or clearing the key.');
        }
        if ((body.apiKey !== undefined || body.clearKey) && endpoint.auth.type !== 'credentials') {
          throw new OpenAICompatibleError('Key updates require credentials authentication.');
        }

        const global = await this.settings.getGlobalSettings();
        const endpoints = [...(global.openaiCompatibleEndpoints ?? [])];
        const index = endpoints.findIndex((item) => item.id === endpoint.id);
        if (index < 0) endpoints.push(endpoint);
        else endpoints[index] = endpoint;
        if (endpoint.auth.type === 'credentials' && (body.apiKey !== undefined || body.clearKey)) {
          await this.settings.updateCredentials({
            openaiCompatibleApiKeys: {
              [endpoint.auth.credentialId]: body.clearKey ? '' : (body.apiKey as string).trim(),
            },
          });
        }
        await this.settings.updateGlobalSettings({ openaiCompatibleEndpoints: endpoints });
        return this.queries.openAICompatible();
      } catch (error) {
        throw this.validationError(error);
      }
    });
  }

  remove(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.serialized(async () => {
      try {
        if (Object.keys(body).some((key) => key !== 'providerId')) {
          throw new OpenAICompatibleError('Unknown endpoint removal field.');
        }
        if (typeof body.providerId !== 'string') {
          throw new OpenAICompatibleError('Endpoint providerId is required.');
        }
        const global = await this.settings.getGlobalSettings();
        const removed = global.openaiCompatibleEndpoints?.find(
          (item) => item.id === body.providerId
        );
        if (!removed) throw new OpenAICompatibleError('Endpoint not found.');
        await this.settings.updateGlobalSettings({
          openaiCompatibleEndpoints: global.openaiCompatibleEndpoints!.filter(
            (item) => item.id !== removed.id
          ),
        });
        return this.queries.openAICompatible();
      } catch (error) {
        throw this.validationError(error);
      }
    });
  }

  updateAgent(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.serialized(async () => {
      try {
        const agentSettings = parseDirectAgentSettings(body);
        await this.settings.updateGlobalSettings({ openaiCompatibleAgentSettings: agentSettings });
        return this.queries.openAICompatible();
      } catch (error) {
        throw this.validationError(error);
      }
    });
  }

  async discoverModels(
    body: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<Record<string, unknown>> {
    try {
      const config = await this.connection(body.providerId);
      let response: globalThis.Response | undefined;
      try {
        response = await fetch(
          new URL('models', normalizeOpenAICompatibleBaseUrl(config.baseUrl)),
          {
            headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
            redirect: 'manual',
            signal: AbortSignal.any([
              signal,
              AbortSignal.timeout(
                config.timeouts?.modelDiscoveryTimeoutMs ??
                  Math.min(config.timeoutMs, modelTimeout(undefined, 'modelDiscoveryTimeoutMs'))
              ),
            ]),
          }
        );
        if (!response.ok || !response.body) {
          throw new OpenAICompatibleError(
            `Model catalog request failed (HTTP ${response.status}).`
          );
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const read = await reader.read();
            if (read.done) break;
            size += read.value.length;
            if (size > 1024 * 1024) throw new OpenAICompatibleError('Model catalog exceeds 1 MiB.');
            chunks.push(read.value);
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        const data = (
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as {
            data?: unknown;
          }
        ).data;
        if (!Array.isArray(data) || data.length > 2000) {
          throw new OpenAICompatibleError('Invalid model catalog.');
        }
        const models = data.map((value: unknown) => {
          const id = (value as { id?: unknown })?.id;
          if (
            typeof id !== 'string' ||
            !id ||
            id !== id.trim() ||
            id.length > 4096 ||
            /[\x00-\x1f\x7f]/.test(id)
          ) {
            throw new OpenAICompatibleError('Invalid model catalog ID.');
          }
          return id;
        });
        return { success: true, models: [...new Set(models)] };
      } finally {
        await response?.body?.cancel().catch(() => {});
      }
    } catch (error) {
      throw this.validationError(error);
    }
  }

  async testConnection(
    body: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<Record<string, unknown>> {
    try {
      if (
        typeof body.modelId !== 'string' ||
        !body.modelId ||
        (body.tools !== undefined && typeof body.tools !== 'boolean')
      ) {
        throw new OpenAICompatibleError('Choose a configured model and a boolean tool-test flag.');
      }
      const config = await this.connection(body.providerId, body.modelId);
      if (config.protocol !== 'chat-completions') {
        throw new OpenAICompatibleError('Responses is not implemented yet.');
      }
      const withTools = body.tools === true;
      if (withTools && !config.model.capabilities.tools) {
        throw new OpenAICompatibleError('Enable tools for this model before testing tool calling.');
      }
      let verified = false;
      for await (const event of chatCompletion(
        {
          ...config,
          maxRetries: 0,
          timeoutMs:
            config.timeouts?.connectionTestTimeoutMs ??
            Math.min(config.timeoutMs, modelTimeout(undefined, 'connectionTestTimeoutMs')),
          model: {
            ...config.model,
            maxOutputTokens: Math.min(128, config.model.maxOutputTokens ?? 128),
          },
        },
        {
          stream: config.model.capabilities.streaming,
          messages: [
            {
              role: 'user',
              content: withTools
                ? 'Call automaker_connection_check with marker "ok". Do not use any other tool.'
                : 'Reply with OK.',
            },
          ],
          ...(withTools && {
            tools: [
              {
                type: 'function' as const,
                function: {
                  name: 'automaker_connection_check',
                  description: 'Harmless connection check. No filesystem or shell effects.',
                  parameters: {
                    type: 'object',
                    properties: { marker: { type: 'string', enum: ['ok'] } },
                    required: ['marker'],
                    additionalProperties: false,
                  },
                },
              },
            ],
          }),
        },
        signal
      )) {
        if (event.type !== 'complete') continue;
        if (!withTools) {
          verified = event.completion.finishReason === 'stop' && !!event.completion.text.trim();
          continue;
        }
        const call =
          event.completion.toolCalls.length === 1 && event.completion.finishReason === 'tool_calls'
            ? event.completion.toolCalls[0]
            : undefined;
        let normalizedArguments: string | null = null;
        if (
          call?.function.name === 'automaker_connection_check' &&
          call.function.arguments.length < 256
        ) {
          try {
            normalizedArguments = JSON.stringify(JSON.parse(call.function.arguments));
          } catch {
            // Malformed tool arguments fail verification.
          }
        }
        verified = normalizedArguments === '{"marker":"ok"}';
      }
      if (!verified) {
        throw new OpenAICompatibleError(
          'Endpoint did not return the expected complete text/tool response.'
        );
      }
      return { success: true, verified: true, tools: withTools };
    } catch (error) {
      throw this.validationError(error);
    }
  }

  private async connection(
    providerId: unknown,
    modelId?: unknown
  ): Promise<ResolvedOpenAICompatibleConnection> {
    if (typeof providerId !== 'string') {
      throw new OpenAICompatibleError('Endpoint providerId is required.');
    }
    const [global, credentials] = await Promise.all([
      this.settings.getGlobalSettings(),
      this.settings.getCredentials(),
    ]);
    const endpoint = global.openaiCompatibleEndpoints?.find((item) => item.id === providerId);
    if (!endpoint) throw new OpenAICompatibleError('Endpoint not found.');
    const model =
      modelId === undefined
        ? {
            id: '__catalog__',
            displayName: 'Catalog',
            capabilities: { tools: false, streaming: false },
          }
        : endpoint.models.find((item) => item.id === modelId);
    if (!model) throw new OpenAICompatibleError('Choose an explicitly configured model.');
    return resolveOpenAICompatibleConnection({
      endpoints: [{ ...endpoint, enabled: true, models: [model] }],
      credentials,
      modelTimeouts: providerModelTimeouts(global, 'openai-compatible'),
      providerId,
      model: toDirectModelId(model.id),
    });
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writes.then(operation);
    this.writes = next.catch(() => {});
    return next;
  }

  private validationError(error: unknown): ValidationDomainError {
    return new ValidationDomainError(
      error instanceof OpenAICompatibleError
        ? error.message
        : 'Invalid or unavailable OpenAI-compatible configuration.'
    );
  }
}
