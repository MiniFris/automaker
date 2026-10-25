import fs from 'node:fs';
import promises from 'node:fs/promises';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  nodeOwnedLocalChildRuntime,
  NodeOwnedLocalChildRuntime,
} from '../../../src/core/platform/owned-local-child.runtime.js';

vi.mock('node:fs', () => {
  const readFileSync = vi.fn();
  return { readFileSync, default: { readFileSync } };
});
vi.mock('node:fs/promises', () => ({ default: { readdir: vi.fn(), readFile: vi.fn() } }));
function stat(pid: number, start = '100', parent = process.pid) {
  const fields = Array.from({ length: 20 }, () => '0');
  fields[0] = 'S';
  fields[1] = String(parent);
  fields[2] = '42';
  fields[3] = '42';
  fields[19] = start;
  return `${pid} (owned fixture) ${fields.join(' ')}`;
}
// Mocked procfs only. No test signals any real process.
let leader: string | undefined, member: string | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  leader = stat(42);
  member = stat(43, '101', 42);
  vi.spyOn(process, 'kill').mockReturnValue(true);
  vi.mocked(fs.readFileSync).mockImplementation(((candidate: string) => {
    const result = candidate === '/proc/42/stat' ? leader : member;
    if (!result) throw Object.assign(new Error('absent'), { code: 'ENOENT' });
    return result;
  }) as never);
  vi.mocked(promises.readdir).mockResolvedValue(['42', '43'] as never);
  vi.mocked(promises.readFile).mockImplementation((async (candidate: string) =>
    candidate === '/proc/42/stat' ? leader : member) as never);
});
afterEach(() => vi.restoreAllMocks());
const child = { pid: 42 } as ChildProcess;
it.each(['darwin', 'win32'] as const)(
  'keeps %s signals on the original ChildProcess and reports unsupported tree proof',
  async (platform) => {
    const original = { pid: 42, exitCode: null as number | null, signalCode: null, kill: vi.fn() };
    const target = new NodeOwnedLocalChildRuntime(platform).capture(
      original as unknown as ChildProcess
    );
    await target.prepare();
    target.signal('SIGTERM');
    expect(original.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
    original.exitCode = 0;
    target.signal('SIGKILL');
    expect(original.kill).toHaveBeenCalledTimes(1);
    expect(process.kill).not.toHaveBeenCalled();
    await expect(target.waitForQuiescence(new AbortController().signal)).rejects.toThrow(
      'unsupported'
    );
  }
);
it.skipIf(process.platform !== 'linux')(
  'authorizes only the original group, with anchored escalation after leader reparenting/exit',
  async () => {
    const target = nodeOwnedLocalChildRuntime.capture(child);
    await target.prepare();
    target.signal('SIGTERM');
    leader = undefined;
    member = stat(43, '101', 1);
    target.signal('SIGKILL');
    expect(process.kill).toHaveBeenNthCalledWith(1, -42, 'SIGTERM');
    expect(process.kill).toHaveBeenNthCalledWith(2, -42, 'SIGKILL');
  }
);
it.skipIf(process.platform !== 'linux')(
  'refuses leader PID reuse before every signal and permanently retains uncertainty',
  async () => {
    const target = nodeOwnedLocalChildRuntime.capture(child);
    await target.prepare();
    target.signal('SIGTERM');
    leader = stat(42, '999');
    expect(() => target.signal('SIGKILL')).toThrow();
    leader = stat(42);
    expect(() => target.signal('SIGKILL')).toThrow();
    expect(process.kill).toHaveBeenCalledTimes(1);
  }
);
it.skipIf(process.platform !== 'linux')(
  'does not acquire authority from a post-leader numeric group scan',
  async () => {
    const target = nodeOwnedLocalChildRuntime.capture(child);
    leader = undefined;
    await target.prepare();
    expect(() => target.signal('SIGTERM')).toThrow();
    expect(promises.readdir).not.toHaveBeenCalled();
    expect(process.kill).not.toHaveBeenCalled();
  }
);
it.skipIf(process.platform !== 'linux')(
  'rejects a changed generation anchor after the leader disappears',
  async () => {
    const target = nodeOwnedLocalChildRuntime.capture(child);
    await target.prepare();
    leader = undefined;
    member = stat(43, '999', 1);
    expect(() => target.signal('SIGKILL')).toThrow();
    expect(process.kill).not.toHaveBeenCalled();
  }
);
it.skipIf(process.platform !== 'linux')(
  'does not accept anchors if the original leader changed during capture',
  async () => {
    const target = nodeOwnedLocalChildRuntime.capture(child);
    vi.mocked(promises.readFile).mockImplementation((async (candidate: string) => {
      if (candidate === '/proc/43/stat') leader = stat(42, '999');
      return candidate === '/proc/42/stat' ? stat(42) : member;
    }) as never);
    await expect(target.prepare()).rejects.toThrow();
    expect(() => target.signal('SIGTERM')).toThrow();
    expect(process.kill).not.toHaveBeenCalled();
  }
);
