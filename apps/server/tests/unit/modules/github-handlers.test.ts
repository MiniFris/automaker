import { describe, expect, it, vi } from 'vitest';
import { GithubHandlersService } from '../../../src/modules/github/github-handlers.service.js';

describe('GithubHandlersService', () => {
  it('runs validation state queries behind the Nest boundary', async () => {
    const service = new GithubHandlersService({ emit: vi.fn() } as never, {} as never);
    const json = vi.fn();
    const response = {
      json,
      status: vi.fn().mockReturnThis(),
    };

    await service.run(
      'validationStatus',
      { body: { projectPath: '/project', issueNumber: 42 } } as never,
      response as never
    );

    expect(json).toHaveBeenCalledWith({
      success: true,
      isRunning: false,
      startedAt: undefined,
    });
  });
});
