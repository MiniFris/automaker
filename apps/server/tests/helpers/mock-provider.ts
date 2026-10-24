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
  protected featureCapabilities() {
    return { vision: true, tools: true, reasoning: true };
  }
  constructor(
    private readonly providerName = 'mock',
    private readonly models?: ModelDefinition[],
    private readonly holdPrompt?: string
  ) {
    super();
  }

  getName(): string {
    return this.providerName ?? 'mock';
  }

  protected async *execute(_options: ExecuteOptions): AsyncGenerator<ProviderMessage> {
    const hold = this.holdPrompt !== undefined && _options.prompt === this.holdPrompt;
    const signal = _options.abortController?.signal;
    let release!: () => void;
    const stopped = new Promise<void>((resolve) => {
      release = resolve;
    });
    if (hold) {
      if (signal?.aborted) release();
      else signal?.addEventListener('abort', release, { once: true });
    }
    try {
      yield {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: MOCK_TEXT }],
        },
      };
      if (hold) {
        await stopped;
        return;
      }
      yield {
        type: 'result',
        subtype: 'success',
      };
    } finally {
      if (hold) signal?.removeEventListener('abort', release);
    }
  }

  async detectInstallation(): Promise<InstallationStatus> {
    return {
      installed: true,
      method: 'sdk',
      hasApiKey: true,
      authenticated: true,
    };
  }

  async isInstalled(): Promise<boolean> {
    return true;
  }

  async getVersion(): Promise<string | null> {
    return 'test-fixture';
  }

  getCliPath(): string | null {
    return '/test-only/cli';
  }

  async checkAuth() {
    return { authenticated: true, method: 'test-fixture' };
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
