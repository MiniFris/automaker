import { createTestProviderRegistry } from '../helpers/provider-registry.js';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createEventEmitter } from '../../src/lib/events.js';
import { FeatureLoader } from '../../src/services/feature-loader.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { AutoModeServiceFacade } from '../../src/services/auto-mode/facade.js';

describe('persisted plan recovery', () => {
  it('requires a fresh user decision after restart and starts the approved continuation once', async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), 'automaker-plan-recovery-'));
    const loader = new FeatureLoader();
    const facade = AutoModeServiceFacade.create(project, {
      providerRegistry: createTestProviderRegistry(new SettingsService(path.join(project, 'data'))),
      events: createEventEmitter(),
      featureLoader: loader,
      settingsService: null,
    });
    const execute = vi.spyOn(facade, 'executeFeature').mockResolvedValue(undefined);
    try {
      await loader.create(project, {
        id: 'recovered-plan',
        title: 'Recovery fixture',
        description: 'Recovery fixture',
        status: 'interrupted',
        planningMode: 'spec',
        requirePlanApproval: true,
        planSpec: {
          status: 'generated',
          content: 'Saved reviewed plan',
          version: 3,
          reviewedByUser: false,
        },
      });
      await expect(
        facade.resolvePlanApproval(
          'recovered-plan',
          true,
          undefined,
          undefined,
          'old-token',
          3,
          'old-run'
        )
      ).resolves.toMatchObject({ success: false });
      const ticket = await facade.getPendingPlanApproval('recovered-plan');
      expect(ticket).toMatchObject({ planVersion: 3, planContent: 'Saved reviewed plan' });
      expect(execute).not.toHaveBeenCalled();
      const decide = () =>
        facade.resolvePlanApproval(
          'recovered-plan',
          true,
          undefined,
          undefined,
          ticket!.approvalToken,
          ticket!.planVersion,
          ticket!.approvalRunId
        );
      const decisions = await Promise.all([decide(), decide()]);
      expect(decisions.filter(({ success }) => success)).toHaveLength(1);
      expect(execute).toHaveBeenCalledExactlyOnceWith(
        'recovered-plan',
        true,
        false,
        undefined,
        expect.objectContaining({
          continuationPrompt: expect.stringContaining('Saved reviewed plan'),
        })
      );
      expect((await loader.get(project, 'recovered-plan'))?.planSpec).toMatchObject({
        status: 'approved',
        version: 3,
        reviewedByUser: true,
      });
    } finally {
      facade.interruptForShutdown();
      await rm(project, { recursive: true, force: true });
    }
  });
});
