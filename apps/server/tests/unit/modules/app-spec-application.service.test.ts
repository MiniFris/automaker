import { describe, expect, it, vi } from 'vitest';
import { AppSpecApplicationService } from '@/modules/app-spec/app-spec-application.service.js';
import { AppSpecJobRegistry } from '@/modules/app-spec/app-spec-job.registry.js';
import type { AppSpecWorkflowPort } from '@/modules/app-spec/app-spec-workflow.port.js';

describe('AppSpecApplicationService', () => {
  it('dispatches to the canonical admitted project even if the original alias retargets before the microtask runs', async () => {
    let target = '/original-project';
    const jobs = new AppSpecJobRegistry({
      validateLocalPath: (value: string) => (value === '/selected-alias' ? target : value),
    } as never);
    const workflow = {
      generate: vi.fn().mockResolvedValue(undefined),
      generateFeatures: vi.fn().mockResolvedValue(undefined),
      sync: vi.fn().mockResolvedValue(undefined),
    };
    const service = new AppSpecApplicationService(workflow, jobs, { emit: vi.fn() } as never);
    const input = {
      projectPath: '/selected-alias',
      projectDefinition: 'Original',
      outputLocale: 'ru' as 'ru' | 'en',
    };
    expect(service.generate(input).success).toBe(true);
    target = '/retargeted-project';
    input.projectDefinition = 'Changed after admission';
    input.outputLocale = 'en';
    await Promise.resolve();
    expect(workflow.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: '/original-project',
        source: 'Original',
        outputLocale: 'ru',
      })
    );
    await jobs.onModuleDestroy();
    expect(workflow.generate).not.toHaveBeenCalledWith(
      expect.objectContaining({ projectPath: '/retargeted-project' })
    );
  });

  it('owns per-project job state and cancels the workflow explicitly', async () => {
    let observedSignal: AbortSignal | undefined;
    const workflow: AppSpecWorkflowPort = {
      generate: vi.fn(async ({ abortController }) => {
        observedSignal = abortController.signal;
        await new Promise<void>((resolve) =>
          abortController.signal.addEventListener('abort', () => resolve())
        );
      }),
      generateFeatures: vi.fn(),
      sync: vi.fn(),
    };
    const service = new AppSpecApplicationService(
      workflow,
      new AppSpecJobRegistry({ validateLocalPath: (value: string) => value } as never),
      {
        emit: vi.fn(),
      } as never
    );
    const input = {
      projectPath: '/project',
      projectDefinition: 'Build an application',
      generateFeatures: false,
      analyzeProject: true,
    };

    expect(service.generate(input)).toEqual({ success: true });
    expect(service.generate(input)).toEqual({
      success: false,
      error: 'Operation already running for this project',
    });
    expect(service.status('/project')).toMatchObject({ success: true, isRunning: true });
    await Promise.resolve();
    expect(service.stop('/project')).toEqual({ success: true });
    expect(observedSignal?.aborted).toBe(true);
  });
});
