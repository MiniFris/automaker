/**
 * PlanApprovalService - Manages plan approval workflow with timeout and recovery
 *
 * Key behaviors:
 * - Timeout stored in closure, wrapped resolve/reject ensures cleanup
 * - Approval tickets are scoped to a project, feature, run and plan version
 * - Auto-reject on timeout (safety feature, not auto-approve)
 */

import { createLogger } from '@automaker/utils';
import { randomUUID } from 'node:crypto';
import type { TypedEventBus } from './typed-event-bus.js';
import type { FeatureStateManager } from './feature-state-manager.js';
import type { SettingsService } from './settings-service.js';

const logger = createLogger('PlanApprovalService');

/** Result returned when approval is resolved */
export interface PlanApprovalResult {
  approved: boolean;
  editedPlan?: string;
  feedback?: string;
}

/** Result returned from resolveApproval method */
export interface ResolveApprovalResult {
  success: boolean;
  error?: string;
  needsRecovery?: boolean;
}

/** Represents an orphaned approval that needs recovery after server restart */
export interface OrphanedApproval {
  featureId: string;
  projectPath: string;
  generatedAt?: string;
  planContent?: string;
}

/** Internal: timeoutId stored in closure, NOT in this object */
interface PendingApproval {
  resolve: (result: PlanApprovalResult) => void;
  reject: (error: Error) => void;
  featureId: string;
  projectPath: string;
  token: string;
  planVersion: number;
  runId: string;
  recovery?: boolean;
}

/** Default timeout: 30 minutes */
const DEFAULT_APPROVAL_TIMEOUT_MS = 30 * 60 * 1000;

function shutdownError(): Error {
  return Object.assign(new Error('Plan approval cancelled - application is shutting down'), {
    name: 'AbortError',
  });
}

/**
 * PlanApprovalService handles the plan approval workflow with lifecycle management.
 */
export class PlanApprovalService {
  private stopping = false;
  private pendingApprovals = new Map<string, PendingApproval>();
  private eventBus: TypedEventBus;
  private featureStateManager: FeatureStateManager;
  private settingsService: SettingsService | null;

  constructor(
    eventBus: TypedEventBus,
    featureStateManager: FeatureStateManager,
    settingsService: SettingsService | null
  ) {
    this.eventBus = eventBus;
    this.featureStateManager = featureStateManager;
    this.settingsService = settingsService;
  }

  /** Generate project-scoped key to prevent collisions across projects */
  private approvalKey(projectPath: string, featureId: string): string {
    return `${projectPath}::${featureId}`;
  }

  /** Wait for plan approval with timeout (default 30 min). Rejects on timeout/cancellation. */
  async waitForApproval(
    featureId: string,
    projectPath: string,
    ticket?: { token: string; planVersion: number; runId: string; recovery?: boolean }
  ): Promise<PlanApprovalResult> {
    if (this.stopping) throw shutdownError();
    const key = this.approvalKey(projectPath, featureId);
    const effectiveTicket = ticket ?? {
      token: 'legacy-internal',
      planVersion: 1,
      runId: featureId,
    };

    logger.info(`Registering pending approval for feature ${featureId} in project ${projectPath}`);
    logger.info(
      `Current pending approvals: ${Array.from(this.pendingApprovals.keys()).join(', ') || 'none'}`
    );

    return new Promise((resolve, reject) => {
      // Prevent duplicate registrations for the same key — reject and clean up existing entry
      const existing = this.pendingApprovals.get(key);
      if (existing) {
        existing.reject(new Error('Superseded by a new waitForApproval call'));
        this.pendingApprovals.delete(key);
      }

      // Wrap resolve/reject to clear timeout when approval is resolved
      // This ensures timeout is ALWAYS cleared on any resolution path
      // Define wrappers BEFORE setTimeout so they can be used in timeout callback
      let timeoutId: NodeJS.Timeout;
      const wrappedResolve = (result: PlanApprovalResult) => {
        clearTimeout(timeoutId);
        resolve(result);
      };

      const wrappedReject = (error: Error) => {
        clearTimeout(timeoutId);
        reject(error);
      };

      // Set up timeout to prevent indefinite waiting and memory leaks
      // Now timeoutId assignment happens after wrappers are defined
      const expire = (timeoutMs: number) => {
        const timeoutMinutes = Math.round(timeoutMs / 60000);
        if (this.pendingApprovals.get(key) === pending) {
          logger.warn(
            `Plan approval for feature ${featureId} timed out after ${timeoutMinutes} minutes`
          );
          this.pendingApprovals.delete(key);
          wrappedReject(
            new Error(
              `Plan approval timed out after ${timeoutMinutes} minutes - feature execution cancelled`
            )
          );
        }
      };

      const pending: PendingApproval = {
        resolve: wrappedResolve,
        reject: wrappedReject,
        featureId,
        projectPath,
        ...effectiveTicket,
      };
      this.pendingApprovals.set(key, pending);
      timeoutId = setTimeout(
        () => expire(DEFAULT_APPROVAL_TIMEOUT_MS),
        DEFAULT_APPROVAL_TIMEOUT_MS
      );
      // Register synchronously: the executor publishes the ticket immediately after
      // this call, and a connected client may respond before settings I/O finishes.
      void this.getTimeoutMs(projectPath).then((timeoutMs) => {
        if (this.pendingApprovals.get(key) !== pending) return;
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => expire(timeoutMs), timeoutMs);
      });

      logger.info(`Pending approval registered for feature ${featureId}`);
    });
  }

  /** Read the current ticket after reconnect without minting or replaying a decision. */
  async getPendingApproval(
    featureId: string,
    projectPath: string,
    canRecover: () => boolean = () => false
  ) {
    const key = this.approvalKey(projectPath, featureId);
    let pending = this.pendingApprovals.get(key);
    if (this.stopping || (!pending && !canRecover())) return null;
    const feature = await this.featureStateManager.loadFeature(projectPath, featureId);
    if (
      this.stopping ||
      this.pendingApprovals.get(key) !== pending ||
      feature?.planSpec?.status !== 'generated' ||
      feature.planSpec.reviewedByUser ||
      ['completed', 'verified'].includes(feature.status ?? '')
    )
      return null;
    if (!pending) {
      if (!canRecover()) return null;
      // A new process issues a fresh ticket only after its coordinator confirms
      // there is no active run. Loading the plan never starts execution.
      void this.waitForApproval(featureId, projectPath, {
        token: randomUUID(),
        runId: randomUUID(),
        planVersion: feature.planSpec.version,
        recovery: true,
      }).catch(() => {
        /* Recovery waits have no live executor to notify. */
      });
      pending = this.pendingApprovals.get(key);
    }
    if (!pending || feature.planSpec.version !== pending.planVersion) return null;
    return {
      approvalToken: pending.token,
      approvalRunId: pending.runId,
      planVersion: pending.planVersion,
      planContent: feature.planSpec.content ?? '',
    };
  }

  /** Consume the current ticket once; registry loss requires explicit run recovery. */
  async resolveApproval(
    featureId: string,
    approved: boolean,
    options?: {
      editedPlan?: string;
      feedback?: string;
      projectPath?: string;
      token?: string;
      planVersion?: number;
      runId?: string;
    }
  ): Promise<ResolveApprovalResult> {
    const {
      editedPlan,
      feedback,
      projectPath: projectPathFromClient,
      token,
      planVersion,
      runId,
    } = options ?? {};

    logger.info(`resolveApproval called for feature ${featureId}, approved=${approved}`);
    logger.info(
      `Current pending approvals: ${Array.from(this.pendingApprovals.keys()).join(', ') || 'none'}`
    );

    // Try to find pending approval using project-scoped key if projectPath is available
    let foundKey: string | undefined;
    let pending: PendingApproval | undefined;

    if (projectPathFromClient) {
      foundKey = this.approvalKey(projectPathFromClient, featureId);
      pending = this.pendingApprovals.get(foundKey);
    } else {
      // Fallback: search by featureId (backward compatibility)
      for (const [key, approval] of this.pendingApprovals) {
        if (approval.featureId === featureId) {
          foundKey = key;
          pending = approval;
          break;
        }
      }
    }

    if (!pending || !foundKey) {
      logger.info(`No pending approval found for feature ${featureId}`);
      return {
        success: false,
        error: `No pending approval for feature ${featureId}`,
      };
    }

    if (
      (token ?? 'legacy-internal') !== pending.token ||
      (planVersion ?? 1) !== pending.planVersion ||
      (runId ?? featureId) !== pending.runId
    ) {
      logger.warn(`Rejected stale or invalid approval ticket for feature ${featureId}`);
      return {
        success: false,
        error: 'Approval ticket is stale or invalid',
      };
    }

    // Consume before the first awaited mutation so concurrent/replayed requests
    // cannot approve the same plan twice.
    this.pendingApprovals.delete(foundKey);

    logger.info(`Found pending approval for feature ${featureId}, proceeding...`);

    const { projectPath } = pending;

    // Update feature's planSpec status
    try {
      await this.featureStateManager.updateFeaturePlanSpec(projectPath, featureId, {
        status: approved ? 'approved' : 'rejected',
        approvedAt: approved ? new Date().toISOString() : undefined,
        reviewedByUser: true,
        ...(editedPlan !== undefined && { content: editedPlan }),
      });
      if (pending.recovery && !approved) {
        await this.featureStateManager.updateFeatureStatus(projectPath, featureId, 'backlog');
      }
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }

    // If rejected, emit event so client knows the rejection reason (even without feedback)
    if (!approved) {
      this.eventBus.emitAutoModeEvent('plan_rejected', {
        featureId,
        projectPath,
        feedback,
      });
    }

    // Resolve the promise with all data including feedback
    // This triggers the wrapped resolve which clears the timeout
    pending.resolve({ approved, editedPlan, feedback });
    return pending.recovery && approved
      ? { success: true, needsRecovery: true }
      : { success: true };
  }

  /** Cancel approval (e.g., when feature stopped). Timeout cleared via wrapped reject. */
  dispose(): void {
    this.stopping = true;
    const pending = [...this.pendingApprovals.values()];
    this.pendingApprovals.clear();
    for (const approval of pending) {
      approval.reject(shutdownError());
    }
  }

  cancelApproval(featureId: string, projectPath?: string): void {
    logger.info(`cancelApproval called for feature ${featureId}`);
    logger.info(
      `Current pending approvals: ${Array.from(this.pendingApprovals.keys()).join(', ') || 'none'}`
    );

    // If projectPath provided, use project-scoped key; otherwise search by featureId
    let foundKey: string | undefined;
    let pending: PendingApproval | undefined;

    if (projectPath) {
      foundKey = this.approvalKey(projectPath, featureId);
      pending = this.pendingApprovals.get(foundKey);
    } else {
      // Fallback: search for any approval with this featureId (backward compatibility)
      for (const [key, approval] of this.pendingApprovals) {
        if (approval.featureId === featureId) {
          foundKey = key;
          pending = approval;
          break;
        }
      }
    }

    if (pending && foundKey) {
      logger.info(`Found and cancelling pending approval for feature ${featureId}`);
      // Wrapped reject clears timeout automatically
      pending.reject(new Error('Plan approval cancelled - feature was stopped'));
      this.pendingApprovals.delete(foundKey);
    } else {
      logger.info(`No pending approval to cancel for feature ${featureId}`);
    }
  }

  /** Check if a feature has a pending plan approval. */
  hasPendingApproval(featureId: string, projectPath?: string): boolean {
    if (projectPath) {
      return this.pendingApprovals.has(this.approvalKey(projectPath, featureId));
    }
    // Fallback: search by featureId (backward compatibility)
    for (const approval of this.pendingApprovals.values()) {
      if (approval.featureId === featureId) {
        return true;
      }
    }
    return false;
  }

  /** Get timeout from project settings or default (30 min). */
  private async getTimeoutMs(projectPath: string): Promise<number> {
    if (!this.settingsService) {
      return DEFAULT_APPROVAL_TIMEOUT_MS;
    }

    try {
      const projectSettings = await this.settingsService.getProjectSettings(projectPath);
      // Check for planApprovalTimeoutMs in project settings
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const timeoutMs = (projectSettings as any).planApprovalTimeoutMs;
      if (typeof timeoutMs === 'number' && timeoutMs > 0) {
        return timeoutMs;
      }
    } catch (error) {
      logger.warn(
        `Failed to get project settings for ${projectPath}, using default timeout`,
        error
      );
    }

    return DEFAULT_APPROVAL_TIMEOUT_MS;
  }
}
