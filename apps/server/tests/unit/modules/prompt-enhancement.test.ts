import { describe, expect, it, vi } from 'vitest';

import { PromptEnhancementService } from '../../../src/modules/prompt-enhancement/prompt-enhancement.service.js';

describe('PromptEnhancementService', () => {
  it('normalizes an unknown mode and executes a read-only provider query', async () => {
    const settings = {
      getGlobalSettings: vi.fn().mockResolvedValue({}),
      getCredentials: vi.fn().mockResolvedValue({}),
    };
    const features = { getAll: vi.fn().mockResolvedValue([]) };
    const query = vi.fn().mockResolvedValue({ text: '  Improved prompt  ' });
    const service = new PromptEnhancementService(settings as never, features as never, query, {
      workingDirectory: '/workspace',
    } as never);

    await expect(
      service.enhance({ originalText: '  Draft  ', enhancementMode: 'unknown' })
    ).resolves.toEqual({ success: true, enhancedText: 'Improved prompt' });
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        readOnly: true,
        allowedTools: [],
        maxTurns: 1,
      })
    );
  });

  it('rejects whitespace input before invoking a provider', async () => {
    const query = vi.fn();
    const service = new PromptEnhancementService({} as never, {} as never, query, {} as never);

    await expect(
      service.enhance({ originalText: '   ', enhancementMode: 'improve' })
    ).rejects.toThrow('originalText cannot be empty');
    expect(query).not.toHaveBeenCalled();
  });
});
