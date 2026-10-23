import { describe, expect, it, vi } from 'vitest';
import { AutoModeHandlersService } from '../../../src/modules/auto-mode/auto-mode-handlers.service.js';

describe('AutoModeHandlersService', () => {
  it('delegates status to the shared coordinator instance', async () => {
    const autoMode = {
      getStatus: vi.fn().mockReturnValue({ isRunning: false }),
      getActiveAutoLoopProjects: vi.fn().mockReturnValue([]),
      getActiveAutoLoopWorktrees: vi.fn().mockReturnValue([]),
    };
    const service = new AutoModeHandlersService(autoMode as never);
    const json = vi.fn();

    await service.run(
      'status',
      { body: {} } as never,
      { json, status: vi.fn().mockReturnThis() } as never
    );

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
