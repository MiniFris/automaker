/**
 * Abstract base class for AI model providers
 */

import type {
  ProviderConfig,
  ExecuteOptions,
  ProviderMessage,
  InstallationStatus,
  ValidationResult,
  ModelDefinition,
} from './types.js';
import type {
  ModelCapabilities,
  ProviderAdapter,
  ProviderCapabilities,
} from './provider-contract.js';

/**
 * Base provider class that all provider implementations must extend
 */
export abstract class BaseProvider implements ProviderAdapter {
  protected config: ProviderConfig;
  protected name: string;

  constructor(config: ProviderConfig = {}) {
    this.config = config;
    this.name = this.getName();
  }

  /**
   * Get the provider name (e.g., "claude", "cursor")
   */
  abstract getName(): string;

  /**
   * Execute a query and stream responses
   * @param options Execution options
   * @returns AsyncGenerator yielding provider messages
   */
  abstract executeQuery(options: ExecuteOptions): AsyncGenerator<ProviderMessage>;

  /**
   * Detect if the provider is installed and configured
   * @returns Installation status
   */
  abstract detectInstallation(): Promise<InstallationStatus>;

  /**
   * Get available models for this provider
   * @returns Array of model definitions
   */
  abstract getAvailableModels(): ModelDefinition[];

  getCapabilities(): ProviderCapabilities {
    const models = this.getAvailableModels();
    return Object.freeze({
      text: true,
      streaming: true,
      vision: models.some((model) => model.supportsVision === true),
      tools: this.supportsFeature('tools') || models.some((model) => model.supportsTools === true),
      reasoning: models.some((model) => model.hasReasoning === true),
      mcp: this.supportsFeature('mcp'),
      remoteExecution: this.supportsFeature('remoteExecution'),
      followUp: true,
      cancellation: true,
    });
  }

  getModelCapabilities(modelId: string): ModelCapabilities {
    const normalized = modelId.toLowerCase();
    const model = this.getAvailableModels().find((candidate) => {
      const id = candidate.id.toLowerCase();
      const modelString = candidate.modelString.toLowerCase();
      return (
        id === normalized ||
        modelString === normalized ||
        id.endsWith(`-${normalized}`) ||
        modelString.endsWith(`-${normalized}`)
      );
    });
    return Object.freeze({
      vision: model?.supportsVision === true,
      tools: model?.supportsTools === true,
      reasoning: model?.hasReasoning === true,
    });
  }

  start(options: ExecuteOptions): AsyncGenerator<ProviderMessage> {
    return this.executeQuery(options);
  }

  followUp(options: ExecuteOptions): AsyncGenerator<ProviderMessage> {
    return this.executeQuery(options);
  }

  cancel(controller: AbortController): void {
    controller.abort();
  }

  async dispose(): Promise<void> {}

  /**
   * Validate the provider configuration
   * @returns Validation result
   */
  validateConfig(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Base validation (can be overridden)
    if (!this.config) {
      errors.push('Provider config is missing');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Check if the provider supports a specific feature
   * @param feature Feature name (e.g., "vision", "tools", "mcp")
   * @returns Whether the feature is supported
   */
  supportsFeature(feature: string): boolean {
    // Default implementation - override in subclasses
    const commonFeatures = ['tools', 'text'];
    return commonFeatures.includes(feature);
  }

  /**
   * Get provider configuration
   */
  getConfig(): ProviderConfig {
    return this.config;
  }

  /**
   * Update provider configuration
   */
  setConfig(config: Partial<ProviderConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
