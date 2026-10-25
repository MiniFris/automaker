import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TerminalService } from '@/services/terminal-service.js';
import * as pty from 'node-pty';
import * as os from 'os';
import * as path from 'path';
import * as platform from '@automaker/platform';
import * as secureFs from '@/lib/secure-fs.js';

vi.mock('node-pty');
vi.mock('os');
vi.mock('@automaker/platform', async () => {
  const actual = await vi.importActual('@automaker/platform');
  return {
    ...actual,
    systemPathExists: vi.fn(),
    systemPathReadFileSync: vi.fn(),
    getWslVersionPath: vi.fn(),
    getShellPaths: vi.fn(), // Mock shell paths for cross-platform testing
    isAllowedSystemPath: vi.fn(() => true), // Allow all paths in tests
  };
});
vi.mock('@/lib/secure-fs.js');

describe('terminal-service.ts', () => {
  let service: TerminalService;
  let mockPtyProcess: any;

  // Shell paths for each platform (matching system-paths.ts)
  const linuxShellPaths = [
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
  ];

  const windowsShellPaths = [
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    'C:\\Program Files\\PowerShell\\7-preview\\pwsh.exe',
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    'C:\\Windows\\System32\\cmd.exe',
    'pwsh.exe',
    'pwsh',
    'powershell.exe',
    'powershell',
    'cmd.exe',
    'cmd',
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TerminalService();

    // Mock PTY process
    mockPtyProcess = {
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    };
    mockPtyProcess.kill.mockImplementation(() => {
      for (const [exit] of mockPtyProcess.onExit.mock.calls) exit({ exitCode: 0 });
    });

    vi.mocked(pty.spawn).mockReturnValue(mockPtyProcess);
    vi.mocked(os.homedir).mockReturnValue('/home/user');
    vi.mocked(os.platform).mockReturnValue('linux');
    vi.mocked(os.arch).mockReturnValue('x64');

    // Default mocks for system paths and secureFs
    vi.mocked(platform.systemPathExists).mockReturnValue(true);
    vi.mocked(platform.systemPathReadFileSync).mockReturnValue('');
    vi.mocked(platform.getWslVersionPath).mockReturnValue('/proc/version');
    vi.mocked(platform.getShellPaths).mockReturnValue(linuxShellPaths); // Default to Linux paths
    vi.mocked(secureFs.stat).mockResolvedValue({ isDirectory: () => true } as any);
  });

  afterEach(async () => {
    await service.cleanup();
  });

  describe('detectShell', () => {
    it('should detect PowerShell Core on Windows when available', () => {
      vi.mocked(os.platform).mockReturnValue('win32');
      vi.mocked(platform.getShellPaths).mockReturnValue(windowsShellPaths);
      vi.mocked(platform.systemPathExists).mockImplementation((path: string) => {
        return path === 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
      });

      const result = service.detectShell();

      expect(result.shell).toBe('C:\\Program Files\\PowerShell\\7\\pwsh.exe');
      expect(result.args).toEqual([]);
    });

    it('should fall back to PowerShell on Windows if Core not available', () => {
      vi.mocked(os.platform).mockReturnValue('win32');
      vi.mocked(platform.getShellPaths).mockReturnValue(windowsShellPaths);
      vi.mocked(platform.systemPathExists).mockImplementation((path: string) => {
        return path === 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
      });

      const result = service.detectShell();

      expect(result.shell).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
      expect(result.args).toEqual([]);
    });

    it('should fall back to cmd.exe on Windows if no PowerShell', () => {
      vi.mocked(os.platform).mockReturnValue('win32');
      vi.mocked(platform.getShellPaths).mockReturnValue(windowsShellPaths);
      vi.mocked(platform.systemPathExists).mockReturnValue(false);

      const result = service.detectShell();

      expect(result.shell).toBe('cmd.exe');
      expect(result.args).toEqual([]);
    });

    it('should detect user shell on macOS', () => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/zsh' });
      vi.mocked(platform.systemPathExists).mockReturnValue(true);

      const result = service.detectShell();

      expect(result.shell).toBe('/bin/zsh');
      expect(result.args).toEqual(['--login']);
    });

    it('should fall back to zsh on macOS if user shell not available', () => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.spyOn(process, 'env', 'get').mockReturnValue({});
      vi.mocked(platform.systemPathExists).mockImplementation((path: string) => {
        return path === '/bin/zsh';
      });

      const result = service.detectShell();

      expect(result.shell).toBe('/bin/zsh');
      expect(result.args).toEqual(['--login']);
    });

    it('should fall back to bash on macOS if zsh not available', () => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.spyOn(process, 'env', 'get').mockReturnValue({});
      // zsh not available, but bash is
      vi.mocked(platform.systemPathExists).mockImplementation((path: string) => {
        return path === '/bin/bash';
      });

      const result = service.detectShell();

      expect(result.shell).toBe('/bin/bash');
      expect(result.args).toEqual(['--login']);
    });

    it('should detect user shell on Linux', () => {
      vi.mocked(os.platform).mockReturnValue('linux');
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });
      vi.mocked(platform.systemPathExists).mockReturnValue(true);

      const result = service.detectShell();

      expect(result.shell).toBe('/bin/bash');
      expect(result.args).toEqual(['--login']);
    });

    it('should fall back to bash on Linux if user shell not available', () => {
      vi.mocked(os.platform).mockReturnValue('linux');
      vi.spyOn(process, 'env', 'get').mockReturnValue({});
      vi.mocked(platform.systemPathExists).mockImplementation((path: string) => {
        return path === '/bin/bash';
      });

      const result = service.detectShell();

      expect(result.shell).toBe('/bin/bash');
      expect(result.args).toEqual(['--login']);
    });

    it('should fall back to sh on Linux if bash not available', () => {
      vi.mocked(os.platform).mockReturnValue('linux');
      vi.spyOn(process, 'env', 'get').mockReturnValue({});
      vi.mocked(platform.systemPathExists).mockReturnValue(false);

      const result = service.detectShell();

      expect(result.shell).toBe('/bin/sh');
      expect(result.args).toEqual([]);
    });

    it('should detect WSL and use appropriate shell', () => {
      vi.mocked(os.platform).mockReturnValue('linux');
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });
      vi.mocked(platform.systemPathExists).mockReturnValue(true);
      vi.mocked(platform.systemPathReadFileSync).mockReturnValue(
        'Linux version 5.10.0-microsoft-standard-WSL2'
      );

      const result = service.detectShell();

      expect(result.shell).toBe('/bin/bash');
      expect(result.args).toEqual(['--login']);
    });
  });

  describe('isWSL', () => {
    it('should return true if /proc/version contains microsoft', () => {
      vi.mocked(platform.systemPathExists).mockReturnValue(true);
      vi.mocked(platform.systemPathReadFileSync).mockReturnValue(
        'Linux version 5.10.0-microsoft-standard-WSL2'
      );

      expect(service.isWSL()).toBe(true);
    });

    it('should return true if /proc/version contains wsl', () => {
      vi.mocked(platform.systemPathExists).mockReturnValue(true);
      vi.mocked(platform.systemPathReadFileSync).mockReturnValue('Linux version 5.10.0-wsl2');

      expect(service.isWSL()).toBe(true);
    });

    it('should return true if WSL_DISTRO_NAME is set', () => {
      vi.mocked(platform.systemPathExists).mockReturnValue(false);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ WSL_DISTRO_NAME: 'Ubuntu' });

      expect(service.isWSL()).toBe(true);
    });

    it('should return true if WSLENV is set', () => {
      vi.mocked(platform.systemPathExists).mockReturnValue(false);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ WSLENV: 'PATH/l' });

      expect(service.isWSL()).toBe(true);
    });

    it('should return false if not in WSL', () => {
      vi.mocked(platform.systemPathExists).mockReturnValue(false);
      vi.spyOn(process, 'env', 'get').mockReturnValue({});

      expect(service.isWSL()).toBe(false);
    });

    it('should return false if error reading /proc/version', () => {
      vi.mocked(platform.systemPathExists).mockReturnValue(true);
      vi.mocked(platform.systemPathReadFileSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      expect(service.isWSL()).toBe(false);
    });
  });

  describe('getPlatformInfo', () => {
    it('should return platform information', () => {
      vi.mocked(os.platform).mockReturnValue('linux');
      vi.mocked(os.arch).mockReturnValue('x64');
      vi.mocked(platform.systemPathExists).mockReturnValue(true);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const info = service.getPlatformInfo();

      expect(info.platform).toBe('linux');
      expect(info.arch).toBe('x64');
      expect(info.defaultShell).toBe('/bin/bash');
      expect(typeof info.isWSL).toBe('boolean');
    });
  });

  describe('createSession', () => {
    it('should create a new terminal session', async () => {
      vi.mocked(platform.systemPathExists).mockReturnValue(true);
      vi.mocked(secureFs.stat).mockResolvedValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const session = await service.createSession({
        cwd: '/test/dir',
        cols: 100,
        rows: 30,
      });

      expect(session).not.toBeNull();
      expect(session!.id).toMatch(/^term-/);
      expect(session!.cwd).toBe(path.resolve('/test/dir'));
      expect(session!.shell).toBe('/bin/bash');
      expect(pty.spawn).toHaveBeenCalledWith(
        '/bin/bash',
        ['--login'],
        expect.objectContaining({
          cwd: path.resolve('/test/dir'),
          cols: 100,
          rows: 30,
        })
      );
    });

    it('should use default cols and rows if not provided', async () => {
      vi.mocked(platform.systemPathExists).mockReturnValue(true);
      vi.mocked(secureFs.stat).mockResolvedValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      await service.createSession();

      expect(pty.spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          cols: 80,
          rows: 24,
        })
      );
    });

    it('should fall back to home directory if cwd does not exist', async () => {
      vi.mocked(platform.systemPathExists).mockReturnValue(true);
      vi.mocked(secureFs.stat).mockRejectedValue(new Error('ENOENT'));
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const session = await service.createSession({
        cwd: '/nonexistent',
      });

      expect(session).not.toBeNull();
      expect(session!.cwd).toBe('/home/user');
    });

    it('should fall back to home directory if cwd is not a directory', async () => {
      vi.mocked(platform.systemPathExists).mockReturnValue(true);
      vi.mocked(secureFs.stat).mockResolvedValue({ isDirectory: () => false } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const session = await service.createSession({
        cwd: '/file.txt',
      });

      expect(session).not.toBeNull();
      expect(session!.cwd).toBe('/home/user');
    });

    it('should fix double slashes in path', async () => {
      vi.mocked(platform.systemPathExists).mockReturnValue(true);
      vi.mocked(secureFs.stat).mockResolvedValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const session = await service.createSession({
        cwd: '//test/dir',
      });

      expect(session).not.toBeNull();
      expect(session!.cwd).toBe(path.resolve('/test/dir'));
    });

    it('should preserve WSL UNC paths', async () => {
      vi.mocked(platform.systemPathExists).mockReturnValue(true);
      vi.mocked(secureFs.stat).mockResolvedValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const session = await service.createSession({
        cwd: '//wsl$/Ubuntu/home',
      });

      expect(session).not.toBeNull();
      expect(session!.cwd).toBe('//wsl$/Ubuntu/home');
    });

    it('should handle data events from PTY', async () => {
      vi.useFakeTimers();
      vi.mocked(platform.systemPathExists).mockReturnValue(true);
      vi.mocked(secureFs.stat).mockResolvedValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const dataCallback = vi.fn();
      service.onData(dataCallback);

      await service.createSession();

      // Simulate data event
      const onDataHandler = mockPtyProcess.onData.mock.calls[0][0];
      onDataHandler('test data');

      // Wait for throttled output
      vi.advanceTimersByTime(20);

      expect(dataCallback).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should handle exit events from PTY', async () => {
      vi.mocked(platform.systemPathExists).mockReturnValue(true);
      vi.mocked(secureFs.stat).mockResolvedValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const exitCallback = vi.fn();
      service.onExit(exitCallback);

      const session = await service.createSession();

      // Simulate exit event
      const onExitHandler = mockPtyProcess.onExit.mock.calls[0][0];
      onExitHandler({ exitCode: 0 });
      await service.cleanup();

      expect(session).not.toBeNull();
      expect(exitCallback).toHaveBeenCalledWith(session!.id, 0);
      expect(service.getSession(session!.id)).toBeUndefined();
    });
  });

  describe('write', () => {
    it('should write data to existing session', async () => {
      vi.mocked(platform.systemPathExists).mockReturnValue(true);
      vi.mocked(secureFs.stat).mockResolvedValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const session = await service.createSession();
      const result = service.write(session!.id, 'ls\n');

      expect(result).toBe(true);
      expect(mockPtyProcess.write).toHaveBeenCalledWith('ls\n');
    });

    it('should return false for non-existent session', () => {
      const result = service.write('nonexistent', 'data');

      expect(result).toBe(false);
      expect(mockPtyProcess.write).not.toHaveBeenCalled();
    });
  });

  describe('resize', () => {
    it('should resize existing session', async () => {
      vi.mocked(platform.systemPathExists).mockReturnValue(true);
      vi.mocked(secureFs.stat).mockResolvedValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const session = await service.createSession();
      const result = service.resize(session!.id, 120, 40);

      expect(result).toBe(true);
      expect(mockPtyProcess.resize).toHaveBeenCalledWith(120, 40);
    });

    it('should return false for non-existent session', () => {
      const result = service.resize('nonexistent', 120, 40);

      expect(result).toBe(false);
      expect(mockPtyProcess.resize).not.toHaveBeenCalled();
    });

    it('should handle resize errors', async () => {
      vi.mocked(platform.systemPathExists).mockReturnValue(true);
      vi.mocked(secureFs.stat).mockResolvedValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });
      mockPtyProcess.resize.mockImplementation(() => {
        throw new Error('Resize failed');
      });

      const session = await service.createSession();
      const result = service.resize(session!.id, 120, 40);

      expect(result).toBe(false);
    });
  });

  it('awaits explicit stop proof while preserving the boolean compatibility API', async () => {
    const session = await service.createSession();
    mockPtyProcess.kill.mockImplementation(() => {});
    const stopping = service.stopSession(session!.id);
    let settled = false;
    void stopping.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(service.getSession(session!.id)).toBe(session);
    expect(service.isSessionClosing(session!.id)).toBe(true);
    expect(service.write(session!.id, 'must not execute')).toBe(false);
    for (const [exit] of mockPtyProcess.onExit.mock.calls) exit({ exitCode: 0 });
    expect(await stopping).toBe(true);
    expect(service.getSession(session!.id)).toBeUndefined();
    expect(await service.stopSession(session!.id)).toBe(false);
  });

  it('uses only the injected preflight filesystem, path resolver and snapshot home', async () => {
    const stat = vi.fn().mockResolvedValue({ isDirectory: () => true });
    const resolvePath = vi.fn((candidate: string) => path.resolve('/native', candidate));
    const native = new TerminalService(undefined, 2, {
      filesystem: { stat } as never,
      resolvePath,
      homeDirectory: '/snapshot-home',
      fallbackDirectory: '/application',
    });
    const resolve = (
      native as unknown as { resolveWorkingDirectory: (value?: string) => Promise<string> }
    ).resolveWorkingDirectory.bind(native);
    expect(await resolve()).toBe('/snapshot-home');
    expect(await resolve('project')).toBe('/native/project');
    expect(resolvePath).toHaveBeenCalledWith('project');
    expect(stat).toHaveBeenCalledWith('/native/project');
    stat.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    expect(await resolve('missing')).toBe('/snapshot-home');
    expect(stat).toHaveBeenLastCalledWith('/snapshot-home');
    await native.cleanup();
  });

  it('does not use ambient home when the native host snapshot is missing HOME', async () => {
    const stat = vi.fn().mockResolvedValue({ isDirectory: () => true });
    const native = new TerminalService(undefined, 2, {
      filesystem: { stat } as never,
      resolvePath: (candidate) => candidate,
      fallbackDirectory: '/application',
    });
    const home = vi.mocked(os.homedir);
    home.mockClear();
    const resolve = (
      native as unknown as { resolveWorkingDirectory: (value?: string) => Promise<string> }
    ).resolveWorkingDirectory.bind(native);
    expect(await resolve()).toBe('/application');
    expect(stat).toHaveBeenCalledWith('/application');
    expect(home).not.toHaveBeenCalled();
    await native.cleanup();
  });

  it('does not launch a PTY or fall back after native requested-directory DENIED/EIO', async () => {
    for (const code of ['EACCES', 'EIO']) {
      const error = Object.assign(new Error('native preflight failed'), { code });
      const stat = vi.fn().mockRejectedValue(error);
      const native = new TerminalService(undefined, 2, {
        filesystem: { stat } as never,
        resolvePath: (candidate) => candidate,
        homeDirectory: '/home',
        fallbackDirectory: '/application',
      });
      vi.mocked(pty.spawn).mockClear();
      await expect(native.createSession({ cwd: '/requested' })).rejects.toBe(error);
      expect(stat).toHaveBeenCalledExactlyOnceWith('/requested');
      expect(pty.spawn).not.toHaveBeenCalled();
      await native.cleanup();
    }
  });

  describe('killSession', () => {
    it('should kill existing session', async () => {
      vi.useFakeTimers();
      vi.mocked(platform.systemPathExists).mockReturnValue(true);
      vi.mocked(secureFs.stat).mockResolvedValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const session = await service.createSession();
      mockPtyProcess.kill.mockImplementation(() => {});
      const result = service.killSession(session!.id);

      expect(result).toBe(true);
      expect(mockPtyProcess.kill).toHaveBeenCalledWith('SIGTERM');

      await vi.advanceTimersByTimeAsync(1000);

      expect(mockPtyProcess.kill).toHaveBeenCalledWith('SIGKILL');
      expect(service.getSession(session!.id)).toBe(session);
      for (const [exit] of mockPtyProcess.onExit.mock.calls) exit({ exitCode: 0 });
      await service.cleanup();
      expect(service.getSession(session!.id)).toBeUndefined();

      vi.useRealTimers();
    });

    it('should return false for non-existent session', () => {
      const result = service.killSession('nonexistent');

      expect(result).toBe(false);
    });

    it('should handle kill errors', async () => {
      vi.mocked(platform.systemPathExists).mockReturnValue(true);
      vi.mocked(secureFs.stat).mockResolvedValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });
      mockPtyProcess.kill.mockImplementation(() => {
        throw new Error('Kill failed');
      });

      const session = await service.createSession();
      const result = service.killSession(session!.id);

      expect(result).toBe(false);
      expect(service.getSession(session!.id)).toBe(session);
      for (const [exit] of mockPtyProcess.onExit.mock.calls) exit({ exitCode: 0 });
    });
  });

  it('retains uncertain identities and closes admission after failed shutdown', async () => {
    vi.useFakeTimers();
    try {
      const uncertain = new TerminalService(undefined, 1);
      const session = await uncertain.createSession();
      mockPtyProcess.kill.mockImplementation(() => {});
      const closing = uncertain.cleanup();
      const rejected = expect(closing).rejects.toMatchObject({ code: 'TERMINAL_CLEANUP_FAILED' });
      await vi.advanceTimersByTimeAsync(3500);
      await rejected;
      expect(uncertain.getSession(session!.id)).toBe(session);
      expect(await uncertain.createSession()).toBeNull();
      expect(uncertain.write(session!.id, 'must not execute')).toBe(false);
      expect(uncertain.resize(session!.id, 80, 24)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drains a creation already awaiting filesystem work without exposing its late PTY', async () => {
    let release!: (value: unknown) => void;
    vi.mocked(secureFs.stat).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }) as never
    );
    const creating = service.createSession({ cwd: '/project' });
    const closing = service.cleanup();
    expect(await service.createSession()).toBeNull();
    release({ isDirectory: () => true });
    expect(await creating).toBeNull();
    await closing;
    expect(service.getAllSessions()).toEqual([]);
  });

  describe('getSession', () => {
    it('should return existing session', async () => {
      vi.mocked(platform.systemPathExists).mockReturnValue(true);
      vi.mocked(secureFs.stat).mockResolvedValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const session = await service.createSession();
      const retrieved = service.getSession(session!.id);

      expect(retrieved).toBe(session);
    });

    it('should return undefined for non-existent session', () => {
      const retrieved = service.getSession('nonexistent');

      expect(retrieved).toBeUndefined();
    });
  });

  describe('getScrollback', () => {
    it('should return scrollback buffer for existing session', async () => {
      vi.mocked(platform.systemPathExists).mockReturnValue(true);
      vi.mocked(secureFs.stat).mockResolvedValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const session = await service.createSession();
      session!.scrollbackBuffer = 'test scrollback';

      const scrollback = service.getScrollback(session!.id);

      expect(scrollback).toBe('test scrollback');
    });

    it('should return null for non-existent session', () => {
      const scrollback = service.getScrollback('nonexistent');

      expect(scrollback).toBeNull();
    });
  });

  describe('getAllSessions', () => {
    it('should return all active sessions', async () => {
      vi.mocked(platform.systemPathExists).mockReturnValue(true);
      vi.mocked(secureFs.stat).mockResolvedValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const session1 = await service.createSession({ cwd: '/dir1' });
      const session2 = await service.createSession({ cwd: '/dir2' });

      const sessions = service.getAllSessions();

      expect(sessions).toHaveLength(2);
      expect(session1).not.toBeNull();
      expect(session2).not.toBeNull();
      expect(sessions[0].id).toBe(session1!.id);
      expect(sessions[1].id).toBe(session2!.id);
      expect(sessions[0].cwd).toBe(path.resolve('/dir1'));
      expect(sessions[1].cwd).toBe(path.resolve('/dir2'));
    });

    it('should return empty array if no sessions', () => {
      const sessions = service.getAllSessions();

      expect(sessions).toEqual([]);
    });
  });

  describe('onData and onExit', () => {
    it('should allow subscribing and unsubscribing from data events', () => {
      const callback = vi.fn();
      const unsubscribe = service.onData(callback);

      expect(typeof unsubscribe).toBe('function');

      unsubscribe();
    });

    it('should allow subscribing and unsubscribing from exit events', () => {
      const callback = vi.fn();
      const unsubscribe = service.onExit(callback);

      expect(typeof unsubscribe).toBe('function');

      unsubscribe();
    });
  });

  describe('cleanup', () => {
    it('should clean up all sessions', async () => {
      vi.mocked(platform.systemPathExists).mockReturnValue(true);
      vi.mocked(secureFs.stat).mockResolvedValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const session1 = await service.createSession();
      const session2 = await service.createSession();

      await service.cleanup();

      expect(session1).not.toBeNull();
      expect(session2).not.toBeNull();
      expect(service.getSession(session1!.id)).toBeUndefined();
      expect(service.getSession(session2!.id)).toBeUndefined();
      expect(service.getAllSessions()).toHaveLength(0);
    });

    it('should handle cleanup errors gracefully', async () => {
      vi.mocked(platform.systemPathExists).mockReturnValue(true);
      vi.mocked(secureFs.stat).mockResolvedValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });
      mockPtyProcess.kill.mockImplementation(() => {
        throw new Error('Kill failed');
      });

      await service.createSession();

      const cleanup = service.cleanup();
      for (const [exit] of mockPtyProcess.onExit.mock.calls) exit({ exitCode: 0 });
      await expect(cleanup).resolves.toBeUndefined();
    });
  });

  it.each([{ cols: 0 }, { rows: 501 }, { cols: 1.5 }, { rows: Number.NaN }])(
    'rejects invalid creation dimensions before spawning (%j)',
    async (options) => {
      await expect(service.createSession(options)).rejects.toMatchObject({
        code: 'TERMINAL_DIMENSIONS_INVALID',
      });
      expect(pty.spawn).not.toHaveBeenCalled();
    }
  );
  it.each([undefined, '/project'])(
    'does not turn an unavailable scoped target into an unscoped controller terminal (%s)',
    async (cwd) => {
      await expect(
        service.createSession({ cwd, environmentTargetId: 'a'.repeat(64) })
      ).rejects.toMatchObject({ code: 'TERMINAL_TARGET_CHANGED' });
      expect(pty.spawn).not.toHaveBeenCalled();
    }
  );
  it('reserves the session limit while asynchronous creation is pending', async () => {
    const previous = service.getMaxSessions();
    service.setMaxSessions(1);
    let release!: (value: Awaited<ReturnType<typeof secureFs.stat>>) => void;
    vi.mocked(secureFs.stat).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    try {
      const first = service.createSession({ cwd: '/project' });
      expect(await service.createSession({ cwd: '/other' })).toBeNull();
      release({ isDirectory: () => true } as Awaited<ReturnType<typeof secureFs.stat>>);
      expect(await first).not.toBeNull();
      expect(pty.spawn).toHaveBeenCalledOnce();
    } finally {
      service.setMaxSessions(previous);
    }
  });

  describe('explicit TerminalService ownership', () => {
    it('creates independent service owners', () => {
      const instance1 = new TerminalService();
      const instance2 = new TerminalService();

      expect(instance1).not.toBe(instance2);
    });
  });
});
