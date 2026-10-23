import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';
import { createProviderRegistrations } from '../../src/modules/providers/provider-registrations.js';
import { ProviderConnectionRepository } from '../../src/modules/providers/provider-connection.repository.js';
import type { SettingsService } from '../../src/services/settings-service.js';

/** Explicit real adapters for transport acceptance; tests can override the registry separately. */
export function createTestProviderRegistry(settings: SettingsService): ProviderRegistry {
  return new ProviderRegistry(
    createProviderRegistrations(settings),
    ProviderConnectionRepository.forWorkingDirectory(process.cwd())
  );
}
