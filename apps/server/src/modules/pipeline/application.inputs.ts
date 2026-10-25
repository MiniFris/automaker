/** Application-owned values. HTTP validation/defaults stay at the transport boundary. */
export interface PipelineAddInput {
  projectPath: string;
  step: {
    [x: string]: unknown;
    name: string;
    order: number;
    instructions: string;
    colorClass: string;
  };
}

export interface PipelineDeleteInput {
  projectPath: string;
  stepId: string;
}

export interface PipelineProjectInput {
  projectPath: string;
}

export interface PipelineReorderInput {
  projectPath: string;
  stepIds: string[];
}

export interface PipelineSaveInput {
  projectPath: string;
  config: {
    [x: string]: unknown;
    version: 1;
    steps: {
      [x: string]: unknown;
      name: string;
      order: number;
      instructions: string;
      colorClass: string;
      id: string;
      createdAt: string;
      updatedAt: string;
    }[];
  };
}

export interface PipelineUpdateInput {
  projectPath: string;
  stepId: string;
  updates: {
    [x: string]: unknown;
    name?: string | undefined;
    order?: number | undefined;
    instructions?: string | undefined;
    colorClass?: string | undefined;
    id?: string | undefined;
    createdAt?: string | undefined;
    updatedAt?: string | undefined;
  };
}
