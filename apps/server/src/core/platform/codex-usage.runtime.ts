import { access, stat, readdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface CodexUsageSnapshot {
  environment: Readonly<NodeJS.ProcessEnv>;
  workingDirectory: string;
  cliPath: string | null;
  authFilePath: string;
}
export abstract class CodexUsageRuntime {
  abstract snapshot(signal?: AbortSignal): Promise<CodexUsageSnapshot>;
  abstract readAuth(file: string): Promise<string>;
}

/** Context-explicit host discovery; never invokes a CLI or reads credentials during discovery. */
export class NodeCodexUsageRuntime extends CodexUsageRuntime {
  constructor(
    private readonly environmentReader: () => Promise<Readonly<NodeJS.ProcessEnv>>,
    private readonly workingDirectory: string
  ) {
    super();
  }

  async snapshot(signal?: AbortSignal): Promise<CodexUsageSnapshot> {
    signal?.throwIfAborted();
    const environment = Object.freeze({ ...(await this.environmentReader()) });
    signal?.throwIfAborted();
    const home = path.resolve(
      this.workingDirectory,
      environment.HOME || environment.USERPROFILE || os.homedir()
    );
    const windows = process.platform === 'win32';
    const names = windows ? ['codex.exe', 'codex.cmd', 'codex'] : ['codex'];
    const search = (environment.PATH ?? environment.Path ?? '')
      .split(path.delimiter)
      .filter(Boolean)
      .flatMap((directory) =>
        names.map((name) => path.resolve(this.workingDirectory, directory, name))
      );
    const roots = [
      path.join(home, '.local', 'bin'),
      path.join(home, '.npm-global', 'bin'),
      path.join(home, '.volta', 'bin'),
      environment.PNPM_HOME || path.join(home, '.local', 'share', 'pnpm'),
      path.join(home, '.yarn', 'bin'),
      path.join(home, '.config', 'yarn', 'global', 'node_modules', '.bin'),
    ];
    if (windows)
      roots.push(
        path.join(environment.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm'),
        path.join(
          environment.APPDATA || path.join(home, 'AppData', 'Roaming'),
          '.npm-global',
          'bin'
        ),
        path.join(environment.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'pnpm')
      );
    else {
      roots.push(
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        '/home/linuxbrew/.linuxbrew/bin',
        '/snap/bin'
      );
      for (const [directory, suffix] of [
        [path.join(environment.NVM_DIR || path.join(home, '.nvm'), 'versions', 'node'), 'bin'],
        [path.join(home, '.local', 'share', 'fnm', 'node-versions'), 'installation/bin'],
        [path.join(home, '.fnm', 'node-versions'), 'installation/bin'],
        [
          path.join(home, 'Library', 'Application Support', 'fnm', 'node-versions'),
          'installation/bin',
        ],
      ]) {
        signal?.throwIfAborted();
        try {
          const versions = await readdir(path.resolve(this.workingDirectory, directory));
          if (versions.length > 1024) throw new Error('Codex discovery limit exceeded.');
          for (const version of versions) roots.push(path.join(directory, version, suffix));
        } catch (error) {
          if (
            !['ENOENT', 'EACCES', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')
          )
            throw error;
        }
      }
    }
    if (windows && environment.NVM_SYMLINK) roots.push(environment.NVM_SYMLINK);
    const candidates = [
      ...new Set([
        ...search,
        ...roots.flatMap((directory) =>
          names.map((name) => path.resolve(this.workingDirectory, directory, name))
        ),
      ]),
    ];
    let cliPath: string | null = null;
    for (const candidate of candidates) {
      signal?.throwIfAborted();
      try {
        if (!(await stat(candidate)).isFile()) continue;
        await access(candidate, windows ? constants.F_OK : constants.X_OK);
        cliPath = candidate;
        break;
      } catch {
        /* An inaccessible candidate is not an installation. */
      }
    }
    return {
      environment,
      workingDirectory: this.workingDirectory,
      cliPath,
      authFilePath: path.join(
        environment.CODEX_HOME
          ? path.resolve(this.workingDirectory, environment.CODEX_HOME)
          : path.join(home, '.codex'),
        'auth.json'
      ),
    };
  }

  async readAuth(file: string): Promise<string> {
    const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      if (!(await handle.stat()).isFile())
        throw new Error('Codex local metadata is not a regular file.');
      const chunks: Buffer[] = [];
      let bytes = 0;
      for (;;) {
        const buffer = Buffer.alloc(65536);
        const { bytesRead } = await handle.read(buffer);
        if (!bytesRead) return Buffer.concat(chunks).toString('utf8');
        bytes += bytesRead;
        if (bytes > 1048576) throw new Error('Codex local metadata exceeds its limit.');
        chunks.push(buffer.subarray(0, bytesRead));
      }
    } finally {
      await handle.close();
    }
  }
}
