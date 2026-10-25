/** Application-owned values. HTTP validation/defaults stay at the transport boundary. */
export interface BacklogApplyInput {
  projectPath: string;
  plan: {
    changes: {
      type: 'delete' | 'add' | 'update';
      reason: string;
      featureId?: string | undefined;
      feature?: { [x: string]: unknown } | undefined;
    }[];
    summary: string;
    dependencyUpdates: {
      featureId: string;
      removedDependencies: string[];
      addedDependencies: string[];
    }[];
  };
  branchName?: string | undefined;
}

export interface BacklogGenerateInput {
  projectPath: string;
  prompt: string;
  model?: string | undefined;
  branchName?: string | undefined;
  providerId?: string | undefined;
}
