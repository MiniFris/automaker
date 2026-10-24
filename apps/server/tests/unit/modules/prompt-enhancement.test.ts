import { describe, expect, it, vi } from 'vitest';

import { PromptEnhancementService } from '../../../src/modules/prompt-enhancement/prompt-enhancement.service.js';
import { ForbiddenDomainError } from '../../../src/core/errors/index.js';

describe('PromptEnhancementService', () => {
  it('normalizes an unknown mode and executes a read-only provider query', async () => {
    const settings = {
      getGlobalSettings: vi.fn().mockResolvedValue({}),
      getCredentials: vi.fn().mockResolvedValue({}),
    };
    const query = vi.fn().mockResolvedValue({ text: '  Improved prompt  ' });
    const service = new PromptEnhancementService(
      settings as never,
      query,
      {
        workingDirectory: '/workspace',
      } as never,
      {} as never
    );

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
    const service = new PromptEnhancementService({} as never, query, {} as never, {} as never);

    await expect(
      service.enhance({ originalText: '   ', enhancementMode: 'improve' })
    ).rejects.toThrow('originalText cannot be empty');
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    new ForbiddenDomainError(),
    Object.assign(new Error('Filesystem is closing.'), { code: 'FILESYSTEM_CLOSED' }),
  ])('rejects a denied/unavailable context before invoking a provider', async (error) => {
    const query = vi.fn();
    const filesystem = { readFile: vi.fn().mockRejectedValue(error) };
    const service = new PromptEnhancementService(
      {
        getGlobalSettings: vi.fn().mockResolvedValue({}),
      } as never,
      query,
      {} as never,
      filesystem as never
    );
    await expect(
      service.enhance({
        originalText: 'Draft',
        enhancementMode: 'improve',
        projectPath: '/project',
      })
    ).rejects.toMatchObject({ statusCode: error instanceof ForbiddenDomainError ? 403 : 503 });
    expect(filesystem.readFile).toHaveBeenCalledWith('/project/.automaker/app_spec.txt', 'utf-8');
    expect(query).not.toHaveBeenCalled();
  });
});
