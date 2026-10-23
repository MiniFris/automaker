import { Inject, Injectable } from '@nestjs/common';

import { ValidationDomainError } from '../../core/errors/index.js';
import { parseOpenAICompatibleEndpoint } from '../../providers/openai-compatible/config.js';
import { parseDirectAgentSettings } from '../../providers/openai-compatible/execution.js';
import { OpenAICompatibleError } from '../../providers/openai-compatible/errors.js';
import { SettingsService } from '../../services/settings-service.js';
import { SettingsQueryService } from './settings-query.service.js';

@Injectable()
export class DirectSettingsCommandService {
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(SettingsQueryService) private readonly queries: SettingsQueryService
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
