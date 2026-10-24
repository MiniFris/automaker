import { Injectable } from '@nestjs/common';

/** Transitional setup-wizard cache. Persistence/runtime effects remain with setup commands. */
@Injectable()
export class SetupCredentialCache {
  private readonly keys = new Map<string, string>();
  private readonly environmentOverrides = new Map<string, boolean>();

  get(provider: string): string | undefined {
    return this.keys.get(provider);
  }

  set(provider: string, key: string): void {
    if (key) this.keys.set(provider, key);
    else this.keys.delete(provider);
  }

  setEnvironmentConfigured(name: string, configured: boolean): void {
    this.environmentOverrides.set(name, configured);
  }

  isEnvironmentConfigured(name: string, bootstrapValue: boolean): boolean {
    return this.environmentOverrides.get(name) ?? bootstrapValue;
  }
}
