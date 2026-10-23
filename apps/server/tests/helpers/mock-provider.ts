/**
 * Mock Provider - No-op AI provider for E2E and CI testing
 *
 * Registered only by the Nest test composition; never included in production.
 */

import type { ExecuteOptions } from '@automaker/types';
import { BaseProvider } from '../../src/providers/base-provider.js';
import type {
  ProviderMessage,
  InstallationStatus,
  ModelDefinition,
} from '../../src/providers/types.js';

const MOCK_TEXT = 'Mock agent output for testing.';

export class MockProvider extends BaseProvider {
  constructor(
    private readonly providerName = 'mock',
    private readonly models?: ModelDefinition[]
  ) {
    super();
  }

  getName(): string {
    return this.providerName ?? 'mock';
  }

  async *executeQuery(_options: ExecuteOptions): AsyncGenerator<ProviderMessage> {
    yield {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: MOCK_TEXT }],
      },
    };
    yield {
      type: 'result',
      subtype: 'success',
    };
  }

  async detectInstallation(): Promise<InstallationStatus> {
    return {
      installed: true,
      method: 'sdk',
      hasApiKey: true,
      authenticated: true,
    };
  }

  getAvailableModels(): ModelDefinition[] {
    return (
      this.models ?? [
        {
          id: `${this.getName()}-mock-model`,
          name: 'Mock Model',
          modelString: `${this.getName()}-mock-model`,
          provider: this.getName(),
          description: 'Mock model for testing',
        },
      ]
    );
  }
}
