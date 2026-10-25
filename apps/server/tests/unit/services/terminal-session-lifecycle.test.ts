import { expect, it, vi } from 'vitest';
import { TerminalSessionLifecycle } from '../../../src/services/terminal-session-lifecycle.js';
import { ManagedTerminalPty } from '../../../src/services/execution-environment/terminal.js';

it('escalates but does not acknowledge closure until PTY exit, then clears timers', async () => {
  vi.useFakeTimers();
  try {
    const pty = {
      kill: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
    };
    const owner = new TerminalSessionLifecycle(pty, false);
    const closing = owner.close();
    expect(owner.close()).toBe(closing);
    expect(pty.kill).toHaveBeenCalledWith('SIGTERM');
    await vi.advanceTimersByTimeAsync(1000);
    expect(pty.kill).toHaveBeenCalledWith('SIGKILL');
    let settled = false;
    void closing.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    owner.markExited();
    await closing;
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it('returns a safe cleanup failure rather than success when exit remains unconfirmed', async () => {
  vi.useFakeTimers();
  try {
    const owner = new TerminalSessionLifecycle(
      { kill: vi.fn(), write: vi.fn(), resize: vi.fn(), onData: vi.fn(), onExit: vi.fn() },
      false
    );
    const closing = owner.close();
    const rejected = expect(closing).rejects.toMatchObject({ code: 'TERMINAL_CLEANUP_FAILED' });
    await vi.advanceTimersByTimeAsync(3500);
    await rejected;
    expect(owner.closing).toBe(true);
    expect(owner.close()).toBe(closing);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it('never promotes a lost managed transport into confirmed target cleanup', async () => {
  const pty = Object.create(ManagedTerminalPty.prototype) as ManagedTerminalPty;
  Object.assign(pty, { exitConfirmed: false, kill: vi.fn() });
  const owner = new TerminalSessionLifecycle(pty, false);
  owner.markExited();
  await expect(owner.close()).rejects.toMatchObject({ code: 'TERMINAL_CLEANUP_FAILED' });
});
