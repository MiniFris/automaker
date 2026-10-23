import { describe, expect, it, vi } from 'vitest';
import { AppSpecApplicationService } from '@/modules/app-spec/app-spec-application.service.js';
import { AppSpecJobRegistry } from '@/modules/app-spec/app-spec-job.registry.js';
import type { AppSpecWorkflowPort } from '@/modules/app-spec/app-spec-workflow.port.js';

describe('AppSpecApplicationService', () => {
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
    const service = new AppSpecApplicationService(workflow, new AppSpecJobRegistry(), {
      emit: vi.fn(),
    } as never);
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
    expect(service.stop('/project')).toEqual({ success: true });
    expect(observedSignal?.aborted).toBe(true);
  });
});
