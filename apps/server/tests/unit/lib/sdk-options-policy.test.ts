import { describe, expect, it, vi } from 'vitest';
import {
  createSpecGenerationOptions,
  createFeatureGenerationOptions,
  createSuggestionsOptions,
  createChatOptions,
  createAutoModeOptions,
  createCustomOptions,
} from '../../../src/lib/sdk-options.js';

describe('SDK builder application directory policy', () => {
  it.each([
    createSpecGenerationOptions,
    createFeatureGenerationOptions,
    createSuggestionsOptions,
    createChatOptions,
    createAutoModeOptions,
    createCustomOptions,
  ])('runs the injected validator before producing options (%#)', (build) => {
    const denied = new Error('application policy fixture');
    const validate = vi.fn(() => {
      throw denied;
    });
    expect(() => build({ cwd: '/outside/project', validateWorkingDirectory: validate })).toThrow(
      denied
    );
    expect(validate).toHaveBeenCalledExactlyOnceWith('/outside/project');
  });
});
