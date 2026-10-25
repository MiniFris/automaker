import { AutoModeController } from '@/modules/auto-mode/auto-mode.controller.js';
import { describe, expect, it, vi } from 'vitest';
import { AutoModeApplicationService } from '@/modules/auto-mode/auto-mode-application.service.js';
import { AutoModeMergeSchema } from '@/modules/auto-mode/auto-mode.schemas.js';
import { ProjectRunContextRegistry } from '@/modules/auto-mode/project-run-context.registry.js';
import type { AutoModeServiceCompat } from '@/services/auto-mode/index.js';

describe('explicit SSH feature merge endpoint', () => {
  async function invoke(body: unknown, failure = false) {
    const mergeSSHFeature = vi.fn();
    if (failure) mergeSSHFeature.mockRejectedValue(new Error('Remote target diverged; no reset.'));
    const service = { mergeSSHFeature } as unknown as AutoModeServiceCompat;
    const response = { status: vi.fn(), json: vi.fn() };
    const parsed = AutoModeMergeSchema.safeParse(body);
    if (!parsed.success) response.status(400);
    else {
      const application = new AutoModeApplicationService(
        service,
        service,
        service,
        new ProjectRunContextRegistry(),
        {
          launch: vi.fn(),
        } as never
      );
      try {
        response.json(await new AutoModeController(application).mergeSshFeature(parsed.data));
      } catch (error) {
        response.status((error as { getStatus(): number }).getStatus());
        response.json((error as { getResponse(): unknown }).getResponse());
      }
    }
    return { mergeSSHFeature, response };
  }
  it.each([
    {},
    null,
    { projectPath: '/project', featureId: 'feature' },
    { projectPath: '/project', featureId: '../other', accepted: true },
    { projectPath: '/project', featureId: 'feature', accepted: true, targetBranch: 'arbitrary' },
    { projectPath: '/project', featureId: 'feature', accepted: false },
  ])('rejects missing acceptance/invalid or unknown fields before Git %j', async (body) => {
    const { response, mergeSSHFeature } = await invoke(body);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(mergeSSHFeature).not.toHaveBeenCalled();
  });
  it('delegates only the selected project and feature, never request-supplied branch/host/commands', async () => {
    const { response, mergeSSHFeature } = await invoke({
      projectPath: '/project',
      featureId: 'feature',
      accepted: true,
    });
    expect(mergeSSHFeature).toHaveBeenCalledWith('/project', 'feature');
    expect(response.json).toHaveBeenCalledWith({ success: true });
  });
  it('surfaces a refused merge without a local fallback or retry', async () => {
    const { response, mergeSSHFeature } = await invoke(
      { projectPath: '/project', featureId: 'feature', accepted: true },
      true
    );
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      error: 'Remote target diverged; no reset.',
    });
    expect(mergeSSHFeature).toHaveBeenCalledTimes(1);
  });
  it('routes the common Docker/SSH endpoint through the managed feature service', async () => {
    const mergeEnvironmentFeature = vi.fn();
    const service = {
      mergeEnvironmentFeature,
      mergeSSHFeature: vi.fn(),
    } as unknown as AutoModeServiceCompat;
    const application = new AutoModeApplicationService(
      service,
      service,
      service,
      new ProjectRunContextRegistry(),
      {
        launch: vi.fn(),
      } as never
    );
    const result = await application.mergeFeature(
      { projectPath: '/project', featureId: 'task', accepted: true },
      true
    );
    expect(mergeEnvironmentFeature).toHaveBeenCalledWith('/project', 'task');
    expect(service.mergeSSHFeature).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });
});
