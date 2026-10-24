import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { getClaudeAuthIndicators, getClaudeCliPaths, systemPathAccess } from '@automaker/platform';
import { NodeSetupStatusRuntime } from '../../../src/core/platform/setup-status.runtime.js';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('node:fs/promises', async () => ({
  ...(await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')),
  readFile: vi.fn(),
}));
vi.mock('node:os', () => ({
  default: { platform: vi.fn(() => 'linux'), arch: () => 'arm64', homedir: () => '/fixture/home' },
}));
vi.mock('@automaker/platform', () => ({
  getClaudeCliPaths: vi.fn(() => ['/fallback/claude']),
  getGitHubCliPaths: vi.fn(() => ['/fallback/gh']),
  systemPathAccess: vi.fn(async () => false),
  getClaudeAuthIndicators: vi.fn(async () => ({ hasCredentialsFile: false })),
  getCodexAuthIndicators: vi.fn(async () => ({
    hasApiKey: false,
    hasAuthFile: false,
    hasOAuthToken: false,
  })),
}));

type Callback = (error: Error | null, stdout: string) => void;
const child = () => ({}) as ReturnType<typeof execFile>;
const respond = (operation: (command: string, args: string[], done: Callback) => void) => {
  vi.mocked(execFile).mockImplementation((...input: unknown[]) => {
    operation(String(input[0]), input[1] as string[], input[3] as Callback);
    return child();
  });
};
const runtime = (
  environment: NodeJS.ProcessEnv = {
    PATH: '/fixture/bin',
    HOME: '/fixture/user',
    GH_TOKEN: 'private-token',
  }
) => new NodeSetupStatusRuntime(environment, { workingDirectory: '/fixture/app' } as never);

beforeEach(() => {
  vi.mocked(readFile)
    .mockReset()
    .mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  vi.clearAllMocks();
  vi.mocked(os.platform).mockReturnValue('linux');
  vi.mocked(systemPathAccess).mockResolvedValue(false);
  vi.mocked(getClaudeCliPaths).mockReturnValue(['/fallback/claude']);
  respond((_command, args, done) =>
    done(null, args[0] === '--version' ? 'v1\n' : '/fixture/cli\n')
  );
});

describe('bounded host setup status runtime', () => {
  it('reads Codex file evidence without executing a CLI', async () => {
    expect(await runtime().codexIndicators()).toEqual({
      hasApiKey: false,
      hasAuthFile: false,
      hasOAuthToken: false,
    });
    expect(execFile).not.toHaveBeenCalled();
  });
  it('recognizes only nonempty token strings in known Cursor credential paths', async () => {
    vi.mocked(readFile)
      .mockResolvedValueOnce('{"accessToken":true}')
      .mockResolvedValueOnce('{"token":"fixture-token"}');
    expect(await runtime().cursorCredentials()).toBe(true);
    expect(readFile).toHaveBeenNthCalledWith(1, '/fixture/home/.cursor/credentials.json', 'utf8');
    expect(readFile).toHaveBeenNthCalledWith(
      2,
      '/fixture/home/.config/cursor/credentials.json',
      'utf8'
    );
    expect(execFile).not.toHaveBeenCalled();
  });
  it('does not invent credentials from missing or malformed Cursor JSON', async () => {
    vi.mocked(readFile).mockResolvedValueOnce('malformed');
    expect(await runtime().cursorCredentials()).toBe(false);
  });
  it('propagates unreadable Cursor evidence instead of treating it as absent', async () => {
    vi.mocked(readFile).mockRejectedValueOnce(
      Object.assign(new Error('denied'), { code: 'EACCES' })
    );
    await expect(runtime().cursorCredentials()).rejects.toMatchObject({ code: 'EACCES' });
  });
  it('detects a CLI and executes the resolved binary with bounded, shell-free arguments', async () => {
    expect(await runtime().detect('claude')).toEqual({
      installed: true,
      path: '/fixture/cli',
      version: 'v1',
      method: 'path',
    });
    expect(execFile).toHaveBeenNthCalledWith(
      1,
      'which',
      ['claude'],
      expect.objectContaining({
        cwd: '/fixture/app',
        shell: false,
        timeout: 10_000,
        maxBuffer: 131072,
      }),
      expect.any(Function)
    );
    expect(execFile).toHaveBeenNthCalledWith(
      2,
      '/fixture/cli',
      ['--version'],
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('uses the injected environment snapshot for subprocesses, including extended PATH', async () => {
    await runtime().detect('gh');
    expect(vi.mocked(execFile).mock.calls[0][2]).toMatchObject({
      env: {
        GH_TOKEN: 'private-token',
        HOME: '/fixture/user',
        PATH: '/fixture/bin:/opt/homebrew/bin:/usr/local/bin:/home/linuxbrew/.linuxbrew/bin:/fixture/user/.local/bin',
      },
    });
  });

  it('uses Windows where with a vector argument instead of interpolating a shell command', async () => {
    vi.mocked(os.platform).mockReturnValue('win32');
    await runtime().detect('gh');
    expect(execFile).toHaveBeenNthCalledWith(
      1,
      'where',
      ['gh'],
      expect.objectContaining({ shell: false, windowsHide: true }),
      expect.any(Function)
    );
  });

  it('normalizes duplicate Windows PATH casing before spawning', async () => {
    vi.mocked(os.platform).mockReturnValue('win32');
    await runtime({ PATH: 'primary', Path: 'secondary' }).detect('gh');
    const options = vi.mocked(execFile).mock.calls[0][2] as { env: NodeJS.ProcessEnv };
    expect(options.env.PATH).toMatch(/^primary;/);
    expect(options.env.Path).toBeUndefined();
  });

  it('tries known paths when discovery returns an empty result', async () => {
    vi.mocked(systemPathAccess).mockResolvedValue(true);
    respond((_command, args, done) => done(null, args[0] === '--version' ? 'v2' : ''));
    expect(await runtime().detect('gh')).toMatchObject({
      installed: true,
      path: '/fallback/gh',
      method: 'local',
      version: 'v2',
    });
  });

  it('treats whitespace/metacharacters in a detected path as an executable filename, never shell syntax', async () => {
    const cli = '/fallback/Claude CLI; echo injected';
    vi.mocked(getClaudeCliPaths).mockReturnValue([cli]);
    vi.mocked(systemPathAccess).mockResolvedValue(true);
    respond((command, _args, done) =>
      command === 'which' ? done(new Error('missing'), '') : done(null, 'version')
    );
    expect((await runtime().detect('claude')).path).toBe(cli);
    expect(execFile).toHaveBeenLastCalledWith(
      cli,
      ['--version'],
      expect.objectContaining({ shell: false }),
      expect.any(Function)
    );
  });

  it('returns not installed when no installation can be located', async () => {
    respond((_command, _args, done) => done(new Error('missing'), ''));
    expect(await runtime().detect('claude')).toEqual({
      installed: false,
      version: '',
      path: '',
      method: 'none',
    });
  });

  it('keeps installation evidence when a version check fails', async () => {
    respond((_command, args, done) =>
      args[0] === '--version'
        ? done(new Error('version unsupported'), '')
        : done(null, '/fixture/cli')
    );
    expect(await runtime().detect('claude')).toMatchObject({ installed: true, version: '' });
  });

  it('uses the resolved GitHub path for API auth and stops after a nonempty login', async () => {
    respond((_command, _args, done) => done(null, 'fixture-user\n'));
    expect(await runtime().githubAuthentication('/fallback/gh')).toEqual({
      authenticated: true,
      user: 'fixture-user',
    });
    expect(execFile).toHaveBeenCalledExactlyOnceWith(
      '/fallback/gh',
      ['api', 'user', '--jq', '.login'],
      expect.any(Object),
      expect.any(Function)
    );
  });

  it.each(['', 'failure'])(
    'does not infer authentication after an empty/failed API response (%s)',
    async (api) => {
      respond((_command, args, done) =>
        args[0] === 'api'
          ? done(api ? new Error('API failed') : null, '')
          : done(null, 'Logged in to github.com account fixture-user')
      );
      expect(await runtime().githubAuthentication('/fixture/gh')).toEqual({
        authenticated: false,
        user: null,
      });
      expect(execFile).toHaveBeenCalledTimes(1);
    }
  );

  it('does not return raw auth command errors', async () => {
    respond((_command, _args, done) => done(new Error('private-token'), ''));
    expect(await runtime().githubAuthentication('/fixture/gh')).toEqual({
      authenticated: false,
      user: null,
    });
  });

  it('drains an accepted multi-command probe on shutdown and closes admission', async () => {
    const callbacks: Callback[] = [];
    respond((_command, _args, done) => {
      callbacks.push(done);
    });
    const host = runtime();
    const detection = host.detect('claude');
    await Promise.resolve();
    let closed = false;
    const closing = host.onApplicationShutdown();
    expect(host.onApplicationShutdown()).toBe(closing);
    void closing.then(() => {
      closed = true;
    });
    expect(() => host.detect('gh')).toThrow();
    expect(() => host.platformInfo()).toThrow();
    callbacks[0](null, '/fixture/cli');
    await Promise.resolve();
    expect(closed).toBe(false);
    callbacks[1](null, 'version');
    await detection;
    await closing;
    expect(closed).toBe(true);
  });

  it('reads auth indicators through the platform port without executing a model', async () => {
    expect(await runtime().claudeIndicators()).toEqual({ hasCredentialsFile: false });
    expect(getClaudeAuthIndicators).toHaveBeenCalledOnce();
    expect(execFile).not.toHaveBeenCalled();
  });
});
