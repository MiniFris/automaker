import type { OutputLocale } from '@automaker/types';

/** Application-owned values. HTTP validation/defaults stay at the transport boundary. */
export interface AppSpecCreateInput {
  outputLocale?: OutputLocale;
  generateFeatures: boolean;
  analyzeProject: boolean;
  projectPath: string;
  projectOverview: string;
  maxFeatures?: number | undefined;
}

export interface AppSpecFeaturesInput {
  outputLocale?: OutputLocale;
  projectPath: string;
  maxFeatures?: number | undefined;
}

export interface AppSpecGenerateInput {
  outputLocale?: OutputLocale;
  generateFeatures: boolean;
  analyzeProject: boolean;
  projectPath: string;
  projectDefinition: string;
  maxFeatures?: number | undefined;
}
