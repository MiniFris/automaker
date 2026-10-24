import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  getClaudeCliPaths,
  getGitHubCliPaths,
  getClaudeAuthIndicators,
  getCodexAuthIndicators,
  systemPathAccess,
  type ClaudeAuthIndicators,
} from '@automaker/platform';
import { HOST_ENVIRONMENT, RuntimePathsService } from '../config/index.js';

export interface HostCliInstallation {
  installed: boolean;
  version: string;
  path: string;
  method: 'none' | 'path' | 'local';
}

export type ClaudeStatusIndicators = Pick<
  ClaudeAuthIndicators,
  | 'hasCredentialsFile'
  | 'hasSettingsFile'
  | 'hasStatsCacheWithActivity'
  | 'hasProjectsSessions'
  | 'credentials'
>;

/** Host-only read port. No application service launches commands or reads OS globals. */
export abstract class SetupStatusRuntime {
  abstract platformInfo(): { platform: string; arch: string; homeDir: string };
  abstract detect(name: 'claude' | 'gh'): Promise<HostCliInstallation>;
  abstract claudeIndicators(): Promise<ClaudeStatusIndicators>;
  abstract codexIndicators(): Promise<{
    hasApiKey: boolean;
    hasAuthFile: boolean;
    hasOAuthToken: boolean;
  }>;
  abstract cursorCredentials(): Promise<boolean>;
  abstract githubAuthentication(
    cliPath: string
  ): Promise<{ authenticated: boolean; user: string | null }>;
}

@Injectable()
export class NodeSetupStatusRuntime extends SetupStatusRuntime implements OnApplicationShutdown {
  private readonly active = new Set<Promise<unknown>>();
  private closing: Promise<void> | undefined;

  constructor(
    @Inject(HOST_ENVIRONMENT) private readonly environment: Readonly<NodeJS.ProcessEnv>,
    @Inject(RuntimePathsService) private readonly paths: RuntimePathsService
  ) {
    super();
  }

  platformInfo() {
    this.assertAccepting();
    return { platform: os.platform(), arch: os.arch(), homeDir: os.homedir() };
  }

  detect(name: 'claude' | 'gh'): Promise<HostCliInstallation> {
    return this.track(async () => {
      const status: HostCliInstallation = {
        installed: false,
        version: '',
        path: '',
        method: 'none',
      };
      try {
        const found = await this.run(os.platform() === 'win32' ? 'where' : 'which', [name]);
        status.path = found.trim().split(/\r?\n/)[0];
        if (status.path) {
          status.installed = true;
          status.method = 'path';
        }
      } catch {
        /* Try the host's known installation paths below. */
      }
      if (!status.installed) {
        for (const candidate of name === 'claude' ? getClaudeCliPaths() : getGitHubCliPaths()) {
          try {
            if (await systemPathAccess(candidate)) {
              status.path = candidate;
              status.installed = true;
              status.method = 'local';
              break;
            }
          } catch {
            /* A missing/inaccessible candidate is not an HTTP error. */
          }
        }
      }
      if (status.installed) {
        try {
          status.version = (await this.run(status.path, ['--version'])).trim();
        } catch {
          /* Installation and version availability are independent. */
        }
      }
      return status;
    });
  }

  claudeIndicators(): Promise<ClaudeStatusIndicators> {
    return this.track(() => getClaudeAuthIndicators());
  }

  codexIndicators() {
    return this.track(() => getCodexAuthIndicators());
  }

  cursorCredentials(): Promise<boolean> {
    return this.track(async () => {
      const home = os.homedir();
      for (const file of [
        path.join(home, '.cursor', 'credentials.json'),
        path.join(home, '.config', 'cursor', 'credentials.json'),
      ]) {
        let text: string;
        try {
          text = await readFile(file, 'utf8');
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
            continue;
          throw error;
        }
        let credentials: unknown;
        try {
          credentials = JSON.parse(text);
        } catch {
          continue;
        }
        if (credentials && typeof credentials === 'object') {
          const record = credentials as Record<string, unknown>;
          if (
            [record.accessToken, record.token].some(
              (value) => typeof value === 'string' && value.trim().length > 0
            )
          )
            return true;
        }
      }
      return false;
    });
  }

  githubAuthentication(cliPath: string) {
    return this.track(async () => {
      try {
        const user = (await this.run(cliPath, ['api', 'user', '--jq', '.login'])).trim();
        if (user) return { authenticated: true, user };
      } catch {
        /* GH_TOKEN may still be usable when the API request fails. */
      }
      try {
        const output = await this.run(cliPath, ['auth', 'status']);
        const user =
          output.match(/Logged in to [^\s]+ account ([^\s]+)/i) ||
          output.match(/Logged in to [^\s]+ as ([^\s]+)/i);
        return { authenticated: true, user: user?.[1] ?? null };
      } catch {
        return { authenticated: false, user: null };
      }
    });
  }

  private run(command: string, args: string[]): Promise<string> {
    const platform = os.platform();
    const home = this.environment.HOME;
    const env = { ...this.environment };
    // Preserve the previous GH extended PATH behavior, using this app's snapshot.
    env.PATH = [
      env.PATH ?? env.Path,
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/home/linuxbrew/.linuxbrew/bin',
      ...(home ? [`${home}/.local/bin`] : []),
    ]
      .filter(Boolean)
      .join(platform === 'win32' ? ';' : ':');
    if (platform === 'win32') {
      for (const key of Object.keys(env)) {
        if (key !== 'PATH' && key.toUpperCase() === 'PATH') delete env[key];
      }
    }
    return new Promise((resolve, reject) => {
      execFile(
        command,
        args,
        {
          cwd: this.paths.workingDirectory,
          env,
          encoding: 'utf8',
          timeout: 10_000,
          maxBuffer: 128 * 1024,
          windowsHide: true,
          shell: false,
        },
        (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        }
      );
    });
  }

  private track<T>(operation: () => Promise<T>): Promise<T> {
    this.assertAccepting();
    const pending = Promise.resolve().then(operation);
    this.active.add(pending);
    void pending.then(
      () => {
        this.active.delete(pending);
      },
      () => {
        this.active.delete(pending);
      }
    );
    return pending;
  }

  private assertAccepting() {
    if (this.closing)
      throw new ServiceUnavailableException({
        success: false,
        error: 'Setup status is shutting down.',
      });
  }

  onApplicationShutdown(): Promise<void> {
    this.closing ??= Promise.allSettled([...this.active]).then(() => undefined);
    return this.closing;
  }
}
