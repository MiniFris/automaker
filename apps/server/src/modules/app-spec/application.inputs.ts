/** Application-owned values. HTTP validation/defaults stay at the transport boundary. */
export interface AppSpecCreateInput {
  generateFeatures: boolean;
  analyzeProject: boolean;
  projectPath: string;
  projectOverview: string;
  maxFeatures?: number | undefined;
}

export interface AppSpecFeaturesInput {
  projectPath: string;
  maxFeatures?: number | undefined;
}

export interface AppSpecGenerateInput {
  generateFeatures: boolean;
  analyzeProject: boolean;
  projectPath: string;
  projectDefinition: string;
  maxFeatures?: number | undefined;
}
