import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import {
  parseLinuxProcessStat,
  waitForLinuxProcessGroupExit,
} from '@/core/platform/linux-process-group.js';

vi.mock('node:fs/promises', () => ({ default: { readdir: vi.fn(), readFile: vi.fn() } }));
afterEach(() => vi.restoreAllMocks());
const probe = () => ({ exists: vi.fn(() => true), states: vi.fn(async () => ['R']) });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('parses the process group after comm even with whitespace and nested parentheses', () => {
  expect(parseLinuxProcessStat('42 (worker ( ) name) R 10 99 99 0')).toEqual({
    state: 'R',
    group: 99,
  });
  expect(parseLinuxProcessStat('2 (kthreadd) S 0 0 0 0')).toEqual({ state: 'S', group: 0 });
});
it.each([
  'invalid',
  '42 (worker) R 1 broken',
  '42 (worker) R 1 -2',
  '42 (worker) RUNNING 1 99',
  '42 (worker) R 1 1e2',
])('rejects malformed procfs observations (%#)', (stat) => {
  expect(() => parseLinuxProcessStat(stat)).toThrow('observation');
});
it.each([0, 1, -42, 1.5, NaN])('refuses an invalid or broad group (%s)', async (group) => {
  const observation = probe();
  await expect(
    waitForLinuxProcessGroupExit(group, new AbortController().signal, observation)
  ).rejects.toThrow('Invalid owned');
  expect(observation.exists).not.toHaveBeenCalled();
});
it('does not inspect procfs when the kernel says the group no longer exists', async () => {
  const observation = probe();
  observation.exists.mockReturnValue(false);
  await waitForLinuxProcessGroupExit(42, new AbortController().signal, observation);
  expect(observation.states).not.toHaveBeenCalled();
});
it('does not inspect a group after the owner has already cancelled observation', async () => {
  const observation = probe();
  const controller = new AbortController();
  controller.abort();
  await expect(waitForLinuxProcessGroupExit(42, controller.signal, observation)).rejects.toThrow();
  expect(observation.exists).not.toHaveBeenCalled();
  expect(observation.states).not.toHaveBeenCalled();
});
it('does not settle while any observed process or thread is live, then accepts terminal states', async () => {
  const observation = probe();
  let settled = false;
  const observed = deferred();
  observation.states
    .mockImplementationOnce(async () => {
      observed.resolve();
      return ['Z', 'R', 'S'];
    })
    .mockResolvedValueOnce(['Z', 'X', 'x']);
  const operation = waitForLinuxProcessGroupExit(
    42,
    new AbortController().signal,
    observation
  ).then(() => {
    settled = true;
  });
  await observed.promise;
  expect(settled).toBe(false);
  await operation;
  expect(settled).toBe(true);
  expect(observation.states).toHaveBeenCalledTimes(2);
});
it('does not treat an unobservable existing group as terminated and honors the owner deadline', async () => {
  const observation = probe();
  observation.states.mockResolvedValue([]);
  const controller = new AbortController();
  const observed = deferred();
  observation.states.mockImplementation(async () => {
    observed.resolve();
    return [];
  });
  const operation = waitForLinuxProcessGroupExit(42, controller.signal, observation);
  const rejected = expect(operation).rejects.toThrow();
  await observed.promise;
  expect(observation.states).toHaveBeenCalledTimes(1);
  controller.abort();
  await rejected;
  const calls = observation.states.mock.calls.length;
  await new Promise((done) => setTimeout(done, 20));
  expect(observation.states).toHaveBeenCalledTimes(calls);
});

it('does not accept a zombie leader while its remaining thread is live in procfs', async () => {
  const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
  let live = true;
  const observed = deferred();
  vi.mocked(fs.readdir).mockImplementation(
    async (directory) => (directory === '/proc' ? ['self', '42', '99'] : ['42', '43']) as never
  );
  vi.mocked(fs.readFile).mockImplementation(async (file) => {
    if (file === '/proc/99/stat') return '99 (other group) R 1 88 88';
    if (String(file).endsWith('/43/stat')) {
      observed.resolve();
      return `43 (owned thread) ${live ? 'S' : 'Z'} 1 77 77`;
    }
    return '42 (owned leader) Z 1 77 77';
  });
  let settled = false;
  const operation = waitForLinuxProcessGroupExit(77, new AbortController().signal).then(() => {
    settled = true;
  });
  await observed.promise;
  expect(settled).toBe(false);
  live = false;
  await operation;
  expect(kill.mock.calls.every(([group, signal]) => group === -77 && signal === 0)).toBe(true);
  expect(fs.readFile).toHaveBeenCalledWith(
    '/proc/42/task/43/stat',
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );
});

it('does not accept a zombie leader with unavailable task metadata while the group still exists', async () => {
  vi.spyOn(process, 'kill').mockReturnValue(true);
  const observed = deferred();
  vi.mocked(fs.readdir).mockImplementation(async (directory) => {
    if (directory === '/proc') return ['42'] as never;
    observed.resolve();
    throw Object.assign(new Error('missing tasks'), { code: 'ENOENT' });
  });
  vi.mocked(fs.readFile).mockResolvedValue('42 (owned leader) Z 1 77 77');
  const controller = new AbortController();
  let settled = false;
  const operation = waitForLinuxProcessGroupExit(77, controller.signal).then(() => {
    settled = true;
  });
  const rejected = expect(operation).rejects.toThrow();
  try {
    await observed.promise;
    await new Promise((done) => setImmediate(done));
    expect(settled).toBe(false);
  } finally {
    controller.abort();
    await rejected;
  }
});
it('accepts a group disappearing during an inconclusive scan', async () => {
  const observation = probe();
  observation.states.mockResolvedValue([]);
  observation.exists.mockReturnValueOnce(true).mockReturnValueOnce(false);
  await waitForLinuxProcessGroupExit(42, new AbortController().signal, observation);
});
it('propagates observation failures instead of inventing successful cleanup', async () => {
  const observation = probe();
  observation.states.mockRejectedValue(new Error('observer unavailable'));
  await expect(
    waitForLinuxProcessGroupExit(42, new AbortController().signal, observation)
  ).rejects.toThrow('observer unavailable');
});
