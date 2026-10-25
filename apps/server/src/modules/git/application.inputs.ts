/** Application-owned values. HTTP validation/defaults stay at the transport boundary. */
export interface GitDetailsInput {
  [key: string]: unknown;
  projectPath: string;
  filePath?: string | undefined;
}

export interface GitFileInput {
  [key: string]: unknown;
  projectPath: string;
  filePath: string;
}

export interface GitProjectInput {
  [key: string]: unknown;
  projectPath: string;
}

export interface GitStageFilesInput {
  [key: string]: unknown;
  projectPath: string;
  files: string[];
  operation: 'stage' | 'unstage';
  environmentTargetId?: string | undefined;
}
