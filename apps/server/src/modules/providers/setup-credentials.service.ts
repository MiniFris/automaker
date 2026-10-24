import { Inject, Injectable, HttpException } from '@nestjs/common';
import path from 'node:path';
import {
  SetupCredentialProviderSchema,
  SetupCredentialStoreRequestSchema,
  SetupCredentialDeleteRequestSchema,
  type SetupCredentialTarget,
} from '@automaker/contracts';
import {
  ConflictDomainError,
  UnavailableDomainError,
  ValidationDomainError,
} from '../../core/errors/index.js';
import { SettingsService } from '../../services/settings-service.js';
import { ApplicationCredentialsService } from './application-credentials.service.js';
import { ProviderConnectionRepository } from './provider-connection.repository.js';

@Injectable()
export class SetupCredentialsService {
  private closing: Promise<void> | undefined;
  private readonly active = new Set<Promise<unknown>>();
  private readonly attempts = new Map<string, { count: number; until: number }>();
  constructor(
    @Inject(ApplicationCredentialsService)
    private readonly credentials: ApplicationCredentialsService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(ProviderConnectionRepository) private readonly connections: ProviderConnectionRepository
  ) {}
  private accepting() {
    if (this.closing) throw new UnavailableDomainError('Credential commands are shutting down.');
  }
  target(provider: unknown) {
    this.accepting();
    const parsed = SetupCredentialProviderSchema.safeParse(provider);
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
    const parsed = (
      operation === 'store' ? SetupCredentialStoreRequestSchema : SetupCredentialDeleteRequestSchema
    ).safeParse(input);
    if (!parsed.success)
      throw new ValidationDomainError(
        'A confirmed credential target and valid input are required.'
      );
    const target: SetupCredentialTarget = parsed.data.target;
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
      throw new HttpException('Too many credential changes.', 429);
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
