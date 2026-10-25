import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { TerminalSessionLifecycle } from '../../../src/services/terminal-session-lifecycle.js';
vi.mock('node:fs', async () => ({ ...(await vi.importActual('node:fs')), readFileSync: vi.fn() }));
const pid = 2_147_483_647;
const stat = (group: number, session: number, start = '12345') =>
  `${pid} (owned fixture) ${['S', String(process.pid), String(group), String(session), ...Array(15).fill('0'), start].join(' ')}`;

it('waits for child-side setsid on the same forkpty generation before claiming the group', async () => {
  vi.mocked(readFileSync).mockReturnValueOnce(stat(7, 7)).mockReturnValue(stat(pid, pid));
  const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
  const pty = {
    pid,
    kill: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
  };
  try {
    const owner = new TerminalSessionLifecycle(pty, false);
    expect(kill).not.toHaveBeenCalled();
    await owner.ready();
    expect(readFileSync).toHaveBeenCalledTimes(2);
    owner.markExited();
    await owner.close();
    expect(kill).toHaveBeenCalledWith(-pid, 'SIGTERM');
    expect(pty.kill).not.toHaveBeenCalled();
  } finally {
    kill.mockRestore();
    vi.mocked(readFileSync).mockReset();
  }
});

it('does not signal a reused PID while child ownership is being established', async () => {
  vi.mocked(readFileSync)
    .mockReturnValueOnce(stat(7, 7))
    .mockReturnValue(stat(pid, pid, '54321'));
  const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
  const pty = {
    pid,
    kill: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
  };
  try {
    const owner = new TerminalSessionLifecycle(pty, false);
    await expect(owner.ready()).rejects.toMatchObject({ code: 'TERMINAL_CLEANUP_FAILED' });
    owner.markExited();
    await expect(owner.close()).rejects.toMatchObject({ code: 'TERMINAL_CLEANUP_FAILED' });
    expect(kill).not.toHaveBeenCalled();
    expect(pty.kill).not.toHaveBeenCalled();
  } finally {
    kill.mockRestore();
    vi.mocked(readFileSync).mockReset();
  }
});
