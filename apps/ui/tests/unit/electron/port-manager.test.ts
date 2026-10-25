import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ occupied: new Set<number>(), probed: [] as number[] }));
vi.mock('net', () => ({
  default: {
    createServer: () => {
      const server = new EventEmitter() as EventEmitter & {
        listen: (port: number) => void;
        close: (callback: () => void) => void;
      };
      server.listen = (port) => {
        fixture.probed.push(port);
        queueMicrotask(() => server.emit(fixture.occupied.has(port) ? 'error' : 'listening'));
      };
      server.close = (callback) => callback();
      return server;
    },
  },
}));
import { findAvailablePort } from '../../../src/electron/utils/port-manager';

describe('startup port allocation', () => {
  beforeEach(() => {
    fixture.occupied.clear();
    fixture.probed.length = 0;
  });
  it('reserves the unbound backend selection when both default ports are occupied', async () => {
    fixture.occupied.add(3007).add(3008);
    const backend = await findAvailablePort(3008);
    const frontend = await findAvailablePort(3007, [backend]);
    expect([backend, frontend]).toEqual([3009, 3010]);
    expect(fixture.probed.filter((port) => port === backend)).toHaveLength(1);
  });
  it('accepts a set of exclusions without probing them', async () => {
    expect(await findAvailablePort(3007, new Set([3007, 3008]))).toBe(3009);
    expect(fixture.probed).toEqual([3009]);
  });
  it('bounds the search to the existing hundred-port window', async () => {
    await expect(
      findAvailablePort(
        3007,
        Array.from({ length: 100 }, (_, i) => 3007 + i)
      )
    ).rejects.toThrow('Could not find');
    expect(fixture.probed).toEqual([]);
  });
});
