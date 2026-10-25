import type { ChildProcess } from 'node:child_process';
import type { OwnedLocalChild } from './owned-local-child.js';
import type * as Filesystem from '../lib/secure-fs.js';

export interface LocalProcessPreflight {
  hostEnvironment?: Readonly<NodeJS.ProcessEnv>;
  filesystem: Pick<typeof Filesystem, 'access' | 'stat'>;
  resolvePath: (candidate: string) => string;
  supervise?: (child: ChildProcess) => OwnedLocalChild;
}

export function missingLocalPath(error: unknown): boolean {
  return ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException)?.code ?? '');
}

export async function localDirectoryExists(
  port: LocalProcessPreflight,
  canonical: string
): Promise<boolean> {
  try {
    return (await port.filesystem.stat(canonical)).isDirectory();
  } catch (error) {
    if (missingLocalPath(error)) return false;
    throw error;
  }
}

/** Wait for actual accepted work; a timeout does not cancel or release its IO. */
export async function drainLocalProcessWork(
  work: Promise<unknown>[],
  timeoutMs = 5000
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      Promise.allSettled(work),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Local process cleanup could not be confirmed.')),
          Math.max(1, timeoutMs)
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
