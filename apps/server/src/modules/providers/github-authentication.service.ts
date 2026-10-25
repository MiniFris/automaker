import type { SetupCommandValidation } from './setup-command.port.js';
import type { GithubAuthenticationResult } from './verification.values.js';
import { RateLimitDomainError } from '../../core/errors/domain-errors.js';

import type { SetupStatusRuntime } from '../../core/platform/setup-status.runtime.js';
import {
  ConflictDomainError,
  UnavailableDomainError,
  ValidationDomainError,
} from '../../core/errors/domain-errors.js';
import type { ProviderConnectionRepository } from './provider-connection.repository.js';

export class GithubAuthenticationService {
  private closing: Promise<void> | undefined;
  private readonly active = new Set<Promise<unknown>>();
  private readonly attempts = new Map<string, { count: number; until: number }>();
  constructor(
    private readonly runtime: SetupStatusRuntime,

    private readonly connections: ProviderConnectionRepository,
    private readonly environment: Readonly<NodeJS.ProcessEnv>,
    private readonly validation: SetupCommandValidation
  ) {}
  private accepting() {
    if (this.closing) throw new UnavailableDomainError('GitHub authentication is shutting down.');
  }
  async target() {
    this.accepting();
    const hostname = this.environment.GH_HOST || 'github.com';
    if (!/^[A-Za-z0-9][A-Za-z0-9.:-]{0,254}$/.test(hostname))
      throw new UnavailableDomainError('GitHub hostname configuration is invalid.');
    const { instanceId, workingDirectory } = this.connections.hostIdentity();
    const cli = await this.runtime.detect('gh');
    this.accepting();
    return {
      success: true as const,
      protocolVersion: 1 as const,
      target: {
        kind: 'host-github-authentication' as const,
        provider: 'github' as const,
        instanceId,
        workingDirectory,
        cliPath: cli.installed && cli.path ? cli.path : null,
        hostname,
      },
    };
  }
  async verify(input: unknown, client: string): Promise<GithubAuthenticationResult> {
    this.accepting();
    const parsed = this.validation.github(input);
    if (!parsed.success)
      throw new ValidationDomainError('An explicitly confirmed GitHub target is required.');
    const now = Date.now();
    for (const [id, value] of this.attempts) if (value.until <= now) this.attempts.delete(id);
    const id = client.slice(0, 512);
    const attempt = this.attempts.get(id) ?? { count: 0, until: now + 60000 };
    if (attempt.count >= 5 || (!this.attempts.has(id) && this.attempts.size >= 1000))
      throw new RateLimitDomainError('Too many GitHub authentication checks.');
    if (this.active.size >= 4) throw new UnavailableDomainError('GitHub authentication is busy.');
    this.attempts.set(id, { ...attempt, count: attempt.count + 1 });
    const task = Promise.resolve().then(async () => {
      const target = (await this.target()).target;
      if (
        Object.keys(target).some(
          (key) =>
            target[key as keyof typeof target] !== parsed.data.target[key as keyof typeof target]
        )
      )
        throw new ConflictDomainError('GitHub target changed. Inspect and confirm it again.');
      let auth: { authenticated: boolean; user: string | null };
      try {
        auth = target.cliPath
          ? await this.runtime.githubAuthentication(target.cliPath)
          : { authenticated: false, user: null };
      } catch {
        throw new UnavailableDomainError('GitHub authentication could not be checked.');
      }
      // Never echo raw CLI output or accept an account-less success.
      const user =
        auth.authenticated &&
        typeof auth.user === 'string' &&
        /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(auth.user) &&
        auth.user !== 'null'
          ? auth.user
          : null;
      return {
        success: true as const,
        target,
        authenticationChecked: true as const,
        authenticated: user !== null,
        user,
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
    if (!this.closing) {
      let finish!: () => void;
      this.closing = new Promise<void>((resolve) => {
        finish = resolve;
      });
      void Promise.allSettled([...this.active]).then(finish);
    }
    return this.closing;
  }
}
