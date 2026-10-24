import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationRuntimeLifecycle } from '../../../src/core/lifecycle/application-runtime.lifecycle.js';
import { ReadinessStateService } from '../../../src/core/lifecycle/readiness-state.service.js';

function fixture(enabled = true) {
  const readiness = new ReadinessStateService();
  const settings = {
    migrateFromLegacyElectronPath: vi.fn().mockResolvedValue({ migrated: false, errors: [] }),
    getGlobalSettings: vi.fn().mockResolvedValue({ projects: [{ path: '/owned/project' }] }),
  };
  const agents = { initialize: vi.fn(), interruptActiveSessions: vi.fn() };
  const auto = {
    closeAdmission: vi.fn(),
    reconcileFeatureStates: vi.fn(),
    resumeInterruptedFeatures: vi.fn(),
    markAllRunningFeaturesInterrupted: vi.fn(),
    interruptForShutdown: vi.fn(),
  };
  const dev = { initialize: vi.fn(), stopAll: vi.fn() };
  const tests = { cleanup: vi.fn() },
    terminal = { cleanup: vi.fn() },
    managedDev = { cleanup: vi.fn() },
    managedTests = { cleanup: vi.fn() };
  const lifecycle = new ApplicationRuntimeLifecycle(
    enabled,
    { storage: { dataDirectory: '/owned/data' } } as never,
    {} as never,
    readiness,
    settings as never,
    agents as never,
    auto as never,
    dev as never,
    tests as never,
    terminal as never,
    managedDev as never,
    managedTests as never
  );
  return {
    lifecycle,
    readiness,
    settings,
    agents,
    auto,
    dev,
    tests,
    terminal,
    managedDev,
    managedTests,
  };
}
afterEach(() => vi.useRealTimers());

describe('native runtime lifecycle', () => {
  it('closes admission synchronously before startup drain and persists interruption before aborting', async () => {
    const f = fixture(),
      order: string[] = [];
    let release!: () => void;
    f.settings.migrateFromLegacyElectronPath.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ migrated: false, errors: [] });
        })
    );
    f.auto.closeAdmission.mockImplementation(() => {
      order.push('admission');
    });
    f.agents.interruptActiveSessions.mockImplementation(() => {
      order.push('agent-persist');
    });
    f.auto.markAllRunningFeaturesInterrupted.mockImplementation(() => {
      order.push('feature-persist');
    });
    f.auto.interruptForShutdown.mockImplementation(() => {
      order.push('abort');
    });
    f.terminal.cleanup.mockImplementation(() => {
      order.push('terminal');
    });
    const started = f.lifecycle.onApplicationBootstrap();
    await Promise.resolve();
    const closed = f.lifecycle.onModuleDestroy();
    expect(order).toEqual(['admission']);
    release();
    await Promise.all([started, closed]);
    expect(order).toEqual(['admission', 'agent-persist', 'feature-persist', 'abort', 'terminal']);
    expect(f.agents.initialize).not.toHaveBeenCalled();
  });

  it('continues interruption and every cleanup after synchronous admission closure fails', async () => {
    const f = fixture(false);
    f.auto.closeAdmission.mockImplementation(() => {
      throw new Error('admission fixture');
    });
    const closed = f.lifecycle.onModuleDestroy();
    await expect(closed).rejects.toBeInstanceOf(AggregateError);
    for (const cleanup of [
      f.agents.interruptActiveSessions,
      f.auto.markAllRunningFeaturesInterrupted,
      f.auto.interruptForShutdown,
      f.terminal.cleanup,
      f.tests.cleanup,
      f.dev.stopAll,
      f.managedTests.cleanup,
      f.managedDev.cleanup,
    ])
      expect(cleanup).toHaveBeenCalledOnce();
    await expect(f.lifecycle.onModuleDestroy()).rejects.toBeInstanceOf(AggregateError);
    expect(f.auto.closeAdmission).toHaveBeenCalledOnce();
  });

  it.each(['migration', 'settings'] as const)(
    'keeps timed-out %s work owned and blocks late initialization after cleanup',
    async (owner) => {
      vi.useFakeTimers();
      const f = fixture();
      let release!: () => void;
      if (owner === 'migration')
        f.settings.migrateFromLegacyElectronPath.mockImplementation(
          () =>
            new Promise((resolve) => {
              release = () => resolve({ migrated: false, errors: [] });
            })
        );
      else
        f.settings.getGlobalSettings.mockImplementation(
          () =>
            new Promise((resolve) => {
              release = () => resolve({ projects: [{ path: '/owned/project' }] });
            })
        );
      const started = f.lifecycle.onApplicationBootstrap();
      const startupFailure = expect(started).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(120_000);
      await startupFailure;
      const closed = f.lifecycle.onModuleDestroy();
      const cleanupFailure = expect(closed).rejects.toBeInstanceOf(AggregateError);
      await vi.advanceTimersByTimeAsync(5000);
      await cleanupFailure;
      expect(f.terminal.cleanup).toHaveBeenCalledOnce();
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(f.agents.initialize).not.toHaveBeenCalled();
      expect(f.auto.reconcileFeatureStates).not.toHaveBeenCalled();
      expect(f.dev.initialize).not.toHaveBeenCalled();
      expect(f.readiness.snapshot().ready).toBe(false);
      await expect(f.lifecycle.onModuleDestroy()).rejects.toBeInstanceOf(AggregateError);
      expect(f.terminal.cleanup).toHaveBeenCalledOnce();
    }
  );

  it('fails startup when optional recovery times out, preserving its actual pending promise through cleanup', async () => {
    vi.useFakeTimers();
    const f = fixture();
    let release!: () => void;
    f.dev.initialize.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const started = f.lifecycle.onApplicationBootstrap();
    const failed = expect(started).rejects.toThrow('dev-server-state-recovery');
    await vi.advanceTimersByTimeAsync(120_000);
    await failed;
    const closed = f.lifecycle.onModuleDestroy();
    const cleanupFailure = expect(closed).rejects.toBeInstanceOf(AggregateError);
    await vi.advanceTimersByTimeAsync(5000);
    await cleanupFailure;
    expect(f.managedDev.cleanup).toHaveBeenCalledOnce();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.readiness.snapshot().ready).toBe(false);
    await expect(f.lifecycle.onModuleDestroy()).rejects.toBeInstanceOf(AggregateError);
  });

  it('drains a startup operation that settles during shutdown without admitting later owners', async () => {
    const f = fixture();
    let release!: () => void;
    f.settings.migrateFromLegacyElectronPath.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ migrated: false, errors: [] });
        })
    );
    const started = f.lifecycle.onApplicationBootstrap();
    await Promise.resolve();
    const closed = f.lifecycle.onModuleDestroy();
    release();
    await Promise.all([started, closed]);
    expect(f.settings.getGlobalSettings).not.toHaveBeenCalled();
    expect(f.agents.initialize).not.toHaveBeenCalled();
    expect(f.readiness.snapshot().state).toBe('stopping');
  });

  it('initializes dependencies before recovery and readiness', async () => {
    const f = fixture(),
      order: string[] = [];
    f.settings.migrateFromLegacyElectronPath.mockImplementation(async () => {
      order.push('settings');
      return { migrated: false, errors: [] };
    });
    f.agents.initialize.mockImplementation(async () => {
      order.push('agents');
      expect(f.readiness.snapshot().ready).toBe(false);
    });
    f.auto.reconcileFeatureStates.mockImplementation(async () => {
      order.push('reconcile');
    });
    f.auto.resumeInterruptedFeatures.mockImplementation(async () => {
      order.push('resume');
    });
    f.dev.initialize.mockImplementation(async () => {
      order.push('dev');
    });
    await f.lifecycle.onApplicationBootstrap();
    expect(order).toEqual(['settings', 'agents', 'reconcile', 'resume', 'dev']);
    expect(f.readiness.snapshot().ready).toBe(true);
    await f.lifecycle.onModuleDestroy();
  });
  it('keeps optional startup tasks disabled while marking the composition ready', async () => {
    const f = fixture(false);
    await f.lifecycle.onApplicationBootstrap();
    expect(f.readiness.snapshot().ready).toBe(true);
    expect(f.settings.getGlobalSettings).not.toHaveBeenCalled();
    expect(f.agents.initialize).not.toHaveBeenCalled();
    await f.lifecycle.onModuleDestroy();
  });
  it('fails readiness on required initialization and still attempts every cleanup once', async () => {
    const f = fixture();
    f.agents.initialize.mockRejectedValue(new Error('startup fixture'));
    await expect(f.lifecycle.onApplicationBootstrap()).rejects.toThrow('startup fixture');
    expect(f.readiness.snapshot().state).toBe('failed');
    const order: string[] = [];
    for (const [name, method] of [
      ['agents', f.agents.interruptActiveSessions],
      ['feature', f.auto.markAllRunningFeaturesInterrupted],
      ['auto', f.auto.interruptForShutdown],
      ['terminal', f.terminal.cleanup],
      ['tests', f.tests.cleanup],
      ['dev', f.dev.stopAll],
      ['managedTests', f.managedTests.cleanup],
      ['managedDev', f.managedDev.cleanup],
    ] as const)
      method.mockImplementation(async () => {
        order.push(name);
        if (name === 'agents' || name === 'tests') throw new Error('fixture');
      });
    const first = f.lifecycle.onModuleDestroy();
    expect(f.lifecycle.onModuleDestroy()).toBe(first);
    await expect(first).rejects.toBeInstanceOf(AggregateError);
    await expect(f.lifecycle.onModuleDestroy()).rejects.toBeInstanceOf(AggregateError);
    expect(order).toEqual([
      'agents',
      'feature',
      'auto',
      'terminal',
      'tests',
      'dev',
      'managedTests',
      'managedDev',
    ]);
    expect(f.readiness.snapshot().state).toBe('stopping');
  });
  it('persists interruption and aborts before awaiting a tracked full recovery execution', async () => {
    const f = fixture();
    let release!: () => void;
    f.auto.resumeInterruptedFeatures.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    await f.lifecycle.onApplicationBootstrap();
    f.auto.interruptForShutdown.mockImplementation(() => release());
    await f.lifecycle.onModuleDestroy();
    expect(f.auto.markAllRunningFeaturesInterrupted.mock.invocationCallOrder[0]).toBeLessThan(
      f.auto.interruptForShutdown.mock.invocationCallOrder[0]
    );
    expect(f.terminal.cleanup).toHaveBeenCalledOnce();
  });
  it('reports a stuck recovery without skipping terminal/process cleanup', async () => {
    vi.useFakeTimers();
    const f = fixture();
    let release!: () => void;
    f.auto.resumeInterruptedFeatures.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    await f.lifecycle.onApplicationBootstrap();
    const closed = f.lifecycle.onModuleDestroy();
    const rejected = expect(closed).rejects.toBeInstanceOf(AggregateError);
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(f.terminal.cleanup).toHaveBeenCalledOnce();
    expect(f.managedDev.cleanup).toHaveBeenCalledOnce();
    release();
  });
});
