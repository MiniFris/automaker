import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TerminalHostPort {
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly shellPaths: readonly string[];
  shellExists(candidate: string): boolean;
  wslVersion(): string | undefined;
}

/** Read-only OS discovery, independent of provider/profile and workspace allowlists. */
export function createTerminalHostPort(
  environment: Readonly<NodeJS.ProcessEnv>,
  platform: NodeJS.Platform,
  arch = os.arch()
): TerminalHostPort {
  const snapshot = Object.freeze({ ...environment });
  const shellPaths = Object.freeze(
    platform === 'win32'
      ? [
          'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
          'C:\\Program Files\\PowerShell\\7-preview\\pwsh.exe',
          'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
          snapshot.COMSPEC || 'C:\\Windows\\System32\\cmd.exe',
          'pwsh.exe',
          'pwsh',
          'powershell.exe',
          'powershell',
          'cmd.exe',
          'cmd',
        ]
      : [
          '/bin/zsh',
          '/bin/bash',
          '/bin/sh',
          '/usr/bin/zsh',
          '/usr/bin/bash',
          '/usr/bin/sh',
          '/usr/local/bin/zsh',
          '/usr/local/bin/bash',
          '/opt/homebrew/bin/zsh',
          '/opt/homebrew/bin/bash',
          'zsh',
          'bash',
          'sh',
        ]
  );
  const absolute = platform === 'win32' ? path.win32.isAbsolute : path.posix.isAbsolute;
  return Object.freeze({
    environment: snapshot,
    platform,
    arch,
    shellPaths,
    shellExists: (candidate: string) =>
      shellPaths.includes(candidate) && absolute(candidate) && existsSync(candidate),
    wslVersion: () => {
      if (platform !== 'linux') return undefined;
      try {
        return readFileSync('/proc/version', 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
  });
}
