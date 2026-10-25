import { Inject, Injectable } from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { HOST_ENVIRONMENT, RuntimePathsService } from '../config/index.js';
import {
  captureNativeLocalEnvironment,
  localComspec,
} from '../../services/execution-environment/local.js';

/** Immutable host tooling/profile authority, separate from rotating application credentials. */
@Injectable()
export class HostCliDiscovery {
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly homeDirectory: string;
  readonly workingDirectory: string;
  constructor(
    @Inject(HOST_ENVIRONMENT) environment: Readonly<NodeJS.ProcessEnv>,
    @Inject(RuntimePathsService) paths: RuntimePathsService
  ) {
    this.environment = captureNativeLocalEnvironment(environment);
    this.workingDirectory = paths.workingDirectory;
    this.homeDirectory = path.resolve(
      this.workingDirectory,
      this.value('HOME') || this.value('USERPROFILE') || this.workingDirectory
    );
    Object.freeze(this);
  }
  value(name: string): string | undefined {
    return process.platform === 'win32'
      ? Object.entries(this.environment).find(
          ([key]) => key.toLowerCase() === name.toLowerCase()
        )?.[1]
      : this.environment[name];
  }
  resolve(candidate: string): string {
    return path.resolve(this.workingDirectory, candidate);
  }
  existing(candidate: string): boolean {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  }
  directory(candidate: string): string[] {
    try {
      return fs.readdirSync(candidate);
    } catch {
      return [];
    }
  }
  findInPath(name: string, cwd = this.workingDirectory): string | null {
    const suffixes =
      process.platform === 'win32' && !path.extname(name)
        ? ['', ...(this.value('PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';')]
        : [''];
    const search = this.value('PATH') ?? (process.platform === 'win32' ? '' : '/usr/bin:/bin');
    for (const segment of search.split(path.delimiter))
      for (const suffix of suffixes) {
        const candidate = path.resolve(cwd, segment.replace(/^"|"$/g, ''), name + suffix);
        try {
          if (!fs.statSync(candidate).isFile()) continue;
          fs.accessSync(
            candidate,
            process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK
          );
          return candidate;
        } catch {
          /* Next candidate, never an ambient PATH. */
        }
      }
    return null;
  }
  get shell(): string | undefined {
    return process.platform === 'win32'
      ? localComspec(this.environment) ||
          (this.value('SystemRoot')
            ? path.win32.join(this.value('SystemRoot')!, 'System32', 'cmd.exe')
            : 'cmd.exe')
      : undefined;
  }
  runSync(
    command: string,
    args: string[],
    environment: Readonly<NodeJS.ProcessEnv> = this.environment,
    timeout = 5000
  ): string {
    return execFileSync(command, args, {
      env: { ...environment },
      cwd: this.workingDirectory,
      encoding: 'utf8',
      timeout,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      ...(process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)
        ? { shell: this.shell }
        : {}),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
  wslAvailable(): boolean {
    if (process.platform !== 'win32') return false;
    const cli = this.wslExecutable();
    if (!cli) return false;
    try {
      this.runSync(cli, ['echo', 'ok']);
      return true;
    } catch {
      try {
        this.runSync(cli, ['--status']);
        return true;
      } catch {
        return false;
      }
    }
  }
  wslExecutable(): string | null {
    return (
      this.findInPath('wsl.exe') ||
      (this.value('SystemRoot') &&
      this.existing(path.win32.join(this.value('SystemRoot')!, 'System32', 'wsl.exe'))
        ? path.win32.join(this.value('SystemRoot')!, 'System32', 'wsl.exe')
        : null)
    );
  }
  findWsl(name: string, distribution?: string): { wslPath: string; distribution?: string } | null {
    const cli = this.wslExecutable();
    if (!cli || !this.wslAvailable()) return null;
    let distributions: (string | undefined)[] = [distribution];
    if (!distribution) {
      try {
        const priority = ['ubuntu', 'debian', 'opensuse', 'fedora', 'arch'];
        const names = this.runSync(cli, ['--list', '--quiet'])
          .replace(/\0/g, '')
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter((value) => value && !/docker-desktop/i.test(value));
        names.sort(
          (a, b) =>
            (priority.findIndex((value) => a.toLowerCase().includes(value)) + 1 || 99) -
            (priority.findIndex((value) => b.toLowerCase().includes(value)) + 1 || 99)
        );
        distributions = [...names, undefined];
      } catch {
        /* Default distribution remains available. */
      }
    }
    for (const distro of distributions) {
      const prefix = distro ? ['-d', distro] : [];
      try {
        const found = this.runSync(cli, [...prefix, 'which', name]).trim();
        if (found.startsWith('/')) return { wslPath: found, distribution: distro };
      } catch {
        /* Common guest installation paths. */
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) continue;
      for (const base of ['$HOME/.local/bin', '/usr/local/bin', '/usr/bin'])
        try {
          const found = this.runSync(cli, [
            ...prefix,
            'sh',
            '-c',
            `test -x ${base}/${name} && echo ${base}/${name}`,
          ]).trim();
          if (found.startsWith('/')) return { wslPath: found, distribution: distro };
        } catch {
          /* Next guest candidate. */
        }
    }
    return null;
  }
  commonPaths(name: string): string[] {
    const home = this.homeDirectory,
      appData = this.value('APPDATA') || path.join(home, 'AppData', 'Roaming');
    if (process.platform === 'win32') {
      const basic = [
        path.join(home, '.local', 'bin', `${name}.exe`),
        path.join(appData, 'npm', `${name}.cmd`),
        path.join(appData, 'npm', name),
        path.join(appData, '.npm-global', 'bin', `${name}.cmd`),
        path.join(appData, '.npm-global', 'bin', name),
      ];
      if (name === 'gh')
        return [
          path.join(
            this.value('LOCALAPPDATA') || path.join(home, 'AppData', 'Local'),
            'Programs',
            'gh',
            'bin',
            'gh.exe'
          ),
          ...(this.value('ProgramFiles')
            ? [path.join(this.value('ProgramFiles')!, 'GitHub CLI', 'gh.exe')]
            : []),
        ];
      return [
        ...basic,
        ...(this.value('NVM_SYMLINK')
          ? [
              path.join(this.value('NVM_SYMLINK')!, `${name}.cmd`),
              path.join(this.value('NVM_SYMLINK')!, name),
            ]
          : []),
      ];
    }
    if (name === 'gh')
      return [
        '/opt/homebrew/bin/gh',
        '/usr/local/bin/gh',
        path.join(home, '.local', 'bin', 'gh'),
        '/home/linuxbrew/.linuxbrew/bin/gh',
      ];
    if (name === 'claude')
      return [
        path.join(home, '.local', 'bin', 'claude'),
        path.join(home, '.claude', 'local', 'claude'),
        '/usr/local/bin/claude',
        path.join(home, '.npm-global', 'bin', 'claude'),
      ];
    return [
      path.join(home, '.local', 'bin', name),
      path.join(home, `.${name}`, 'bin', name),
      path.join(home, '.npm-global', 'bin', name),
      '/usr/local/bin/' + name,
    ];
  }
  codexPath(): string | null {
    const home = this.homeDirectory;
    let candidates: string[];
    if (process.platform === 'win32') {
      const appData = this.value('APPDATA') || path.join(home, 'AppData', 'Roaming'),
        local = this.value('LOCALAPPDATA') || path.join(home, 'AppData', 'Local');
      candidates = [
        path.join(home, '.local', 'bin', 'codex.exe'),
        path.join(appData, 'npm', 'codex.cmd'),
        path.join(appData, 'npm', 'codex'),
        path.join(appData, '.npm-global', 'bin', 'codex.cmd'),
        path.join(appData, '.npm-global', 'bin', 'codex'),
        path.join(home, '.volta', 'bin', 'codex.exe'),
        path.join(local, 'pnpm', 'codex.cmd'),
        path.join(local, 'pnpm', 'codex'),
        ...(this.value('NVM_SYMLINK')
          ? [
              path.join(this.value('NVM_SYMLINK')!, 'codex.cmd'),
              path.join(this.value('NVM_SYMLINK')!, 'codex'),
            ]
          : []),
      ];
    } else {
      const nvm = path.join(this.value('NVM_DIR') || path.join(home, '.nvm'), 'versions', 'node');
      const fnm = [
        path.join(home, '.local', 'share', 'fnm', 'node-versions'),
        path.join(home, '.fnm', 'node-versions'),
        path.join(home, 'Library', 'Application Support', 'fnm', 'node-versions'),
      ];
      candidates = [
        path.join(home, '.local', 'bin', 'codex'),
        '/opt/homebrew/bin/codex',
        '/usr/local/bin/codex',
        '/usr/bin/codex',
        path.join(home, '.npm-global', 'bin', 'codex'),
        '/home/linuxbrew/.linuxbrew/bin/codex',
        path.join(home, '.volta', 'bin', 'codex'),
        path.join(this.value('PNPM_HOME') || path.join(home, '.local', 'share', 'pnpm'), 'codex'),
        path.join(home, '.yarn', 'bin', 'codex'),
        path.join(home, '.config', 'yarn', 'global', 'node_modules', '.bin', 'codex'),
        '/snap/bin/codex',
        ...this.directory(nvm).map((version) => path.join(nvm, version, 'bin', 'codex')),
        ...fnm.flatMap((base) =>
          this.directory(base).map((version) =>
            path.join(base, version, 'installation', 'bin', 'codex')
          )
        ),
      ];
    }
    return candidates.find((candidate) => this.existing(candidate)) ?? this.findInPath('codex');
  }
  get codexDirectory(): string {
    return this.value('CODEX_HOME')
      ? this.resolve(this.value('CODEX_HOME')!)
      : path.join(this.homeDirectory, '.codex');
  }
  toolEnvironment(environment: Readonly<NodeJS.ProcessEnv>): Readonly<NodeJS.ProcessEnv> {
    return captureNativeLocalEnvironment(environment);
  }
  codexEnvironment(environment: Readonly<NodeJS.ProcessEnv>): Readonly<NodeJS.ProcessEnv> {
    return {
      ...this.toolEnvironment(environment),
      ...(this.value('CODEX_HOME') ? { CODEX_HOME: this.codexDirectory } : {}),
    };
  }
  async readText(file: string): Promise<string | null> {
    try {
      return await fs.promises.readFile(file, 'utf8');
    } catch {
      return null;
    }
  }
  async codexIndicators(): Promise<{
    hasAuthFile: boolean;
    hasOAuthToken: boolean;
    hasApiKey: boolean;
  }> {
    const raw = await this.readText(path.join(this.codexDirectory, 'auth.json'));
    if (raw === null) return { hasAuthFile: false, hasOAuthToken: false, hasApiKey: false };
    let auth: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) auth = parsed;
    } catch {
      /* Legacy malformed-profile hint semantics. */
    }
    const tokens =
      auth.tokens && typeof auth.tokens === 'object' && !Array.isArray(auth.tokens)
        ? (auth.tokens as Record<string, unknown>)
        : {};
    const has = (keys: string[]) =>
      keys.some((key) =>
        [auth[key], tokens[key]].some(
          (value) => typeof value === 'string' && value.trim().length > 0
        )
      );
    return {
      hasAuthFile: true,
      hasOAuthToken: has(['access_token', 'oauth_token']),
      hasApiKey: has(['api_key', 'OPENAI_API_KEY']),
    };
  }
}
