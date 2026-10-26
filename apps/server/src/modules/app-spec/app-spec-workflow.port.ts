import type { OutputLocale } from '@automaker/types';

export type AppSpecOperation = 'spec_regeneration' | 'feature_generation' | 'sync';

export interface AppSpecGenerationOptions {
  outputLocale?: OutputLocale;
  projectPath: string;
  source: string;
  generateFeatures?: boolean;
  analyzeProject?: boolean;
  maxFeatures?: number;
  abortController: AbortController;
}

export const APP_SPEC_WORKFLOW_PORT = Symbol('APP_SPEC_WORKFLOW_PORT');
export interface AppSpecWorkflowPort {
  generate(options: AppSpecGenerationOptions): Promise<void>;
  generateFeatures(
    projectPath: string,
    maxFeatures: number | undefined,
    abortController: AbortController,
    outputLocale?: OutputLocale
  ): Promise<void>;
  sync(projectPath: string, abortController: AbortController): Promise<void>;
}
