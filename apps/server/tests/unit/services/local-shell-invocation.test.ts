import { expect, it } from 'vitest';
import { localShellInvocation } from '../../../src/services/execution-environment/local.js';

it('preserves legacy Windows exec shell, verbatim command quoting and ComSpec for event hooks', () => {
  const command = 'echo %USERPROFILE% & "C:\\Owned Fixture\\tool.exe" "a b"';
  expect(localShellInvocation(command, 'win32', 'cmd', 'C:\\Windows\\system32\\cmd.exe')).toEqual({
    command: 'C:\\Windows\\system32\\cmd.exe',
    args: ['/d', '/s', '/c', `"${command}"`],
    windowsVerbatimArguments: true,
  });
  expect(localShellInvocation(command, 'win32', 'cmd', '')).toMatchObject({ command: 'cmd.exe' });
  expect(localShellInvocation(command, 'win32', 'cmd', 'C:\\owned\\sh.exe')).toEqual({
    command: 'C:\\owned\\sh.exe',
    args: ['-c', command],
  });
});

it('does not change the default Windows execution environment or the Unix shell', () => {
  expect(localShellInvocation('echo owned', 'win32')).toEqual({
    command: 'powershell.exe',
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); echo owned',
    ],
  });
  expect(localShellInvocation('echo "$HOME"', 'linux', 'cmd')).toEqual({
    command: '/bin/sh',
    args: ['-c', 'echo "$HOME"'],
  });
});

it('uses case-insensitive captured COMSPEC and never an ambient shell when the captured value is absent', async () => {
  const { captureNativeLocalEnvironment, localComspec } =
    await import('../../../src/services/execution-environment/local.js');
  for (const key of ['COMSPEC', 'comspec', 'ComSpec']) {
    const environment = {
      [key]: 'C:\\Owned\\cmd.exe',
      AUTOMAKER_API_KEY: 'backend-secret',
      PATH: 'owned-path',
      HOME: 'owned-home',
      DATA_DIR: 'backend-data',
      PORT: '3008',
      NODE_PATH: 'backend-modules',
      USER_OPTION: 'keep',
    };
    const captured = captureNativeLocalEnvironment(environment);
    environment[key] = 'C:\\Changed\\cmd.exe';
    expect(Object.isFrozen(captured)).toBe(true);
    expect(captured).toMatchObject({ PATH: 'owned-path', HOME: 'owned-home', USER_OPTION: 'keep' });
    for (const secret of ['AUTOMAKER_API_KEY', 'DATA_DIR', 'PORT', 'NODE_PATH'])
      expect(captured).not.toHaveProperty(secret);
    expect(localShellInvocation('echo owned', 'win32', 'cmd', localComspec(captured)).command).toBe(
      'C:\\Owned\\cmd.exe'
    );
  }
  expect(localShellInvocation('echo owned', 'win32', 'cmd', localComspec({})).command).toBe(
    'cmd.exe'
  );
});
