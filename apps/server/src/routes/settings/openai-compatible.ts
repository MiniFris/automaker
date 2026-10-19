import { Router } from 'express';
import { TextDecoder } from 'node:util';
import type {
  DirectAgentSettings,
  OpenAICompatibleEndpointStatus,
  ResolvedOpenAICompatibleConnection,
} from '@automaker/types';
import { toDirectModelId, modelTimeout, providerModelTimeouts } from '@automaker/types';
import type { SettingsService } from '../../services/settings-service.js';
import {
  normalizeOpenAICompatibleBaseUrl,
  parseOpenAICompatibleEndpoint,
  resolveOpenAICompatibleConnection,
} from '../../providers/openai-compatible/config.js';
import { parseDirectAgentSettings } from '../../providers/openai-compatible/execution.js';
import { chatCompletion } from '../../providers/openai-compatible/transport.js';
import { OpenAICompatibleError } from '../../providers/openai-compatible/errors.js';

export async function directSettingsDto(
  settings: SettingsService
): Promise<{ endpoints: OpenAICompatibleEndpointStatus[]; agentSettings: DirectAgentSettings }> {
  const [global, credentials] = await Promise.all([
    settings.getGlobalSettings(),
    settings.getCredentials(),
  ]);
  return {
    endpoints: (global.openaiCompatibleEndpoints ?? []).map((value) => {
      const endpoint = parseOpenAICompatibleEndpoint(value);
      const key =
        endpoint.auth.type === 'credentials'
          ? credentials.openaiCompatibleApiKeys?.[endpoint.auth.credentialId]
          : endpoint.auth.type === 'env'
            ? process.env[endpoint.auth.variableName]
            : undefined;
      return {
        endpoint,
        keyConfigured: endpoint.auth.type === 'none' || (typeof key === 'string' && !!key.trim()),
      };
    }),
    agentSettings: parseDirectAgentSettings(global.openaiCompatibleAgentSettings ?? {}),
  };
}

async function connection(
  settings: SettingsService,
  providerId: unknown,
  modelId?: unknown
): Promise<ResolvedOpenAICompatibleConnection> {
  if (typeof providerId !== 'string')
    throw new OpenAICompatibleError('Endpoint providerId is required.');
  const [global, credentials] = await Promise.all([
    settings.getGlobalSettings(),
    settings.getCredentials(),
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

/** GET /models is discovery only: never infer tools, vision, context limits or protocol from IDs. */
export async function discoverDirectModels(
  config: ResolvedOpenAICompatibleConnection,
  signal: AbortSignal
): Promise<string[]> {
  let response: globalThis.Response | undefined;
  try {
    response = await fetch(new URL('models', normalizeOpenAICompatibleBaseUrl(config.baseUrl)), {
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      redirect: 'manual',
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(
          config.timeouts?.modelDiscoveryTimeoutMs ??
            Math.min(config.timeoutMs, modelTimeout(undefined, 'modelDiscoveryTimeoutMs'))
        ),
      ]),
    });
    if (!response.ok || !response.body)
      throw new OpenAICompatibleError(`Model catalog request failed (HTTP ${response.status}).`);
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
    const parsed: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
    );
    const data = (parsed as { data?: unknown })?.data;
    if (!Array.isArray(data) || data.length > 2000)
      throw new OpenAICompatibleError('Invalid model catalog.');
    const ids = data.map((value: unknown) => {
      const id = (value as { id?: unknown })?.id;
      if (
        typeof id !== 'string' ||
        !id ||
        id !== id.trim() ||
        id.length > 4096 ||
        /[\x00-\x1f\x7f]/.test(id)
      )
        throw new OpenAICompatibleError('Invalid model catalog ID.');
      return id;
    });
    return [...new Set(ids)];
  } catch (error) {
    if (error instanceof OpenAICompatibleError) throw error;
    throw new OpenAICompatibleError('Model catalog unavailable, invalid, or timed out.');
  } finally {
    await response?.body?.cancel().catch(() => {});
  }
}

/** Mounted behind the same authenticated settings boundary as existing provider settings. */
export function createOpenAICompatibleSettingsRoutes(settings: SettingsService): Router {
  const router = Router();
  let writes = Promise.resolve();
  const serialized = <T>(operation: () => Promise<T>) => {
    const next = writes.then(operation);
    writes = next.then(
      () => {},
      () => {}
    );
    return next;
  };
  const handle =
    (action: (body: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>) =>
    async (req: import('express').Request, res: import('express').Response) => {
      const controller = new AbortController();
      const close = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.on('close', close);
      // Network actions have their own saved deadlines. A hidden route-wide 30s timer
      // must not shorten user-configured catalog/test timeouts.
      const signal = controller.signal;
      try {
        res.json({ success: true, ...((await action(req.body ?? {}, signal)) as object) });
      } catch (error) {
        // Never echo request bodies, keys, upstream payloads or unexpected exception messages.
        res.status(400).json({
          success: false,
          error:
            error instanceof OpenAICompatibleError
              ? error.message
              : 'Invalid or unavailable OpenAI-compatible configuration.',
        });
      } finally {
        res.off('close', close);
      }
    };
  router.get(
    '/',
    handle(async () => directSettingsDto(settings))
  );
  router.put(
    '/endpoint',
    handle(async (body) =>
      serialized(async () => {
        if (Object.keys(body).some((key) => !['endpoint', 'apiKey', 'clearKey'].includes(key)))
          throw new OpenAICompatibleError('Unknown endpoint update field.');
        const endpoint = parseOpenAICompatibleEndpoint(body.endpoint);
        if (
          body.apiKey !== undefined &&
          (typeof body.apiKey !== 'string' ||
            !body.apiKey.trim() ||
            /[\x00-\x1f\x7f]/.test(body.apiKey))
        )
          throw new OpenAICompatibleError('Invalid API key.');
        if (body.clearKey !== undefined && typeof body.clearKey !== 'boolean')
          throw new OpenAICompatibleError('Invalid clearKey flag.');
        if (body.apiKey !== undefined && body.clearKey)
          throw new OpenAICompatibleError('Choose either replacing or clearing the key.');
        if ((body.apiKey !== undefined || body.clearKey) && endpoint.auth.type !== 'credentials')
          throw new OpenAICompatibleError('Key updates require credentials authentication.');
        const global = await settings.getGlobalSettings();
        const endpoints = [...(global.openaiCompatibleEndpoints ?? [])];
        const index = endpoints.findIndex((item) => item.id === endpoint.id);
        if (index < 0) endpoints.push(endpoint);
        else endpoints[index] = endpoint;
        if (endpoint.auth.type === 'credentials' && (body.apiKey !== undefined || body.clearKey))
          await settings.updateCredentials({
            openaiCompatibleApiKeys: {
              [endpoint.auth.credentialId]: body.clearKey ? '' : (body.apiKey as string).trim(),
            },
          });
        await settings.updateGlobalSettings({ openaiCompatibleEndpoints: endpoints });
        return directSettingsDto(settings);
      })
    )
  );
  router.post(
    '/remove',
    handle(async (body) =>
      serialized(async () => {
        if (typeof body.providerId !== 'string')
          throw new OpenAICompatibleError('Endpoint providerId is required.');
        const global = await settings.getGlobalSettings();
        const removed = global.openaiCompatibleEndpoints?.find(
          (item) => item.id === body.providerId
        );
        if (!removed) throw new OpenAICompatibleError('Endpoint not found.');
        // Secrets are not deleted here: references can be shared; removal must not break another endpoint.
        await settings.updateGlobalSettings({
          openaiCompatibleEndpoints: global.openaiCompatibleEndpoints!.filter(
            (item) => item.id !== removed.id
          ),
        });
        return directSettingsDto(settings);
      })
    )
  );
  router.put(
    '/agent',
    handle(async (body) =>
      serialized(async () => {
        const agentSettings = parseDirectAgentSettings(body);
        await settings.updateGlobalSettings({ openaiCompatibleAgentSettings: agentSettings });
        return directSettingsDto(settings);
      })
    )
  );
  router.post(
    '/models',
    handle(async (body, signal) => ({
      models: await discoverDirectModels(await connection(settings, body.providerId), signal),
    }))
  );
  router.post(
    '/test',
    handle(async (body, signal) => {
      if (
        typeof body.modelId !== 'string' ||
        !body.modelId ||
        (body.tools !== undefined && typeof body.tools !== 'boolean')
      )
        throw new OpenAICompatibleError('Choose a configured model and a boolean tool-test flag.');
      const config = await connection(settings, body.providerId, body.modelId);
      if (config.protocol !== 'chat-completions')
        throw new OpenAICompatibleError('Responses is not implemented yet.');
      const withTools = body.tools === true;
      if (withTools && !config.model.capabilities.tools)
        throw new OpenAICompatibleError('Enable tools for this model before testing tool calling.');
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
                type: 'function',
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
        if (event.type === 'complete') {
          if (!withTools) {
            verified = event.completion.finishReason === 'stop' && !!event.completion.text.trim();
          } else {
            const call =
              event.completion.toolCalls.length === 1 &&
              event.completion.finishReason === 'tool_calls'
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
                // malformed tool arguments fail verification instead of throwing
              }
            }
            verified = normalizedArguments === '{"marker":"ok"}';
          }
        }
      }
      if (!verified)
        throw new OpenAICompatibleError(
          'Endpoint did not return the expected complete text/tool response.'
        );
      return { verified: true, tools: withTools };
    })
  );
  return router;
}
