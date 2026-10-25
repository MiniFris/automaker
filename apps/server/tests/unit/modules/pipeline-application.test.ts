import { describe, expect, it, vi } from 'vitest';

import { PipelineApplicationService } from '../../../src/modules/pipeline/pipeline-application.service.js';

describe('PipelineApplicationService', () => {
  it('delegates configuration and step mutations to the shared repository service', async () => {
    const step = {
      id: 'step-1',
      name: 'Review',
      order: 0,
      instructions: 'Review changes',
      colorClass: 'blue',
      createdAt: 'now',
      updatedAt: 'now',
    };
    const pipeline = {
      getPipelineConfig: vi.fn().mockResolvedValue({ version: 1, steps: [step] }),
      savePipelineConfig: vi.fn().mockResolvedValue(undefined),
      addStep: vi.fn().mockResolvedValue(step),
      updateStep: vi.fn().mockResolvedValue(step),
      deleteStep: vi.fn().mockResolvedValue(undefined),
      reorderSteps: vi.fn().mockResolvedValue(undefined),
    };
    const service = new PipelineApplicationService(pipeline as never);

    await expect(service.get({ projectPath: '/project' })).resolves.toEqual({
      success: true,
      config: { version: 1, steps: [step] },
    });
    await expect(
      service.add({
        projectPath: '/project',
        step: { ...step, id: undefined, createdAt: undefined, updatedAt: undefined },
      } as never)
    ).resolves.toMatchObject({ success: true, step });
    await expect(service.delete({ projectPath: '/project', stepId: 'step-1' })).resolves.toEqual({
      success: true,
    });
    await expect(
      service.reorder({ projectPath: '/project', stepIds: ['step-1'] })
    ).resolves.toEqual({ success: true });
  });
});
