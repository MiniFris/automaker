import type { HttpDomainTransport } from './transport';
import type { BacklogApplyInput, BacklogGenerateInput } from '@automaker/contracts';
import type { EventCallback } from '../http-api-client';

export function createBacklogPlanClient(
  transport: Pick<HttpDomainTransport, 'post' | 'get' | 'subscribeToEvent'>
) {
  return {
    generate: (
      projectPath: BacklogGenerateInput['projectPath'],
      prompt: BacklogGenerateInput['prompt'],
      model?: BacklogGenerateInput['model'],
      branchName?: BacklogGenerateInput['branchName'],
      providerId?: BacklogGenerateInput['providerId']
    ): Promise<{ success: boolean; error?: string }> =>
      transport.post('/api/backlog-plan/generate', {
        projectPath,
        prompt,
        model,
        branchName,
        providerId,
      }),

    stop: (): Promise<{ success: boolean; error?: string }> =>
      transport.post('/api/backlog-plan/stop', {}),

    status: (
      projectPath: string
    ): Promise<{
      success: boolean;
      isRunning?: boolean;
      savedPlan?: {
        savedAt: string;
        prompt: string;
        model?: string;
        result: {
          changes: Array<{
            type: 'add' | 'update' | 'delete';
            featureId?: string;
            feature?: Record<string, unknown>;
            reason: string;
          }>;
          summary: string;
          dependencyUpdates: Array<{
            featureId: string;
            removedDependencies: string[];
            addedDependencies: string[];
          }>;
        };
      } | null;
      error?: string;
    }> => transport.get(`/api/backlog-plan/status?projectPath=${encodeURIComponent(projectPath)}`),

    apply: (
      projectPath: BacklogApplyInput['projectPath'],
      plan: BacklogApplyInput['plan'],
      branchName?: BacklogApplyInput['branchName']
    ): Promise<{ success: boolean; appliedChanges?: string[]; error?: string }> =>
      transport.post('/api/backlog-plan/apply', { projectPath, plan, branchName }),

    clear: (projectPath: string): Promise<{ success: boolean; error?: string }> =>
      transport.post('/api/backlog-plan/clear', { projectPath }),

    onEvent: (callback: (data: unknown) => void): (() => void) => {
      return transport.subscribeToEvent('backlog-plan:event', callback as EventCallback);
    },
  };
}
