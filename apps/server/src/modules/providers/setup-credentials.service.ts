import type { SetupCommandValidation } from './setup-command.port.js';
import type { SetupCredentialTargetValue } from './verification.values.js';
import { RateLimitDomainError } from '../../core/errors/domain-errors.js';

import path from 'node:path';

import {
  ConflictDomainError,
  UnavailableDomainError,
  ValidationDomainError,
} from '../../core/errors/domain-errors.js';
import type { SettingsService } from '../../services/settings-service.js';
import type { ApplicationCredentialsService } from './application-credentials.service.js';
import type { ProviderConnectionRepository } from './provider-connection.repository.js';

export class SetupCredentialsService {
  private closing: Promise<void> | undefined;
  private readonly active = new Set<Promise<unknown>>();
  private readonly attempts = new Map<string, { count: number; until: number }>();
  constructor(
    private readonly credentials: ApplicationCredentialsService,
    private readonly settings: SettingsService,
    private readonly connections: ProviderConnectionRepository,
    private readonly validation: SetupCommandValidation
  ) {}
  private accepting() {
    if (this.closing) throw new UnavailableDomainError('Credential commands are shutting down.');
  }
  target(provider: unknown) {
    this.accepting();
    const parsed = this.validation.credentialProvider(provider);
    if (!parsed.success) throw new ValidationDomainError('Unsupported credential provider.');
    return {
      success: true as const,
      protocolVersion: 1 as const,
      target: {
        kind: 'application-credential' as const,
        provider: parsed.data,
        ...this.connections.hostIdentity(),
        credentialsPath: path.resolve(this.settings.getDataDirectory(), 'credentials.json'),
      },
    };
  }
  async change(operation: 'store' | 'delete', input: unknown, client: string) {
    this.accepting();
    const parsed = this.validation.credentialChange(operation, input);
    if (!parsed.success)
      throw new ValidationDomainError(
        'A confirmed credential target and valid input are required.'
      );
    const target: SetupCredentialTargetValue = parsed.data.target;
    const current = this.target(target.provider).target;
    if (
      Object.keys(current).some(
        (field) => current[field as keyof typeof current] !== target[field as keyof typeof target]
      )
    )
      throw new ConflictDomainError('Credential target changed. Inspect and confirm it again.');
    const now = Date.now();
    for (const [id, value] of this.attempts) if (value.until <= now) this.attempts.delete(id);
    const id = client.slice(0, 512),
      attempt = this.attempts.get(id) ?? { count: 0, until: now + 60000 };
    if (attempt.count >= 10 || (!this.attempts.has(id) && this.attempts.size >= 1000))
      throw new RateLimitDomainError('Too many credential changes.');
    if (this.active.size >= 16) throw new UnavailableDomainError('Credential commands are busy.');
    this.attempts.set(id, { ...attempt, count: attempt.count + 1 });
    const value =
      operation === 'store' && 'apiKey' in parsed.data && typeof parsed.data.apiKey === 'string'
        ? parsed.data.apiKey
        : null;
    const task = Promise.resolve().then(async () => {
      try {
        await this.credentials.change(target.provider, value);
      } catch {
        throw new UnavailableDomainError('Application credentials could not be updated.');
      }
      return {
        success: true as const,
        target,
        operation,
        configured: operation === 'store',
        storage: 'managed-credentials' as const,
      };
    });
    this.active.add(task);
    try {
      return await task;
    } finally {
      this.active.delete(task);
    }
  }
  beforeApplicationShutdown(): Promise<void> {
    this.closing ??= Promise.allSettled([...this.active]).then(() => undefined);
    return this.closing;
  }
}
