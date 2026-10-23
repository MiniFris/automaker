import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PlanApprovalService } from '@/services/plan-approval-service.js';
import type { TypedEventBus } from '@/services/typed-event-bus.js';
import type { FeatureStateManager } from '@/services/feature-state-manager.js';
import type { SettingsService } from '@/services/settings-service.js';
import type { Feature } from '@automaker/types';

describe('PlanApprovalService', () => {
  let service: PlanApprovalService;
  let mockEventBus: TypedEventBus;
  let mockFeatureStateManager: FeatureStateManager;
  let mockSettingsService: SettingsService | null;

  beforeEach(() => {
    vi.useFakeTimers();

    mockEventBus = {
      emitAutoModeEvent: vi.fn(),
      emit: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
      getUnderlyingEmitter: vi.fn(),
    } as unknown as TypedEventBus;

    mockFeatureStateManager = {
      loadFeature: vi.fn(),
      updateFeatureStatus: vi.fn(),
      updateFeaturePlanSpec: vi.fn(),
    } as unknown as FeatureStateManager;

    mockSettingsService = {
      getProjectSettings: vi.fn().mockResolvedValue({}),
    } as unknown as SettingsService;

    service = new PlanApprovalService(mockEventBus, mockFeatureStateManager, mockSettingsService);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // Helper to flush pending promises
  const flushPromises = () => vi.runAllTimersAsync();

  describe('waitForApproval', () => {
    it('should create pending entry and return Promise', async () => {
      const approvalPromise = service.waitForApproval('feature-1', '/project');
      // Flush async operations so the approval is registered
      await vi.advanceTimersByTimeAsync(0);

      expect(service.hasPendingApproval('feature-1')).toBe(true);
      expect(approvalPromise).toBeInstanceOf(Promise);
    });

    it('should timeout and reject after configured period', async () => {
      const approvalPromise = service.waitForApproval('feature-1', '/project');
      // Attach catch to prevent unhandled rejection warning (will be properly asserted below)
      approvalPromise.catch(() => {});
      // Flush the async initialization
      await vi.advanceTimersByTimeAsync(0);

      // Advance time by 30 minutes
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

      await expect(approvalPromise).rejects.toThrow(
        'Plan approval timed out after 30 minutes - feature execution cancelled'
      );
      expect(service.hasPendingApproval('feature-1')).toBe(false);
    });

    it('should use configured timeout from project settings', async () => {
      // Configure 10 minute timeout
      vi.mocked(mockSettingsService!.getProjectSettings).mockResolvedValue({
        planApprovalTimeoutMs: 10 * 60 * 1000,
      } as never);

      const approvalPromise = service.waitForApproval('feature-1', '/project');
      // Attach catch to prevent unhandled rejection warning (will be properly asserted below)
      approvalPromise.catch(() => {});
      // Flush the async initialization
      await vi.advanceTimersByTimeAsync(0);

      // Advance time by 10 minutes - should timeout
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

      await expect(approvalPromise).rejects.toThrow(
        'Plan approval timed out after 10 minutes - feature execution cancelled'
      );
    });

    it('should fall back to default timeout when settings service is null', async () => {
      // Create service without settings service
      const serviceNoSettings = new PlanApprovalService(
        mockEventBus,
        mockFeatureStateManager,
        null
      );

      const approvalPromise = serviceNoSettings.waitForApproval('feature-1', '/project');
      // Attach catch to prevent unhandled rejection warning (will be properly asserted below)
      approvalPromise.catch(() => {});
      // Flush async
      await vi.advanceTimersByTimeAsync(0);

      // Advance by 29 minutes - should not timeout yet
      await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
      expect(serviceNoSettings.hasPendingApproval('feature-1')).toBe(true);

      // Advance by 1 more minute (total 30) - should timeout
      await vi.advanceTimersByTimeAsync(1 * 60 * 1000);

      await expect(approvalPromise).rejects.toThrow('Plan approval timed out');
    });
  });

  describe('resolveApproval', () => {
    it('should resolve Promise correctly when approved=true', async () => {
      const approvalPromise = service.waitForApproval('feature-1', '/project');
      await vi.advanceTimersByTimeAsync(0);

      const result = await service.resolveApproval('feature-1', true, {
        editedPlan: 'Updated plan',
        feedback: 'Looks good!',
      });

      expect(result).toEqual({ success: true });

      const approval = await approvalPromise;
      expect(approval).toEqual({
        approved: true,
        editedPlan: 'Updated plan',
        feedback: 'Looks good!',
      });

      expect(service.hasPendingApproval('feature-1')).toBe(false);
    });

    it('should resolve Promise correctly when approved=false', async () => {
      const approvalPromise = service.waitForApproval('feature-1', '/project');
      await vi.advanceTimersByTimeAsync(0);

      const result = await service.resolveApproval('feature-1', false, {
        feedback: 'Need more details',
      });

      expect(result).toEqual({ success: true });

      const approval = await approvalPromise;
      expect(approval).toEqual({
        approved: false,
        editedPlan: undefined,
        feedback: 'Need more details',
      });
    });

    it('should emit plan_rejected event when rejected with feedback', async () => {
      service.waitForApproval('feature-1', '/project');
      await vi.advanceTimersByTimeAsync(0);

      await service.resolveApproval('feature-1', false, {
        feedback: 'Need changes',
      });

      expect(mockEventBus.emitAutoModeEvent).toHaveBeenCalledWith('plan_rejected', {
        featureId: 'feature-1',
        projectPath: '/project',
        feedback: 'Need changes',
      });
    });

    it('should update planSpec status to approved when approved', async () => {
      service.waitForApproval('feature-1', '/project');
      await vi.advanceTimersByTimeAsync(0);

      await service.resolveApproval('feature-1', true, {
        editedPlan: 'New plan content',
      });

      expect(mockFeatureStateManager.updateFeaturePlanSpec).toHaveBeenCalledWith(
        '/project',
        'feature-1',
        expect.objectContaining({
          status: 'approved',
          reviewedByUser: true,
          content: 'New plan content',
        })
      );
    });

    it('should update planSpec status to rejected when rejected', async () => {
      service.waitForApproval('feature-1', '/project');
      await vi.advanceTimersByTimeAsync(0);

      await service.resolveApproval('feature-1', false);

      expect(mockFeatureStateManager.updateFeaturePlanSpec).toHaveBeenCalledWith(
        '/project',
        'feature-1',
        expect.objectContaining({
          status: 'rejected',
          reviewedByUser: true,
        })
      );
    });

    it('should clear timeout on normal resolution (no double-fire)', async () => {
      const approvalPromise = service.waitForApproval('feature-1', '/project');
      await vi.advanceTimersByTimeAsync(0);

      // Advance 10 minutes then resolve
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      await service.resolveApproval('feature-1', true);

      const approval = await approvalPromise;
      expect(approval.approved).toBe(true);

      // Advance past the 30 minute mark - should NOT reject
      await vi.advanceTimersByTimeAsync(25 * 60 * 1000);

      // If timeout wasn't cleared, we'd see issues
      expect(service.hasPendingApproval('feature-1')).toBe(false);
    });

    it('should return error when no pending approval and no recovery possible', async () => {
      const result = await service.resolveApproval('non-existent', true);

      expect(result).toEqual({
        success: false,
        error: 'No pending approval for feature non-existent',
      });
    });
  });

  describe('approval ticket lifecycle', () => {
    const ticket = { token: 'ticket-1', planVersion: 3, runId: 'run-1' };

    it('aborts all waiting projects and clears their timers on shutdown', async () => {
      const waiting = service.waitForApproval('feature-1', '/project', ticket);
      const other = service.waitForApproval('feature-1', '/other-project', ticket);
      const results = Promise.allSettled([waiting, other]);
      await vi.advanceTimersByTimeAsync(0);
      service.dispose();
      service.dispose();
      for (const result of await results) {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') expect(result.reason.name).toBe('AbortError');
      }
      expect(service.hasPendingApproval('feature-1')).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      await expect(service.waitForApproval('feature-2', '/project', ticket)).rejects.toMatchObject({
        name: 'AbortError',
      });
    });

    it('accepts an immediate decision while project settings are still loading', async () => {
      let finishSettings!: (settings: never) => void;
      vi.mocked(mockSettingsService!.getProjectSettings).mockReturnValue(
        new Promise((resolve) => {
          finishSettings = resolve;
        })
      );
      const waiting = service.waitForApproval('feature-1', '/project', ticket);
      expect(service.hasPendingApproval('feature-1', '/project')).toBe(true);
      await expect(
        service.resolveApproval('feature-1', true, {
          projectPath: '/project',
          ...ticket,
        })
      ).resolves.toEqual({ success: true });
      await expect(waiting).resolves.toMatchObject({ approved: true });
      finishSettings({} as never);
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('returns the active ticket and current plan after a client reconnect', async () => {
      vi.mocked(mockFeatureStateManager.loadFeature).mockResolvedValue({
        id: 'feature-1',
        planSpec: { status: 'generated', version: 3, content: 'Plan v3' },
      } as Feature);
      const waiting = service.waitForApproval('feature-1', '/project', ticket);
      await expect(service.getPendingApproval('feature-1', '/project')).resolves.toEqual({
        approvalToken: ticket.token,
        approvalRunId: ticket.runId,
        planVersion: ticket.planVersion,
        planContent: 'Plan v3',
      });
      await expect(service.getPendingApproval('feature-1', '/other-project')).resolves.toBeNull();
      await service.resolveApproval('feature-1', true, { projectPath: '/project', ...ticket });
      await waiting;
      await expect(service.getPendingApproval('feature-1', '/project')).resolves.toBeNull();
    });

    it('does not return a consumed ticket when the persisted plan read finishes late', async () => {
      let finishRead!: (feature: Feature) => void;
      vi.mocked(mockFeatureStateManager.loadFeature).mockReturnValue(
        new Promise((resolve) => {
          finishRead = resolve;
        })
      );
      const waiting = service.waitForApproval('feature-1', '/project', ticket);
      const reading = service.getPendingApproval('feature-1', '/project');
      await service.resolveApproval('feature-1', true, { projectPath: '/project', ...ticket });
      await waiting;
      finishRead({ planSpec: { status: 'generated', version: 3 } } as Feature);
      await expect(reading).resolves.toBeNull();
    });

    it('rejects a stale plan version without consuming the active ticket', async () => {
      const approvalPromise = service.waitForApproval('feature-1', '/project', ticket);
      await vi.advanceTimersByTimeAsync(0);

      const stale = await service.resolveApproval('feature-1', true, {
        projectPath: '/project',
        ...ticket,
        planVersion: 2,
      });

      expect(stale).toEqual({ success: false, error: 'Approval ticket is stale or invalid' });
      expect(service.hasPendingApproval('feature-1', '/project')).toBe(true);

      await service.resolveApproval('feature-1', true, { projectPath: '/project', ...ticket });
      await expect(approvalPromise).resolves.toMatchObject({ approved: true });
    });

    it('consumes a ticket exactly once when duplicate requests race', async () => {
      const approvalPromise = service.waitForApproval('feature-1', '/project', ticket);
      await vi.advanceTimersByTimeAsync(0);

      const decisions = await Promise.all([
        service.resolveApproval('feature-1', true, { projectPath: '/project', ...ticket }),
        service.resolveApproval('feature-1', true, { projectPath: '/project', ...ticket }),
      ]);

      expect(decisions).toContainEqual({ success: true });
      expect(decisions).toContainEqual({
        success: false,
        error: 'No pending approval for feature feature-1',
      });
      expect(mockFeatureStateManager.updateFeaturePlanSpec).toHaveBeenCalledTimes(1);
      await expect(approvalPromise).resolves.toMatchObject({ approved: true });
    });

    it('rejects the waiting executor when saving an approval fails', async () => {
      const waiting = service.waitForApproval('feature-1', '/project', ticket);
      const failure = expect(waiting).rejects.toThrow('disk unavailable');
      vi.mocked(mockFeatureStateManager.updateFeaturePlanSpec).mockRejectedValueOnce(
        new Error('disk unavailable')
      );
      await expect(
        service.resolveApproval('feature-1', true, { projectPath: '/project', ...ticket })
      ).rejects.toThrow('disk unavailable');
      await failure;
      expect(service.hasPendingApproval('feature-1', '/project')).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('does not approve a persisted generated plan after registry loss', async () => {
      vi.mocked(mockFeatureStateManager.loadFeature).mockResolvedValue({
        id: 'feature-1',
        status: 'in_progress',
        planSpec: { status: 'generated', version: 3, reviewedByUser: false },
      } as Feature);

      await expect(
        service.resolveApproval('feature-1', true, {
          projectPath: '/project',
          ...ticket,
        })
      ).resolves.toEqual({
        success: false,
        error: 'No pending approval for feature feature-1',
      });
      expect(mockFeatureStateManager.updateFeaturePlanSpec).not.toHaveBeenCalled();
    });

    it('issues a fresh recovery ticket without starting execution and consumes it only once', async () => {
      vi.mocked(mockFeatureStateManager.loadFeature).mockResolvedValue({
        id: 'feature-1',
        status: 'interrupted',
        planSpec: { status: 'generated', version: 3, reviewedByUser: false, content: 'Saved plan' },
      } as Feature);
      const recovered = await service.getPendingApproval('feature-1', '/project', () => true);
      expect(recovered).toMatchObject({ planVersion: 3, planContent: 'Saved plan' });
      expect(recovered!.approvalToken).not.toBe(ticket.token);
      expect(mockFeatureStateManager.updateFeaturePlanSpec).not.toHaveBeenCalled();
      await expect(
        service.resolveApproval('feature-1', true, { projectPath: '/project', ...ticket })
      ).resolves.toEqual({ success: false, error: 'Approval ticket is stale or invalid' });
      const decision = {
        projectPath: '/project',
        token: recovered!.approvalToken,
        runId: recovered!.approvalRunId,
        planVersion: recovered!.planVersion,
      };
      await expect(service.resolveApproval('feature-1', true, decision)).resolves.toEqual({
        success: true,
        needsRecovery: true,
      });
      await expect(service.resolveApproval('feature-1', true, decision)).resolves.toMatchObject({
        success: false,
      });
      expect(mockFeatureStateManager.updateFeaturePlanSpec).toHaveBeenCalledTimes(1);
    });

    it('does not issue a recovery ticket if a run starts while the saved plan is loading', async () => {
      let finishRead!: (feature: Feature) => void;
      vi.mocked(mockFeatureStateManager.loadFeature).mockReturnValue(
        new Promise((resolve) => {
          finishRead = resolve;
        })
      );
      let idle = true;
      const reading = service.getPendingApproval('feature-1', '/project', () => idle);
      idle = false;
      finishRead({ planSpec: { status: 'generated', version: 3 } } as Feature);
      await expect(reading).resolves.toBeNull();
      expect(service.hasPendingApproval('feature-1')).toBe(false);
    });
  });

  describe('cancelApproval', () => {
    it('should reject pending Promise with cancellation error', async () => {
      const approvalPromise = service.waitForApproval('feature-1', '/project');
      await vi.advanceTimersByTimeAsync(0);

      service.cancelApproval('feature-1');

      await expect(approvalPromise).rejects.toThrow(
        'Plan approval cancelled - feature was stopped'
      );
      expect(service.hasPendingApproval('feature-1')).toBe(false);
    });

    it('should clear timeout on cancellation', async () => {
      const approvalPromise = service.waitForApproval('feature-1', '/project');
      await vi.advanceTimersByTimeAsync(0);

      service.cancelApproval('feature-1');

      // Verify rejection happened
      await expect(approvalPromise).rejects.toThrow();

      // Advance past timeout - should not cause any issues
      await vi.advanceTimersByTimeAsync(35 * 60 * 1000);

      // No additional errors should occur
      expect(service.hasPendingApproval('feature-1')).toBe(false);
    });

    it('should do nothing when no pending approval exists', () => {
      // Should not throw
      expect(() => service.cancelApproval('non-existent')).not.toThrow();
    });
  });

  describe('hasPendingApproval', () => {
    it('should return true when approval is pending', async () => {
      service.waitForApproval('feature-1', '/project');
      await vi.advanceTimersByTimeAsync(0);

      expect(service.hasPendingApproval('feature-1')).toBe(true);
    });

    it('should return false when no approval is pending', () => {
      expect(service.hasPendingApproval('feature-1')).toBe(false);
    });

    it('should return false after approval is resolved', async () => {
      service.waitForApproval('feature-1', '/project');
      await vi.advanceTimersByTimeAsync(0);
      await service.resolveApproval('feature-1', true);

      expect(service.hasPendingApproval('feature-1')).toBe(false);
    });

    it('should return false after approval is cancelled', async () => {
      const promise = service.waitForApproval('feature-1', '/project');
      await vi.advanceTimersByTimeAsync(0);
      service.cancelApproval('feature-1');

      // Consume the rejection
      await promise.catch(() => {});

      expect(service.hasPendingApproval('feature-1')).toBe(false);
    });
  });

  describe('getTimeoutMs (via waitForApproval behavior)', () => {
    it('should return configured value from project settings', async () => {
      vi.mocked(mockSettingsService!.getProjectSettings).mockResolvedValue({
        planApprovalTimeoutMs: 5 * 60 * 1000, // 5 minutes
      } as never);

      const approvalPromise = service.waitForApproval('feature-1', '/project');
      // Attach catch to prevent unhandled rejection warning (will be properly asserted below)
      approvalPromise.catch(() => {});
      await vi.advanceTimersByTimeAsync(0);

      // Should not timeout at 4 minutes
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
      expect(service.hasPendingApproval('feature-1')).toBe(true);

      // Should timeout at 5 minutes
      await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
      await expect(approvalPromise).rejects.toThrow('timed out after 5 minutes');
    });

    it('should return default when settings service throws', async () => {
      vi.mocked(mockSettingsService!.getProjectSettings).mockRejectedValue(new Error('Failed'));

      const approvalPromise = service.waitForApproval('feature-1', '/project');
      // Attach catch to prevent unhandled rejection warning (will be properly asserted below)
      approvalPromise.catch(() => {});
      await vi.advanceTimersByTimeAsync(0);

      // Should use default 30 minute timeout
      await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
      expect(service.hasPendingApproval('feature-1')).toBe(true);

      await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
      await expect(approvalPromise).rejects.toThrow('timed out after 30 minutes');
    });

    it('should return default when planApprovalTimeoutMs is invalid', async () => {
      vi.mocked(mockSettingsService!.getProjectSettings).mockResolvedValue({
        planApprovalTimeoutMs: -1, // Invalid
      } as never);

      const approvalPromise = service.waitForApproval('feature-1', '/project');
      // Attach catch to prevent unhandled rejection warning (will be properly asserted below)
      approvalPromise.catch(() => {});
      await vi.advanceTimersByTimeAsync(0);

      // Should use default 30 minute timeout
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      await expect(approvalPromise).rejects.toThrow('timed out after 30 minutes');
    });
  });
});
