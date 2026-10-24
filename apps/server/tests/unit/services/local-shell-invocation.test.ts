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
