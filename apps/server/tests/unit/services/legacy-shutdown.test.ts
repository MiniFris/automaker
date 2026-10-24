import { createServer } from 'node:http';
import { expect, it, vi } from 'vitest';
import { createLegacyApplication } from '../../../src/legacy-application.js';
import { createEventEmitter } from '../../../src/lib/events.js';

const managed = vi.hoisted(() => ({ tests: vi.fn(), preview: vi.fn() }));
vi.mock('../../../src/services/execution-environment/test-runner.js', () => ({
  getManagedTestRunnerService: () => ({ cleanup: managed.tests }),
}));
vi.mock('../../../src/services/execution-environment/dev-server.js', () => ({
  getManagedDevServerService: () => ({ cleanup: managed.preview }),
}));

it('attempts every owned cleanup after interruption/storage failures and never repeats a failed shutdown', async () => {
  const interrupt = vi.fn().mockRejectedValue(new Error('interruption fixture failure'));
  const features = vi.fn().mockResolvedValue(undefined),
    autoMode = vi.fn(),
    terminal = vi.fn();
  const tests = vi.fn().mockRejectedValue(new Error('test runner fixture failure'));
  const preview = vi.fn().mockResolvedValue(undefined);
  managed.tests.mockResolvedValue(undefined);
  managed.preview.mockResolvedValue(undefined);
  const runtime = createLegacyApplication({
    httpServer: createServer(),
    runStartupTasks: false,
    agents: { initialize: vi.fn(), interruptActiveSessions: interrupt },
    foundation: { events: createEventEmitter(), settings: {} as never },
    resources: {
      autoMode: {
        reconcileFeatureStates: vi.fn(),
        resumeInterruptedFeatures: vi.fn(),
        markAllRunningFeaturesInterrupted: features,
        interruptForShutdown: autoMode,
      },
      terminal: { cleanup: terminal },
      testRunner: { cleanup: tests },
      devServer: { initialize: vi.fn(), stopAll: preview },
    },
  });
  const first = runtime.shutdown('fixture');
  expect(runtime.shutdown('duplicate')).toBe(first);
  await expect(first).rejects.toBeInstanceOf(AggregateError);
  await expect(runtime.shutdown('later duplicate')).rejects.toBeInstanceOf(AggregateError);
  for (const cleanup of [
    interrupt,
    features,
    autoMode,
    terminal,
    tests,
    preview,
    managed.tests,
    managed.preview,
  ])
    expect(cleanup).toHaveBeenCalledTimes(1);
});
