import { mkdtemp, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createEventEmitter } from '../../../src/lib/events.js';
import { ApplicationEventBusAdapter } from '../../../src/core/eventing/index.js';
import { SecurityService } from '../../../src/core/security/index.js';
import { SupervisorCoordinator } from '../../../src/core/lifecycle/supervisor-coordinator.service.js';

describe('core security, eventing and lifecycle', () => {
  it('handles POSIX, Windows drive and UNC path boundaries without treating remote paths as local', () => {
    const security = new SecurityService();
    expect(security.isWithin('/repo/sub/file', '/repo', 'posix')).toBe(true);
    expect(security.isWithin('/repo-other/file', '/repo', 'posix')).toBe(false);
    expect(security.isWithin('C:\\repo\\sub', 'C:\\repo', 'win32')).toBe(true);
    expect(security.isWithin('D:\\repo', 'C:\\repo', 'win32')).toBe(false);
    expect(security.isWithin('\\\\server\\share\\repo', '\\\\server\\share', 'win32')).toBe(true);
  });

  it('rejects a local symlink that escapes the allowed project root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'security-root-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'security-outside-'));
    const previousAllowedRoot = process.env.ALLOWED_ROOT_DIRECTORY;
    try {
      await symlink(outside, path.join(root, 'escape'));
      process.env.ALLOWED_ROOT_DIRECTORY = root;
      const security = new SecurityService();
      expect(() => security.validateLocalPath(path.join(root, 'escape', 'file.txt'))).toThrow(
        'Path not allowed'
      );
    } finally {
      if (previousAllowedRoot === undefined) delete process.env.ALLOWED_ROOT_DIRECTORY;
      else process.env.ALLOWED_ROOT_DIRECTORY = previousAllowedRoot;
      await Promise.all([rm(root, { recursive: true }), rm(outside, { recursive: true })]);
      new SecurityService();
    }
  });

  it('keeps event ordering, isolates subscriber errors and disposes subscriptions', () => {
    const bus = new ApplicationEventBusAdapter(createEventEmitter());
    const calls: string[] = [];
    bus.subscribe('feature:progress', () => calls.push('first'));
    bus.subscribe('feature:progress', () => {
      throw new Error('subscriber fixture');
    });
    bus.subscribe('feature:progress', () => calls.push('third'));
    bus.emit('feature:progress', { featureId: 'feature-1' });
    expect(calls).toEqual(['first', 'third']);
    bus.dispose();
    bus.emit('feature:progress', { featureId: 'feature-2' });
    expect(calls).toEqual(['first', 'third']);
  });

  it('starts supervisors in registration order and stops them in reverse order once', async () => {
    const calls: string[] = [];
    const coordinator = new SupervisorCoordinator();
    for (const name of ['one', 'two'])
      coordinator.register({
        name,
        start: vi.fn(() => calls.push(`start:${name}`)),
        stop: vi.fn(() => calls.push(`stop:${name}`)),
        health: vi.fn(() => ({ healthy: true })),
      });
    await coordinator.startAll();
    await coordinator.beforeApplicationShutdown('test');
    await coordinator.beforeApplicationShutdown('test');
    expect(calls).toEqual(['start:one', 'start:two', 'stop:two', 'stop:one']);
    expect(await coordinator.health()).toEqual({ one: { healthy: true }, two: { healthy: true } });
  });

  it('enforces the shared supervisor shutdown deadline', async () => {
    vi.useFakeTimers();
    try {
      const coordinator = new SupervisorCoordinator();
      coordinator.register({
        name: 'stuck',
        start: vi.fn(),
        stop: vi.fn(() => new Promise<void>(() => undefined)),
        health: vi.fn(() => ({ healthy: true })),
      });
      const shutdown = coordinator.beforeApplicationShutdown('test');
      await vi.advanceTimersByTimeAsync(30_000);
      await expect(shutdown).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
