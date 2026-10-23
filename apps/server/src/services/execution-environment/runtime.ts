export class ExecutionEnvironmentError extends Error {
  readonly status = 400;

  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export interface EnvironmentEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
}
export interface EnvironmentCommandResult {
  exitCode: number;
  output: string;
  truncated: boolean;
}
/** Server-only subprocess request. Environment/auth come from the target, never controller env. */
export interface EnvironmentProcessRequest {
  command: string;
  args: string[];
  stdin?: string;
  timeoutMs?: number;
  idleTimeoutMs?: number;
}
export type EnvironmentProcessOutput = (stream: 'stdout' | 'stderr', data: Buffer) => void;
export interface EnvironmentSearchOptions {
  path?: string;
  glob?: string;
  text?: string;
  caseSensitive?: boolean;
  maxResults?: number;
  includeDependencies?: boolean;
}
export interface EnvironmentSearchResult {
  files: string[];
  matches: Array<{ path: string; line: number; text: string }>;
  truncated: boolean;
}

/** All file/process operations must target the same environment and working copy. */
export interface ExecutionEnvironment {
  readonly type: 'local' | 'docker' | 'ssh';
  readonly cwd: string;
  readonly platform: NodeJS.Platform;
  readonly capabilities: {
    shell: boolean;
    binaryFiles: boolean;
    remove: boolean;
    sandboxed: boolean;
  };
  /** Remote backends batch traversal into one worker request instead of one RPC per file. */
  search?(options: EnvironmentSearchOptions, signal: AbortSignal): Promise<EnvironmentSearchResult>;
  readFile(
    file: string,
    offset: number,
    length: number,
    signal: AbortSignal
  ): Promise<{ data: Buffer; size: number }>;
  writeFile(
    file: string,
    data: Buffer,
    signal: AbortSignal,
    expectedSha256?: string | null
  ): Promise<void>;
  listDirectory(
    directory: string,
    maximum: number,
    signal: AbortSignal
  ): Promise<{ entries: EnvironmentEntry[]; truncated: boolean }>;
  mkdir(directory: string, signal: AbortSignal): Promise<void>;
  remove(target: string, recursive: boolean, signal: AbortSignal): Promise<void>;
  exec(
    command: string,
    signal: AbortSignal,
    options?: { cwd?: string; timeoutMs?: number; maxOutputBytes?: number }
  ): Promise<EnvironmentCommandResult>;
  /** Optional until all backends implement streaming. No shell interpolation, no implicit fallback. */
  runProcess?(
    request: EnvironmentProcessRequest,
    signal: AbortSignal,
    output: EnvironmentProcessOutput
  ): Promise<{ exitCode: number }>;
}

// Runtime objects are capabilities, not JSON-shaped permission flags supplied by a client/model.
const issued = new WeakSet<object>();
export function issueEnvironment<T extends ExecutionEnvironment>(environment: T): T {
  issued.add(environment);
  return environment;
}
export function isIssuedEnvironment(value: unknown): value is ExecutionEnvironment {
  return !!value && typeof value === 'object' && issued.has(value);
}
