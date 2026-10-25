/** Application-owned values. HTTP validation/defaults stay at the transport boundary. */
export interface BrowseProjectInput {
  projectPath: string;
  relativePath?: string | undefined;
}

export interface ResolveDirectoryInput {
  directoryName: string;
  sampleFiles?: string[] | undefined;
  fileCount?: number | undefined;
}

export interface SaveImageInput {
  data: string;
  filename: string;
  projectPath: string;
}

export interface ImageQueryInput {
  path: string;
  projectPath?: string | undefined;
}
