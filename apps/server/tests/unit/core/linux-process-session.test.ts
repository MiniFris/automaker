import fs from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import {
  linuxProcessSession,
  waitForLinuxSessionExit,
} from '../../../src/core/platform/linux-process-group.js';
vi.mock('node:fs/promises', () => ({ default: { readdir: vi.fn(), readFile: vi.fn() } }));

it('accepts kernel session zero without treating it as the owned PTY session', () => {
  expect(linuxProcessSession('2 (kernel) S 0 0 0')).toBe(0);
  expect(linuxProcessSession('11 (owned) S 1 11 11')).toBe(11);
  expect(() => linuxProcessSession('11 (owned) S 1 11 invalid')).toThrow();
});

it('observes live job-control groups in the same session without signalling them', async () => {
  let state = 'S';
  vi.mocked(fs.readdir).mockImplementation(
    async (file) =>
      (String(file) === '/proc'
        ? ['11', '22']
        : [String(file).includes('/11/') ? '11' : '22']) as never
  );
  vi.mocked(fs.readFile).mockImplementation(
    async (file) =>
      (String(file).includes('/22/') ? `22 (job) ${state} 1 22 11` : '11 (root) Z 1 11 11') as never
  );
  const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
  vi.mocked(fs.readFile).mockImplementationOnce(async () => '' as never);
  const controller = new AbortController();
  try {
    let settled = false;
    const pending = waitForLinuxSessionExit(11, controller.signal).then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(-22, 0));
    expect(settled).toBe(false);
    state = 'Z';
    await pending;
    expect(kill.mock.calls.every(([, signal]) => signal === 0)).toBe(true);
  } finally {
    controller.abort();
    kill.mockRestore();
  }
});
