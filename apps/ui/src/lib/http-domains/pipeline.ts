import type { HttpDomainTransport } from './transport';

export function createPipelineClient(transport: Pick<HttpDomainTransport, 'post'>) {
  return {
    getConfig: (
      projectPath: string
    ): Promise<{
      success: boolean;
      config?: {
        version: 1;
        steps: Array<{
          id: string;
          name: string;
          order: number;
          instructions: string;
          colorClass: string;
          createdAt: string;
          updatedAt: string;
        }>;
      };
      error?: string;
    }> => transport.post('/api/pipeline/config', { projectPath }),

    saveConfig: (
      projectPath: string,
      config: {
        version: 1;
        steps: Array<{
          id: string;
          name: string;
          order: number;
          instructions: string;
          colorClass: string;
          createdAt: string;
          updatedAt: string;
        }>;
      }
    ): Promise<{ success: boolean; error?: string }> =>
      transport.post('/api/pipeline/config/save', { projectPath, config }),

    addStep: (
      projectPath: string,
      step: {
        name: string;
        order: number;
        instructions: string;
        colorClass: string;
      }
    ): Promise<{
      success: boolean;
      step?: {
        id: string;
        name: string;
        order: number;
        instructions: string;
        colorClass: string;
        createdAt: string;
        updatedAt: string;
      };
      error?: string;
    }> => transport.post('/api/pipeline/steps/add', { projectPath, step }),

    updateStep: (
      projectPath: string,
      stepId: string,
      updates: Partial<{
        name: string;
        order: number;
        instructions: string;
        colorClass: string;
      }>
    ): Promise<{
      success: boolean;
      step?: {
        id: string;
        name: string;
        order: number;
        instructions: string;
        colorClass: string;
        createdAt: string;
        updatedAt: string;
      };
      error?: string;
    }> => transport.post('/api/pipeline/steps/update', { projectPath, stepId, updates }),

    deleteStep: (
      projectPath: string,
      stepId: string
    ): Promise<{ success: boolean; error?: string }> =>
      transport.post('/api/pipeline/steps/delete', { projectPath, stepId }),

    reorderSteps: (
      projectPath: string,
      stepIds: string[]
    ): Promise<{ success: boolean; error?: string }> =>
      transport.post('/api/pipeline/steps/reorder', { projectPath, stepIds }),
  };
}
