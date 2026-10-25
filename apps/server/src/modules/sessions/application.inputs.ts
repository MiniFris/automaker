/** Application-owned values. HTTP validation/defaults stay at the transport boundary. */
export interface SessionCreateInput {
  name: string;
  projectPath?: string | undefined;
  workingDirectory?: string | undefined;
  model?: string | undefined;
  providerId?: string | undefined;
}

export interface SessionUpdateInput {
  name?: string | undefined;
  tags?: string[] | undefined;
  model?: string | undefined;
}
