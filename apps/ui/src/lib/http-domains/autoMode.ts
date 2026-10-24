import type { HttpDomainTransport } from './transport';
import type { PendingPlanApprovalResponse } from '@automaker/contracts';
import type { AutoModeAPI, AutoModeEvent } from '../electron';
import type { EventCallback } from '../http-api-client';

export function createAutoModeClient(
  transport: Pick<HttpDomainTransport, 'post' | 'subscribeToEvent'>
): AutoModeAPI {
  return {
    start: (projectPath: string, branchName?: string | null, maxConcurrency?: number) =>
      transport.post('/api/auto-mode/start', { projectPath, branchName, maxConcurrency }),
    stop: (projectPath: string, branchName?: string | null) =>
      transport.post('/api/auto-mode/stop', { projectPath, branchName }),
    stopFeature: (featureId: string) =>
      transport.post('/api/auto-mode/stop-feature', { featureId }),
    status: (projectPath?: string, branchName?: string | null) =>
      transport.post('/api/auto-mode/status', { projectPath, branchName }),
    runFeature: (
      projectPath: string,
      featureId: string,
      useWorktrees?: boolean,
      worktreePath?: string
    ) =>
      transport.post('/api/auto-mode/run-feature', {
        projectPath,
        featureId,
        useWorktrees,
        worktreePath,
      }),
    verifyFeature: (projectPath: string, featureId: string) =>
      transport.post('/api/auto-mode/verify-feature', { projectPath, featureId }),
    resumeFeature: (projectPath: string, featureId: string, useWorktrees?: boolean) =>
      transport.post('/api/auto-mode/resume-feature', {
        projectPath,
        featureId,
        useWorktrees,
      }),
    contextExists: (projectPath: string, featureId: string) =>
      transport.post('/api/auto-mode/context-exists', { projectPath, featureId }),
    analyzeProject: (projectPath: string) =>
      transport.post('/api/auto-mode/analyze-project', { projectPath }),
    followUpFeature: (
      projectPath: string,
      featureId: string,
      prompt: string,
      imagePaths?: string[],
      useWorktrees?: boolean
    ) =>
      transport.post('/api/auto-mode/follow-up-feature', {
        projectPath,
        featureId,
        prompt,
        imagePaths,
        useWorktrees,
      }),
    mergeEnvironmentFeature: (
      projectPath: string,
      featureId: string
    ): Promise<{ success: boolean; error?: string }> =>
      transport.post('/api/auto-mode/merge-environment-feature', {
        projectPath,
        featureId,
        accepted: true,
      }),
    mergeSSHFeature: (
      projectPath: string,
      featureId: string
    ): Promise<{ success: boolean; error?: string }> =>
      transport.post('/api/auto-mode/merge-ssh-feature', {
        projectPath,
        featureId,
        accepted: true,
      }),
    commitFeature: (projectPath: string, featureId: string, worktreePath?: string) =>
      transport.post('/api/auto-mode/commit-feature', {
        projectPath,
        featureId,
        worktreePath,
      }),
    pendingPlanApproval: (projectPath: string, featureId: string) =>
      transport.post('/api/auto-mode/pending-plan-approval', {
        projectPath,
        featureId,
      }) as Promise<PendingPlanApprovalResponse>,
    approvePlan: (
      projectPath: string,
      featureId: string,
      approved: boolean,
      editedPlan?: string,
      feedback?: string,
      approvalToken?: string,
      planVersion?: number,
      approvalRunId?: string
    ) =>
      transport.post('/api/auto-mode/approve-plan', {
        projectPath,
        featureId,
        approved,
        editedPlan,
        feedback,
        approvalToken,
        planVersion,
        approvalRunId,
      }),
    resumeInterrupted: (projectPath: string) =>
      transport.post('/api/auto-mode/resume-interrupted', { projectPath }),
    onEvent: (callback: (event: AutoModeEvent) => void) => {
      return transport.subscribeToEvent('auto-mode:event', callback as EventCallback);
    },
  };
}
